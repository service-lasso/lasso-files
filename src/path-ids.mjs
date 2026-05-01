import { Buffer } from "node:buffer";
import path from "node:path";

export const ROOT_ID = "root";

export function normalizeRelativePath(input = "") {
  const raw = String(input || "").replaceAll("\\", "/");
  const withoutLeadingSlash = raw.replace(/^\/+/, "");
  const normalized = path.posix.normalize(`/${withoutLeadingSlash}`);

  if (normalized === "/" || normalized === ".") {
    return "";
  }

  if (normalized.includes("..")) {
    const error = new Error("Path traversal is not allowed.");
    error.status = 400;
    throw error;
  }

  return normalized.replace(/^\/+/, "");
}

export function publicPath(relativePath = "") {
  const normalized = normalizeRelativePath(relativePath);
  return normalized ? `/${normalized}` : "/";
}

export function idFromRelativePath(relativePath = "") {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) {
    return ROOT_ID;
  }

  return Buffer.from(normalized, "utf8").toString("base64url");
}

export function relativePathFromId(id) {
  if (!id || id === ROOT_ID) {
    return "";
  }

  try {
    return normalizeRelativePath(Buffer.from(String(id), "base64url").toString("utf8"));
  } catch {
    const error = new Error("Invalid file id.");
    error.status = 400;
    throw error;
  }
}

export function assertSafeName(name) {
  const value = String(name || "").trim();
  if (!value || value.includes("/") || value.includes("\\") || value === "." || value === "..") {
    const error = new Error("Name must be a single file or folder segment.");
    error.status = 400;
    throw error;
  }

  return value;
}
