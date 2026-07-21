import fs from "node:fs/promises";
import path from "node:path";
import { FileStore } from "./file-store.mjs";
import { assertSafeName, normalizeRelativePath } from "./path-ids.mjs";

const WORKSPACE_SOURCE_ID = "service-lasso-workspaces";
const WRITABLE_MODES = new Set(["read-write", "rw", "write"]);

export function shouldUseWorkspaceStore(env = process.env) {
  return (
    env.FILES_SOURCE_PROVIDER === WORKSPACE_SOURCE_ID ||
    env.SERVICE_LASSO_FILES_SOURCE_PROVIDER === WORKSPACE_SOURCE_ID ||
    env.SERVICE_LASSO_MANAGED === "1" ||
    Boolean(registryJson(env) || registryPath(env) || registryUrl(env))
  );
}

export async function createFileSystemStore({ dataRoot, env = process.env } = {}) {
  if (shouldUseWorkspaceStore(env)) {
    return new WorkspaceRegistryStore({ env });
  }

  return new FileStore(dataRoot);
}

export class WorkspaceRegistryStore {
  constructor({ env = process.env } = {}) {
    this.env = env;
    this.lastLoad = {
      status: "not-loaded",
      entries: [],
      error: null,
      source: registrySource(env),
    };
  }

  async ensureRoot() {
    await this.loadRegistry();
  }

  async describeSources() {
    const registry = await this.loadRegistry();
    return {
      provider: WORKSPACE_SOURCE_ID,
      status: registry.status,
      source: registry.source,
      error: registry.error,
      services: groupRegistry(registry.entries),
    };
  }

  async list() {
    const registry = await this.loadRegistry();
    if (registry.status !== "ok") {
      return [];
    }

    const items = [];
    for (const service of groupRegistry(registry.entries)) {
      items.push(serviceVirtualItem(service));
      for (const root of service.roots) {
        items.push(rootVirtualItem(root));
        items.push(...(await listRootItems(root)));
      }
    }
    return items;
  }

  async createFolder(name, parentId) {
    const target = await this.resolveTarget(parentId, { requireWritable: true, allowRoot: true });
    assertSafeName(name);
    const created = await target.store.createFolder(name, idForRelative(target, target.relativePath));
    return itemFromLocalItem(target, created);
  }

  async writeFile(file, parentId) {
    const target = await this.resolveTarget(parentId, { requireWritable: true, allowRoot: true });
    const written = await target.store.writeFile(file, idForRelative(target, target.relativePath));
    return itemFromLocalItem(target, written);
  }

  async delete(ids) {
    for (const id of arrayValue(ids)) {
      const target = await this.resolveTarget(id, { requireWritable: true });
      if (!target.relativePath) {
        throw statusError("Workspace roots cannot be deleted.", 400);
      }
      await target.store.delete([idForRelative(target, target.relativePath)]);
    }
  }

  async rename(id, newName) {
    const target = await this.resolveTarget(id, { requireWritable: true });
    if (!target.relativePath) {
      throw statusError("Workspace roots cannot be renamed.", 400);
    }
    const renamed = await target.store.rename(idForRelative(target, target.relativePath), newName);
    return itemFromLocalItem(target, renamed);
  }

  async copy(sourceIds, destinationId) {
    const destination = await this.resolveTarget(destinationId, { requireWritable: true, allowRoot: true });
    for (const sourceId of arrayValue(sourceIds)) {
      const source = await this.resolveTarget(sourceId);
      if (!source.relativePath) {
        throw statusError("Workspace roots cannot be copied.", 400);
      }
      const destinationPath = destination.store.resolve(
        normalizeRelativePath(path.posix.join(destination.relativePath, path.basename(source.relativePath))),
      );
      await assertMissing(destinationPath);
      await fs.cp(
        source.store.resolve(source.relativePath),
        destinationPath,
        { recursive: true, errorOnExist: true, force: false },
      );
    }
  }

  async move(sourceIds, destinationId) {
    const destination = await this.resolveTarget(destinationId, { requireWritable: true, allowRoot: true });
    for (const sourceId of arrayValue(sourceIds)) {
      const source = await this.resolveTarget(sourceId, { requireWritable: true });
      if (!source.relativePath) {
        throw statusError("Workspace roots cannot be moved.", 400);
      }
      const destinationPath = destination.store.resolve(
        normalizeRelativePath(path.posix.join(destination.relativePath, path.basename(source.relativePath))),
      );
      await assertMissing(destinationPath);
      await fs.rename(
        source.store.resolve(source.relativePath),
        destinationPath,
      );
    }
  }

  async sendDownload(ids, response) {
    const sourceIds = arrayValue(ids);
    if (sourceIds.length !== 1) {
      throw statusError("Download one workspace file at a time.", 400);
    }
    const target = await this.resolveTarget(sourceIds[0]);
    if (!target.relativePath) {
      throw statusError("Workspace roots cannot be downloaded.", 400);
    }
    await target.store.sendDownload([idForRelative(target, target.relativePath)], response);
  }

  async legacyList() {
    throw statusError("Legacy path API is unavailable for Service Lasso workspace sources.", 400);
  }

  resolve() {
    throw statusError("Direct path resolution is unavailable for Service Lasso workspace sources.", 400);
  }

  async loadRegistry() {
    try {
      const raw = await readRegistry(this.env);
      const entries = normalizeRegistry(raw);
      this.lastLoad = {
        status: "ok",
        entries,
        error: null,
        source: registrySource(this.env),
      };
    } catch (error) {
      this.lastLoad = {
        status: "unavailable",
        entries: [],
        error: error.message || "Workspace registry is unavailable.",
        source: registrySource(this.env),
      };
    }
    return this.lastLoad;
  }

  async resolveTarget(id, { requireWritable = false, allowRoot = false } = {}) {
    const registry = await this.loadRegistry();
    if (registry.status !== "ok") {
      throw statusError(`Workspace registry is unavailable: ${registry.error}`, 503);
    }

    const parsed = parseWorkspaceId(id);
    if (!parsed || (parsed.kind === "root" && !allowRoot) || parsed.kind === "service") {
      throw statusError("Select a workspace root or item.", 400);
    }

    const entry = registry.entries.find(
      (candidate) => candidate.serviceId === parsed.serviceId && candidate.rootId === parsed.rootId,
    );
    if (!entry) {
      throw statusError("Workspace root is not available.", 404);
    }
    if (requireWritable && !entry.writable) {
      throw statusError("Workspace root is read-only.", 403);
    }

    return {
      ...entry,
      displayPath: rootDisplayPath(entry),
      relativePath: parsed.kind === "root" ? "" : parsed.relativePath,
      store: new FileStore(entry.path),
    };
  }
}

async function readRegistry(env) {
  const inline = registryJson(env);
  if (inline) {
    return JSON.parse(inline);
  }

  const filePath = registryPath(env);
  if (filePath) {
    return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
  }

  const url = registryUrl(env);
  if (url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Workspace registry request failed with HTTP ${response.status}.`);
    }
    return response.json();
  }

  throw new Error("No Service Lasso workspace registry is configured.");
}

function normalizeRegistry(raw) {
  const entries = Array.isArray(raw) ? raw : raw?.entries ?? raw?.sources ?? raw?.workspaces ?? [];
  if (!Array.isArray(entries)) {
    throw new Error("Workspace registry must be an array or contain entries.");
  }

  return entries
    .filter((entry) => entry && entry.sourceId === WORKSPACE_SOURCE_ID && !entry.hidden && !entry.protected)
    .map((entry) => {
      if (!entry.serviceId || !entry.rootId || !entry.path) {
        throw new Error("Workspace registry entries require serviceId, rootId, and path.");
      }
      const mode = String(entry.mode || "read-only").toLowerCase();
      return {
        sourceId: WORKSPACE_SOURCE_ID,
        serviceId: String(entry.serviceId),
        rootId: String(entry.rootId),
        label: String(entry.label || entry.rootId),
        path: path.resolve(String(entry.path)),
        mode: mode === "rw" || mode === "write" ? "read-write" : mode,
        writable: WRITABLE_MODES.has(mode),
      };
    });
}

function groupRegistry(entries) {
  const services = new Map();
  for (const entry of entries) {
    const service = services.get(entry.serviceId) ?? {
      serviceId: entry.serviceId,
      label: entry.serviceId,
      roots: [],
    };
    service.roots.push({ ...entry, displayPath: rootDisplayPath(entry) });
    services.set(entry.serviceId, service);
  }
  return [...services.values()];
}

async function listRootItems(root) {
  const store = new FileStore(root.path);
  const results = [];

  const walk = async (relativePath = "") => {
    let entries;
    try {
      entries = await fs.readdir(store.resolve(relativePath), { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const childRelative = normalizeRelativePath(path.posix.join(relativePath.replaceAll("\\", "/"), entry.name));
      results.push(itemFromLocalItem({ ...root, store }, await store.itemFromRelativePath(childRelative)));
      if (entry.isDirectory()) {
        await walk(childRelative);
      }
    }
  };

  await walk("");
  return results;
}

function serviceVirtualItem(service) {
  return {
    _id: encodeWorkspaceId({ kind: "service", serviceId: service.serviceId }),
    name: service.label,
    isDirectory: true,
    path: `/${displaySegment(service.label)}`,
    parentId: null,
    sourceId: WORKSPACE_SOURCE_ID,
    serviceId: service.serviceId,
    virtual: true,
  };
}

function rootVirtualItem(root) {
  return {
    _id: encodeWorkspaceId({ kind: "root", serviceId: root.serviceId, rootId: root.rootId }),
    name: root.label,
    isDirectory: true,
    path: root.displayPath,
    parentId: encodeWorkspaceId({ kind: "service", serviceId: root.serviceId }),
    sourceId: WORKSPACE_SOURCE_ID,
    serviceId: root.serviceId,
    rootId: root.rootId,
    mode: root.mode,
    readOnly: !root.writable,
    virtual: true,
  };
}

function itemFromRootRelative(root, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const name = normalized ? path.basename(normalized) : root.label;
  const parentRelative = normalized ? path.posix.dirname(normalized.replaceAll("\\", "/")) : "";
  return {
    _id: encodeWorkspaceId({ kind: "item", serviceId: root.serviceId, rootId: root.rootId, relativePath: normalized }),
    name,
    isDirectory: false,
    path: normalized ? `${root.displayPath}/${normalized}` : root.displayPath,
    parentId:
      normalized && parentRelative !== "."
        ? encodeWorkspaceId({ kind: "item", serviceId: root.serviceId, rootId: root.rootId, relativePath: parentRelative })
        : encodeWorkspaceId({ kind: "root", serviceId: root.serviceId, rootId: root.rootId }),
    sourceId: WORKSPACE_SOURCE_ID,
    serviceId: root.serviceId,
    rootId: root.rootId,
    mode: root.mode,
    readOnly: !root.writable,
  };
}

function itemFromLocalItem(root, localItem) {
  const item = itemFromRootRelative(root, relativePathFromLocalItem(localItem));
  return {
    ...item,
    isDirectory: localItem.isDirectory,
    size: localItem.size,
    mimeType: localItem.mimeType,
    createdAt: localItem.createdAt,
    updatedAt: localItem.updatedAt,
  };
}

function relativePathFromLocalItem(item) {
  return normalizeRelativePath(item.path);
}

function idForRelative(root, relativePath) {
  if (!relativePath) {
    return null;
  }
  return Buffer.from(relativePath, "utf8").toString("base64url");
}

function encodeWorkspaceId(payload) {
  return `workspace:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

function parseWorkspaceId(id) {
  if (!id || typeof id !== "string" || !id.startsWith("workspace:")) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(id.slice("workspace:".length), "base64url").toString("utf8"));
    if (parsed.relativePath) {
      parsed.relativePath = normalizeRelativePath(parsed.relativePath);
    }
    return parsed;
  } catch {
    throw statusError("Invalid workspace item id.", 400);
  }
}

function rootDisplayPath(entry) {
  return `/${displaySegment(entry.serviceId)}/${displaySegment(entry.label)}`;
}

function displaySegment(value) {
  return String(value || "workspace").replace(/[\\/]/g, "_");
}

function arrayValue(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  if (!value) {
    return [];
  }
  return [value];
}

async function assertMissing(absolute) {
  try {
    await fs.stat(absolute);
  } catch {
    return;
  }
  throw statusError("A file or folder already exists at that path.", 400);
}

function registryJson(env) {
  return env.FILES_WORKSPACES_REGISTRY_JSON || env.SERVICE_LASSO_WORKSPACES_REGISTRY_JSON;
}

function registryPath(env) {
  return env.FILES_WORKSPACES_REGISTRY_PATH || env.SERVICE_LASSO_WORKSPACES_REGISTRY_PATH;
}

function registryUrl(env) {
  return env.FILES_WORKSPACES_REGISTRY_URL || env.SERVICE_LASSO_WORKSPACES_REGISTRY_URL;
}

function registrySource(env) {
  if (registryJson(env)) {
    return "env-json";
  }
  if (registryPath(env)) {
    return registryPath(env);
  }
  if (registryUrl(env)) {
    return registryUrl(env);
  }
  return null;
}

function statusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}
