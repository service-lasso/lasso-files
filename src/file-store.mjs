import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import archiver from "archiver";
import mime from "mime-types";
import {
  assertSafeName,
  idFromRelativePath,
  normalizeRelativePath,
  publicPath,
  relativePathFromId,
  ROOT_ID,
} from "./path-ids.mjs";

export class FileStore {
  constructor(root) {
    this.root = path.resolve(root);
  }

  async ensureRoot() {
    await fs.mkdir(this.root, { recursive: true });
  }

  resolve(relativePath = "") {
    const normalized = normalizeRelativePath(relativePath);
    const absolute = path.resolve(this.root, normalized);
    if (absolute !== this.root && !absolute.startsWith(`${this.root}${path.sep}`)) {
      const error = new Error("Resolved path escaped the data root.");
      error.status = 400;
      throw error;
    }
    return absolute;
  }

  async itemFromRelativePath(relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    const absolute = this.resolve(normalized);
    const stats = await fs.stat(absolute);
    const name = normalized ? path.basename(normalized) : "Files";
    const parentRelative = normalized ? path.posix.dirname(normalized.replaceAll("\\", "/")) : "";
    const parentId = normalized && parentRelative !== "." ? idFromRelativePath(parentRelative) : null;

    return {
      _id: idFromRelativePath(normalized),
      name,
      isDirectory: stats.isDirectory(),
      path: publicPath(normalized),
      parentId,
      size: stats.isDirectory() ? null : stats.size,
      mimeType: stats.isDirectory() ? null : mime.lookup(name) || "application/octet-stream",
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString(),
    };
  }

  async list() {
    await this.ensureRoot();
    const results = [];

    const walk = async (relativePath = "") => {
      const absolute = this.resolve(relativePath);
      const entries = await fs.readdir(absolute, { withFileTypes: true });
      for (const entry of entries) {
        const childRelative = normalizeRelativePath(path.posix.join(relativePath.replaceAll("\\", "/"), entry.name));
        results.push(await this.itemFromRelativePath(childRelative));
        if (entry.isDirectory()) {
          await walk(childRelative);
        }
      }
    };

    await walk("");
    return results;
  }

  async createFolder(name, parentId) {
    await this.ensureRoot();
    const parentRelative = relativePathFromId(parentId);
    const folderRelative = normalizeRelativePath(path.posix.join(parentRelative, assertSafeName(name)));
    const absolute = this.resolve(folderRelative);
    await assertMissing(absolute);
    await fs.mkdir(absolute, { recursive: false });
    return this.itemFromRelativePath(folderRelative);
  }

  async writeFile(file, parentId) {
    await this.ensureRoot();
    if (!file) {
      const error = new Error("Missing uploaded file.");
      error.status = 400;
      throw error;
    }

    const parentRelative = relativePathFromId(parentId);
    const fileRelative = normalizeRelativePath(path.posix.join(parentRelative, assertSafeName(file.originalname)));
    const absolute = this.resolve(fileRelative);
    await assertMissing(absolute);
    await fs.writeFile(absolute, file.buffer);
    return this.itemFromRelativePath(fileRelative);
  }

  async delete(ids) {
    for (const id of arrayValue(ids)) {
      const relativePath = relativePathFromId(id);
      if (!relativePath) {
        const error = new Error("The root folder cannot be deleted.");
        error.status = 400;
        throw error;
      }
      await fs.rm(this.resolve(relativePath), { recursive: true, force: false });
    }
  }

  async rename(id, newName) {
    const sourceRelative = relativePathFromId(id);
    if (!sourceRelative) {
      const error = new Error("The root folder cannot be renamed.");
      error.status = 400;
      throw error;
    }

    const parentRelative = path.posix.dirname(sourceRelative);
    const targetRelative = normalizeRelativePath(path.posix.join(parentRelative === "." ? "" : parentRelative, assertSafeName(newName)));
    const targetAbsolute = this.resolve(targetRelative);
    await assertMissing(targetAbsolute);
    await fs.rename(this.resolve(sourceRelative), targetAbsolute);
    return this.itemFromRelativePath(targetRelative);
  }

  async copy(sourceIds, destinationId) {
    const destinationRelative = relativePathFromId(destinationId);
    const destinationAbsolute = this.resolve(destinationRelative);
    await assertDirectory(destinationAbsolute);

    for (const id of arrayValue(sourceIds)) {
      const sourceRelative = relativePathFromId(id);
      const targetRelative = normalizeRelativePath(path.posix.join(destinationRelative, path.basename(sourceRelative)));
      const targetAbsolute = this.resolve(targetRelative);
      await assertMissing(targetAbsolute);
      await fs.cp(this.resolve(sourceRelative), targetAbsolute, { recursive: true, errorOnExist: true });
    }
  }

  async move(sourceIds, destinationId) {
    const destinationRelative = relativePathFromId(destinationId);
    const destinationAbsolute = this.resolve(destinationRelative);
    await assertDirectory(destinationAbsolute);

    for (const id of arrayValue(sourceIds)) {
      const sourceRelative = relativePathFromId(id);
      const targetRelative = normalizeRelativePath(path.posix.join(destinationRelative, path.basename(sourceRelative)));
      const targetAbsolute = this.resolve(targetRelative);
      await assertMissing(targetAbsolute);
      await fs.rename(this.resolve(sourceRelative), targetAbsolute);
    }
  }

  async sendDownload(ids, response) {
    const sourceIds = arrayValue(ids);
    if (!sourceIds.length) {
      const error = new Error("At least one file id is required.");
      error.status = 400;
      throw error;
    }

    if (sourceIds.length === 1) {
      const relativePath = relativePathFromId(sourceIds[0]);
      const absolute = this.resolve(relativePath);
      const stats = await fs.stat(absolute);
      if (!stats.isDirectory()) {
        response.download(absolute, path.basename(relativePath));
        return;
      }
    }

    response.attachment("files.zip");
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (error) => response.destroy(error));
    archive.pipe(response);

    for (const id of sourceIds) {
      const relativePath = relativePathFromId(id);
      const absolute = this.resolve(relativePath);
      const stats = await fs.stat(absolute);
      const name = path.basename(relativePath) || "files";
      if (stats.isDirectory()) {
        archive.directory(absolute, name);
      } else {
        archive.file(absolute, { name });
      }
    }

    await archive.finalize();
  }

  async legacyList(relativePath) {
    const absolute = this.resolve(relativePath);
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    return Promise.all(
      entries.map(async (entry) => {
        const childAbsolute = path.join(absolute, entry.name);
        const stats = await fs.stat(childAbsolute);
        return {
          name: entry.name,
          folder: stats.isDirectory(),
          size: stats.size,
          mtime: stats.mtime.getTime(),
        };
      }),
    );
  }

  readStream(relativePath) {
    return createReadStream(this.resolve(relativePath));
  }
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
  const error = new Error("A file or folder already exists at that path.");
  error.status = 400;
  throw error;
}

async function assertDirectory(absolute) {
  const stats = await fs.stat(absolute);
  if (!stats.isDirectory()) {
    const error = new Error("Destination must be a folder.");
    error.status = 400;
    throw error;
  }
}

export { ROOT_ID };
