import path from "node:path";
import { FileStore, ROOT_ID } from "./file-store.mjs";
import { shouldUseWorkspaceStore, WorkspaceRegistryStore } from "./workspace-store.mjs";

export const LOCAL_DATA_ROOT_SOURCE_ID = "local-data-root";
export const SERVICE_LASSO_WORKSPACES_SOURCE_ID = "service-lasso-workspaces";

/**
 * @typedef {object} SourcePermissions
 * @property {boolean} canRead
 * @property {boolean} canWrite
 * @property {boolean} canRemove
 * @property {boolean} canDownload
 * @property {boolean} canUpload
 * @property {boolean} canCreateFolder
 * @property {boolean} canRename
 * @property {boolean} canMove
 * @property {boolean} canCopy
 */

/**
 * @typedef {object} FileSourceProvider
 * @property {string} id
 * @property {string} name
 * @property {string} type
 * @property {string | null} root
 * @property {() => Promise<void>} ensureRoot
 * @property {(options?: { defaultSource?: boolean }) => object} toJSON
 */

const FULL_ACCESS_PERMISSIONS = Object.freeze({
  canRead: true,
  canWrite: true,
  canRemove: true,
  canDownload: true,
  canUpload: true,
  canCreateFolder: true,
  canRename: true,
  canMove: true,
  canCopy: true,
});

const READ_ONLY_PERMISSIONS = Object.freeze({
  canRead: true,
  canWrite: false,
  canRemove: false,
  canDownload: true,
  canUpload: false,
  canCreateFolder: false,
  canRename: false,
  canMove: false,
  canCopy: true,
});

/**
 * Returns true when `absolutePath` stays inside an approved root directory.
 *
 * @param {string} root
 * @param {string} absolutePath
 * @returns {boolean}
 */
export function isInsideApprovedRoot(root, absolutePath) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(absolutePath);
  const relative = path.relative(resolvedRoot, resolvedPath);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * Creates a 4xx/5xx error the Express error handler can map to HTTP status.
 *
 * @param {string} message
 * @param {number} status
 * @returns {Error & { status: number }}
 */
function statusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * Builds per-root permissions from a writable flag.
 *
 * @param {boolean} writable
 * @returns {SourcePermissions}
 */
function permissionsForWritable(writable) {
  return writable ? { ...FULL_ACCESS_PERMISSIONS } : { ...READ_ONLY_PERMISSIONS };
}

/**
 * Local filesystem source backed by a single approved root.
 */
export class LocalFileSourceProvider {
  /**
   * @param {object} options
   * @param {string} options.id
   * @param {string} options.name
   * @param {string} options.root
   * @param {string} [options.type]
   * @param {SourcePermissions} [options.permissions]
   */
  constructor({ id, name, root, type = "local", permissions = FULL_ACCESS_PERMISSIONS }) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.root = path.resolve(root);
    this.permissions = { ...permissions };
    this.store = new FileStore(this.root);
  }

  /**
   * Ensures the approved root directory exists.
   *
   * @returns {Promise<void>}
   */
  async ensureRoot() {
    await this.store.ensureRoot();
  }

  /**
   * Describes this source for `/api/sources` compatibility.
   *
   * @returns {Promise<object>}
   */
  async describeSources() {
    return {
      provider: this.id,
      status: "ok",
      services: [],
      roots: [
        {
          sourceId: this.id,
          rootId: ROOT_ID,
          label: this.name,
          path: this.root,
          mode: this.permissions.canWrite ? "read-write" : "read-only",
        },
      ],
    };
  }

  /**
   * Serializes source identity, roots, and permissions for the API.
   *
   * @param {{ defaultSource?: boolean }} [options]
   * @returns {object}
   */
  toJSON({ defaultSource = false } = {}) {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      default: defaultSource,
      roots: [
        {
          id: ROOT_ID,
          name: this.name,
          sourceId: this.id,
          permissions: { ...this.permissions },
        },
      ],
    };
  }

  /**
   * Lists files and folders under this source with source metadata.
   *
   * @returns {Promise<object[]>}
   */
  async list() {
    return (await this.store.list()).map((item) => this.withSourceMetadata(item));
  }

  /**
   * @param {string} name
   * @param {string | null} parentId
   * @returns {Promise<object>}
   */
  async createFolder(name, parentId) {
    return this.withSourceMetadata(await this.store.createFolder(name, parentId));
  }

  /**
   * @param {Express.Multer.File | undefined} file
   * @param {string | null} parentId
   * @returns {Promise<object>}
   */
  async writeFile(file, parentId) {
    return this.withSourceMetadata(await this.store.writeFile(file, parentId));
  }

  /**
   * @param {string[] | string | undefined} ids
   * @returns {Promise<void>}
   */
  async delete(ids) {
    return this.store.delete(ids);
  }

  /**
   * @param {string} id
   * @param {string} newName
   * @returns {Promise<object>}
   */
  async rename(id, newName) {
    return this.withSourceMetadata(await this.store.rename(id, newName));
  }

  /**
   * @param {string[] | string | undefined} sourceIds
   * @param {string | null} destinationId
   * @returns {Promise<void>}
   */
  async copy(sourceIds, destinationId) {
    return this.store.copy(sourceIds, destinationId);
  }

  /**
   * @param {string[] | string | undefined} sourceIds
   * @param {string | null} destinationId
   * @returns {Promise<void>}
   */
  async move(sourceIds, destinationId) {
    return this.store.move(sourceIds, destinationId);
  }

  /**
   * @param {string[] | string | undefined} ids
   * @param {import("express").Response} response
   * @returns {Promise<void>}
   */
  async sendDownload(ids, response) {
    return this.store.sendDownload(ids, response);
  }

  /**
   * Resolves a relative path and rejects anything outside the approved root.
   *
   * @param {string} [relativePath]
   * @returns {string}
   */
  resolve(relativePath = "") {
    const absolute = this.store.resolve(relativePath);
    if (!isInsideApprovedRoot(this.root, absolute)) {
      throw statusError("Resolved path escaped the approved source root.", 400);
    }
    return absolute;
  }

  /**
   * @param {string} relativePath
   * @returns {Promise<object[]>}
   */
  legacyList(relativePath) {
    return this.store.legacyList(relativePath);
  }

  /**
   * @param {string} relativePath
   * @returns {import("node:fs").ReadStream}
   */
  readStream(relativePath) {
    return this.store.readStream(relativePath);
  }

  /**
   * Attaches stable source id and permission metadata used by the UI/API.
   *
   * @param {object} item
   * @returns {object}
   */
  withSourceMetadata(item) {
    return {
      ...item,
      sourceId: this.id,
      sourceRootId: ROOT_ID,
      permissions: { ...this.permissions },
    };
  }
}

/**
 * Managed Service Lasso workspaces source backed by the registry store.
 */
export class WorkspaceRegistrySourceProvider {
  /**
   * @param {WorkspaceRegistryStore} store
   */
  constructor(store) {
    this.id = SERVICE_LASSO_WORKSPACES_SOURCE_ID;
    this.name = "Service Lasso workspaces";
    this.type = SERVICE_LASSO_WORKSPACES_SOURCE_ID;
    this.root = null;
    this.store = store;
  }

  /**
   * Loads the workspace registry without exposing unapproved paths.
   *
   * @returns {Promise<void>}
   */
  async ensureRoot() {
    await this.store.ensureRoot();
  }

  /**
   * @returns {Promise<object>}
   */
  async describeSources() {
    return this.store.describeSources();
  }

  /**
   * Reports one logical source whose roots inherit registry read/write flags.
   *
   * @param {{ defaultSource?: boolean }} [options]
   * @returns {object}
   */
  toJSON({ defaultSource = false } = {}) {
    const entries = Array.isArray(this.store.lastLoad?.entries) ? this.store.lastLoad.entries : [];
    const roots =
      entries.length > 0
        ? entries.map((entry) => ({
            id: entry.rootId,
            name: entry.label,
            sourceId: this.id,
            serviceId: entry.serviceId,
            permissions: permissionsForWritable(Boolean(entry.writable)),
          }))
        : [
            {
              id: ROOT_ID,
              name: this.name,
              sourceId: this.id,
              permissions: { ...FULL_ACCESS_PERMISSIONS },
            },
          ];

    return {
      id: this.id,
      name: this.name,
      type: this.type,
      default: defaultSource,
      roots,
    };
  }

  /**
   * @returns {Promise<object[]>}
   */
  async list() {
    return (await this.store.list()).map((item) => this.withSourceMetadata(item));
  }

  /**
   * @param {string} name
   * @param {string | null} parentId
   * @returns {Promise<object>}
   */
  async createFolder(name, parentId) {
    return this.withSourceMetadata(await this.store.createFolder(name, parentId));
  }

  /**
   * @param {Express.Multer.File | undefined} file
   * @param {string | null} parentId
   * @returns {Promise<object>}
   */
  async writeFile(file, parentId) {
    return this.withSourceMetadata(await this.store.writeFile(file, parentId));
  }

  /**
   * @param {string[] | string | undefined} ids
   * @returns {Promise<void>}
   */
  async delete(ids) {
    return this.store.delete(ids);
  }

  /**
   * @param {string} id
   * @param {string} newName
   * @returns {Promise<object>}
   */
  async rename(id, newName) {
    return this.withSourceMetadata(await this.store.rename(id, newName));
  }

  /**
   * @param {string[] | string | undefined} sourceIds
   * @param {string | null} destinationId
   * @returns {Promise<void>}
   */
  async copy(sourceIds, destinationId) {
    return this.store.copy(sourceIds, destinationId);
  }

  /**
   * @param {string[] | string | undefined} sourceIds
   * @param {string | null} destinationId
   * @returns {Promise<void>}
   */
  async move(sourceIds, destinationId) {
    return this.store.move(sourceIds, destinationId);
  }

  /**
   * @param {string[] | string | undefined} ids
   * @param {import("express").Response} response
   * @returns {Promise<void>}
   */
  async sendDownload(ids, response) {
    return this.store.sendDownload(ids, response);
  }

  /**
   * Workspace ids are not filesystem-relative; refuse direct path resolution.
   *
   * @param {string} [_relativePath]
   * @returns {never}
   */
  resolve(_relativePath = "") {
    return this.store.resolve();
  }

  /**
   * @returns {never}
   */
  legacyList() {
    return this.store.legacyList();
  }

  /**
   * Adds permission metadata while keeping archive UI fields (`serviceId`, `rootId`).
   *
   * @param {object} item
   * @returns {object}
   */
  withSourceMetadata(item) {
    const writable = !item.readOnly && item.mode !== "read-only";
    return {
      ...item,
      sourceId: this.id,
      sourceRootId: item.rootId || ROOT_ID,
      permissions: permissionsForWritable(item.virtual && !item.rootId ? false : writable),
    };
  }
}

/**
 * Builds the process-wide source registry.
 *
 * Standalone mode keeps a single `local-data-root` source on `FILES_DATA_PATH`.
 * Managed registry mode adds `service-lasso-workspaces` and still keeps
 * `local-data-root` available. A workspace path env without a registry uses a
 * local provider for that same stable source id.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.packageRoot]
 * @returns {{
 *   dataRoot: string,
 *   defaultSourceId: string,
 *   defaultSource: FileSourceProvider,
 *   localDataRoot: LocalFileSourceProvider,
 *   listSources: () => object[],
 *   getSource: (sourceId?: string) => FileSourceProvider,
 * }}
 */
export function createFileSourceRegistry({ env = process.env, packageRoot } = {}) {
  const fallbackDataRoot = packageRoot ? path.join(packageRoot, "data") : path.resolve("data");
  const dataRoot = path.resolve(env.FILES_DATA_PATH || env.SERVICE_DATA_PATH || fallbackDataRoot);
  const workspaceRoot = env.FILES_SERVICE_LASSO_WORKSPACES_PATH || env.SERVICE_LASSO_WORKSPACE_ROOT;
  /** @type {FileSourceProvider[]} */
  const providers = [
    new LocalFileSourceProvider({
      id: LOCAL_DATA_ROOT_SOURCE_ID,
      name: "Local data root",
      root: dataRoot,
    }),
  ];

  if (shouldUseWorkspaceStore(env)) {
    providers.push(new WorkspaceRegistrySourceProvider(new WorkspaceRegistryStore({ env })));
  } else if (workspaceRoot) {
    providers.push(
      new LocalFileSourceProvider({
        id: SERVICE_LASSO_WORKSPACES_SOURCE_ID,
        name: "Service Lasso workspaces",
        root: workspaceRoot,
        type: SERVICE_LASSO_WORKSPACES_SOURCE_ID,
      }),
    );
  }

  const defaultSourceId =
    env.FILES_DEFAULT_SOURCE_ID ||
    (providers.some((provider) => provider.id === SERVICE_LASSO_WORKSPACES_SOURCE_ID)
      ? SERVICE_LASSO_WORKSPACES_SOURCE_ID
      : LOCAL_DATA_ROOT_SOURCE_ID);
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const defaultSource = byId.get(defaultSourceId);
  const localDataRoot = byId.get(LOCAL_DATA_ROOT_SOURCE_ID);

  if (!defaultSource || !localDataRoot) {
    throw statusError(`Default file source is not registered: ${defaultSourceId}`, 500);
  }

  return {
    dataRoot,
    defaultSourceId,
    defaultSource,
    localDataRoot,
    listSources() {
      return providers.map((provider) => provider.toJSON({ defaultSource: provider.id === defaultSourceId }));
    },
    getSource(sourceId) {
      const id = sourceId || defaultSourceId;
      const source = byId.get(id);
      if (!source) {
        throw statusError(`Unknown file source: ${id}`, 400);
      }
      return source;
    },
  };
}
