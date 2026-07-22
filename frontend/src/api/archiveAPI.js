const ARCHIVE_API_URL = import.meta.env.VITE_ARCHIVE_API_URL || "/api/file-export/archive";
const WORKSPACE_SOURCE_ID = "service-lasso-workspaces";

export async function archiveSelectionAPI(files) {
  const source = buildArchiveSource(files);
  const response = await fetch(ARCHIVE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source }),
  });
  const data = await readResponseBody(response);

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Archive request failed with HTTP ${response.status}.`);
  }

  return data;
}

export function buildArchiveSource(files) {
  const selectedFiles = Array.isArray(files) ? files : [];
  if (selectedFiles.length === 0) {
    throw new Error("Select files or folders to archive.");
  }

  const decoded = selectedFiles.map((file) => ({ file, workspaceId: decodeWorkspaceId(file?._id) }));
  const first = decoded[0];
  const sourceId = first.file.sourceId;
  const serviceId = first.file.serviceId || first.workspaceId?.serviceId;
  const rootId = first.file.rootId || first.workspaceId?.rootId;

  if (sourceId !== WORKSPACE_SOURCE_ID || !serviceId || !rootId) {
    throw new Error("Archive is available for Service workspace files only.");
  }

  const paths = decoded.map(({ file, workspaceId }) => {
    if (file.sourceId !== sourceId || (file.serviceId || workspaceId?.serviceId) !== serviceId || (file.rootId || workspaceId?.rootId) !== rootId) {
      throw new Error("Archive selection must stay within one service workspace root.");
    }
    if (workspaceId && !["item", "root"].includes(workspaceId.kind)) {
      throw new Error("Archive selection must identify workspace files by source id.");
    }
    return relativePathFromWorkspaceFile(file, workspaceId);
  });

  return {
    type: "file-selection",
    sourceId,
    serviceId,
    rootId,
    paths,
    archiveFormat: "7z",
  };
}

function relativePathFromWorkspaceFile(file, workspaceId) {
  if (workspaceId) {
    return workspaceId.relativePath || "";
  }

  const pathSegments = String(file?.path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean);
  if (pathSegments.length <= 2) {
    return "";
  }
  return pathSegments.slice(2).join("/");
}

function decodeWorkspaceId(id) {
  if (!id || typeof id !== "string" || !id.startsWith("workspace:")) {
    return null;
  }

  try {
    const base64 = id.slice("workspace:".length).replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(window.atob(padded));
  } catch {
    return null;
  }
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
