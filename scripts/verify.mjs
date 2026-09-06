import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFileSourceRegistry,
  isInsideApprovedRoot,
  LOCAL_DATA_ROOT_SOURCE_ID,
  SERVICE_LASSO_WORKSPACES_SOURCE_ID,
} from "../src/file-sources.mjs";
import { packageFiles } from "./package.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serviceVersion = process.env.FILES_SERVICE_VERSION ?? "1.0.0";
const targetPlatform = process.env.TARGET_PLATFORM ?? process.platform;
const verifyPort = Number(process.env.VERIFY_PORT ?? 18199);

async function verifyServiceManifest() {
  const manifestPath = path.join(repoRoot, "service.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const endpointIds = new Set((manifest.endpoints ?? []).map((endpoint) => endpoint.id));
  for (const requiredEndpoint of ["web", "base_url", "ui", "health"]) {
    if (!endpointIds.has(requiredEndpoint)) {
      throw new Error(`service.json missing required endpoint: ${requiredEndpoint}`);
    }
  }
  if (manifest.execconfig?.env?.FILES_PORT !== "${endpoint.web.port}") {
    throw new Error("FILES_PORT must use the canonical web endpoint selector");
  }
  if (manifest.execconfig?.env?.FILES_URL !== "${endpoint.base_url.url}") {
    throw new Error("FILES_URL must use the canonical base URL endpoint selector");
  }
  if (manifest.execconfig?.healthcheck) {
    throw new Error("service.json must not use singular execconfig.healthcheck");
  }
  const healthchecks = manifest.healthchecks;
  if (!Array.isArray(healthchecks) || healthchecks.length !== 1) {
    throw new Error("service.json must declare exactly one top-level healthchecks[] item");
  }
  const [httpHealthcheck] = healthchecks;
  if (httpHealthcheck.id !== "files-http-health") {
    throw new Error("healthchecks[] item must have a stable files-http-health id");
  }
  if (httpHealthcheck.type !== "http" || httpHealthcheck.url !== "${endpoint.health.url}") {
    throw new Error("healthchecks[] must use the canonical health endpoint selector");
  }
  if (httpHealthcheck.expected_status !== 200 || httpHealthcheck.retries !== 180 || httpHealthcheck.interval !== 500) {
    throw new Error(`unexpected healthchecks[] readiness settings: ${JSON.stringify(httpHealthcheck)}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function archiveName(platform) {
  const ext = platform === "win32" ? "zip" : "tar.gz";
  return `lasso-files-${serviceVersion}-${platform}.${ext}`;
}

async function extractArchive(archivePath, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  if (archivePath.endsWith(".zip")) {
    run("powershell", [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(destination)} -Force`,
    ]);
    return;
  }

  run("tar", ["-xzf", archivePath, "-C", destination]);
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthcheck`);
      if (response.status === 200) {
        return;
      }
      lastError = new Error(`expected 200, got ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError ?? new Error("healthcheck timed out");
}

async function expectStatus(response, status, label) {
  if (response.status !== status) {
    throw new Error(`${label} expected ${status}, got ${response.status}: ${await response.text()}`);
  }
  return response;
}

async function jsonRequest(baseUrl, route, options, status, label) {
  const response = await expectStatus(await fetch(`${baseUrl}${route}`, options), status, label);
  return response.json();
}

async function listItems(baseUrl) {
  return jsonRequest(baseUrl, "/api/file-system", undefined, 200, "list");
}

function expectItem(items, predicate, label) {
  const item = items.find(predicate);
  if (!item) {
    throw new Error(`${label} was not present in list output`);
  }
  return item;
}

function expectFileSourceRegistry() {
  const standaloneRegistry = createFileSourceRegistry({
    packageRoot: repoRoot,
    env: {
      FILES_DATA_PATH: path.join(repoRoot, "output", "provider-check", "data"),
    },
  });
  if (standaloneRegistry.defaultSourceId !== LOCAL_DATA_ROOT_SOURCE_ID) {
    throw new Error(`standalone default source changed: ${standaloneRegistry.defaultSourceId}`);
  }
  if (!standaloneRegistry.listSources().some((source) => source.id === LOCAL_DATA_ROOT_SOURCE_ID && source.default)) {
    throw new Error("standalone local data root source was not registered as default");
  }

  const workspaceRegistry = createFileSourceRegistry({
    packageRoot: repoRoot,
    env: {
      FILES_DATA_PATH: path.join(repoRoot, "output", "provider-check", "data"),
      SERVICE_LASSO_WORKSPACE_ROOT: path.join(repoRoot, "output", "provider-check", "workspaces"),
    },
  });
  if (workspaceRegistry.defaultSourceId !== SERVICE_LASSO_WORKSPACES_SOURCE_ID) {
    throw new Error(`managed default source changed: ${workspaceRegistry.defaultSourceId}`);
  }
  const workspaceSource = workspaceRegistry.listSources().find((source) => source.id === SERVICE_LASSO_WORKSPACES_SOURCE_ID);
  if (!workspaceSource?.roots?.[0]?.permissions?.canWrite || !workspaceSource.roots[0].permissions.canRemove) {
    throw new Error(`workspace source permissions were not reported: ${JSON.stringify(workspaceSource)}`);
  }
  if (!workspaceRegistry.listSources().some((source) => source.id === LOCAL_DATA_ROOT_SOURCE_ID)) {
    throw new Error("managed registry dropped local-data-root");
  }

  const confinedRoot = path.join(repoRoot, "output", "provider-check", "data");
  const escapedSibling = path.join(repoRoot, "output", "provider-check", "outside.txt");
  if (isInsideApprovedRoot(confinedRoot, escapedSibling)) {
    throw new Error("isInsideApprovedRoot allowed a path outside the approved root");
  }
  if (!isInsideApprovedRoot(confinedRoot, path.join(confinedRoot, "nested", "file.txt"))) {
    throw new Error("isInsideApprovedRoot rejected a path inside the approved root");
  }

  try {
    standaloneRegistry.getSource("not-a-registered-source");
    throw new Error("getSource did not reject an unknown source id");
  } catch (error) {
    if (!(error instanceof Error) || error.status !== 400) {
      throw error;
    }
  }

  const resolvedInsideRoot = standaloneRegistry.defaultSource.resolve("../outside.txt");
  if (!isInsideApprovedRoot(confinedRoot, resolvedInsideRoot)) {
    throw new Error("source resolve escaped the approved root");
  }
}

expectFileSourceRegistry();
const archivePath = await packageFiles(targetPlatform, serviceVersion);
const expectedArchive = path.join(repoRoot, "dist", archiveName(targetPlatform));
if (archivePath !== expectedArchive || !existsSync(expectedArchive)) {
  throw new Error(`expected archive was not created: ${expectedArchive}`);
}

const extractRoot = path.join(repoRoot, "output", "verify", targetPlatform);
const dataRoot = path.join(repoRoot, "output", "verify-data", targetPlatform);
await extractArchive(expectedArchive, extractRoot);
await rm(dataRoot, { recursive: true, force: true });
await mkdir(dataRoot, { recursive: true });

const child = spawn(process.execPath, [path.join(extractRoot, "src", "server.mjs")], {
  cwd: extractRoot,
  env: {
    ...process.env,
    SERVICE_PORT: String(verifyPort),
    FILES_PORT: String(verifyPort),
    FILES_DATA_PATH: dataRoot,
  },
  stdio: "inherit",
});

const baseUrl = `http://127.0.0.1:${verifyPort}`;

try {
  await waitForHealth(baseUrl);
  const ui = await expectStatus(await fetch(`${baseUrl}/files`), 200, "ui");
  const uiHtml = await ui.text();
  const assetMatch = uiHtml.match(/src="(\/assets\/[^"]+\.js)"/);
  if (!assetMatch) {
    throw new Error("ui did not reference a built JavaScript asset");
  }
  const asset = await expectStatus(await fetch(`${baseUrl}${assetMatch[1]}`), 200, "ui asset");
  if ((await asset.text()).length < 1000) {
    throw new Error("ui asset response was unexpectedly small");
  }

  const config = await jsonRequest(baseUrl, "/api/config", undefined, 200, "get config");
  if (!config.acceptedFileTypes.includes(".pdf") || config.blockedFileTypes !== "" || config.maxUploadBytes !== 300 * 1024 * 1024) {
    throw new Error(`unexpected config response: ${JSON.stringify(config)}`);
  }

  const sourceConfig = await jsonRequest(baseUrl, "/api/file-sources", undefined, 200, "get file sources");
  if (sourceConfig.defaultSourceId !== LOCAL_DATA_ROOT_SOURCE_ID) {
    throw new Error(`unexpected default file source: ${JSON.stringify(sourceConfig)}`);
  }
  const localSource = sourceConfig.sources.find((source) => source.id === LOCAL_DATA_ROOT_SOURCE_ID);
  if (!localSource?.roots?.[0]?.permissions?.canUpload || !localSource.roots[0].permissions.canRemove) {
    throw new Error(`local data root did not report expected permissions: ${JSON.stringify(sourceConfig)}`);
  }
  await expectStatus(
    await fetch(`${baseUrl}/api/file-system?sourceId=${encodeURIComponent("not-a-registered-source")}`),
    400,
    "reject unknown source id",
  );

  const updatedConfig = await jsonRequest(
    baseUrl,
    "/api/config",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowedExtensions: ["txt", ".pdf"], blockedExtensions: [] }),
    },
    200,
    "update allowed file config",
  );
  if (updatedConfig.acceptedFileTypes !== ".txt, .pdf" || updatedConfig.blockedFileTypes !== "") {
    throw new Error(`allowed extensions were not normalized: ${JSON.stringify(updatedConfig)}`);
  }

  const blockedForm = new FormData();
  blockedForm.append("file", new Blob(["blocked"], { type: "application/octet-stream" }), "blocked.exe");
  await expectStatus(
    await fetch(`${baseUrl}/api/file-system/upload`, { method: "POST", body: blockedForm }),
    400,
    "reject disallowed upload",
  );

  const allowAllExceptExeConfig = await jsonRequest(
    baseUrl,
    "/api/config",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowedExtensions: "*", blockedExtensions: ["exe", ".bat"] }),
    },
    200,
    "update blocked file config",
  );
  if (!allowAllExceptExeConfig.allowAllFiles || allowAllExceptExeConfig.blockedFileTypes !== ".exe, .bat") {
    throw new Error(`blocked extensions were not normalized: ${JSON.stringify(allowAllExceptExeConfig)}`);
  }

  const blockedByDenyListForm = new FormData();
  blockedByDenyListForm.append("file", new Blob(["blocked"], { type: "application/octet-stream" }), "blocked.exe");
  await expectStatus(
    await fetch(`${baseUrl}/api/file-system/upload`, { method: "POST", body: blockedByDenyListForm }),
    400,
    "reject blocked upload when allow all",
  );

  const allowedByWildcardForm = new FormData();
  allowedByWildcardForm.append("file", new Blob(["allowed"], { type: "application/octet-stream" }), "allowed.customtype");
  const wildcardUpload = await jsonRequest(
    baseUrl,
    "/api/file-system/upload",
    { method: "POST", body: allowedByWildcardForm },
    201,
    "allow wildcard upload",
  );

  const docs = await jsonRequest(
    baseUrl,
    "/api/file-system/folder",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "docs", parentId: null }),
    },
    201,
    "create folder",
  );
  const archive = await jsonRequest(
    baseUrl,
    "/api/file-system/folder",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "archive", parentId: null }),
    },
    201,
    "create destination folder",
  );
  const nested = await jsonRequest(
    baseUrl,
    "/api/file-system/folder",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "nested", parentId: docs._id }),
    },
    201,
    "create nested folder",
  );

  const form = new FormData();
  form.append("parentId", docs._id);
  form.append("file", new Blob(["hello files"], { type: "text/plain" }), "hello.txt");
  const uploaded = await jsonRequest(
    baseUrl,
    "/api/file-system/upload",
    { method: "POST", body: form },
    201,
    "upload file",
  );

  let list = await listItems(baseUrl);
  expectItem(list, (item) => item._id === wildcardUpload._id && item.name === "allowed.customtype", "wildcard upload");
  expectItem(list, (item) => item._id === uploaded._id && item.parentId === docs._id, "uploaded file");
  expectItem(list, (item) => item._id === nested._id && item.parentId === docs._id, "nested folder");
  expectItem(
    list,
    (item) => item._id === uploaded._id && item.sourceId === LOCAL_DATA_ROOT_SOURCE_ID && item.permissions?.canDownload,
    "uploaded file source metadata",
  );

  const download = await expectStatus(
    await fetch(`${baseUrl}/api/file-system/download?files=${encodeURIComponent(uploaded._id)}`),
    200,
    "download file",
  );
  if ((await download.text()) !== "hello files") {
    throw new Error("downloaded file content did not match upload");
  }

  const rename = await jsonRequest(
    baseUrl,
    "/api/file-system/rename",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: uploaded._id, newName: "renamed.txt" }),
    },
    200,
    "rename file",
  );
  const renamed = rename.item;

  await expectStatus(
    await fetch(`${baseUrl}/api/file-system/move`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceIds: [renamed._id], destinationId: archive._id }),
    }),
    200,
    "move file",
  );
  list = await listItems(baseUrl);
  const movedFile = expectItem(
    list,
    (item) => item.name === "renamed.txt" && item.parentId === archive._id && item.path === "/archive/renamed.txt",
    "moved file",
  );
  if (list.some((item) => item.path === "/docs/renamed.txt")) {
    throw new Error("moved file was still present in source folder");
  }

  await expectStatus(
    await fetch(`${baseUrl}/api/file-system/copy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceIds: [nested._id], destinationId: archive._id }),
    }),
    200,
    "copy folder",
  );
  list = await listItems(baseUrl);
  expectItem(list, (item) => item.path === "/archive/nested" && item.isDirectory, "copied folder");

  const renameFolder = await jsonRequest(
    baseUrl,
    "/api/file-system/rename",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: docs._id, newName: "documents" }),
    },
    200,
    "rename folder",
  );
  const renamedFolder = renameFolder.item;
  list = await listItems(baseUrl);
  expectItem(list, (item) => item._id === renamedFolder._id && item.path === "/documents", "renamed folder");

  const movedDownload = await expectStatus(
    await fetch(`${baseUrl}/api/file-system/download?files=${encodeURIComponent(movedFile._id)}`),
    200,
    "download moved file",
  );
  if ((await movedDownload.text()) !== "hello files") {
    throw new Error("downloaded moved file content did not match upload");
  }

  await expectStatus(
    await fetch(`${baseUrl}/api/file-system/folder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "bad/name", parentId: null }),
    }),
    400,
    "reject unsafe folder name",
  );

  await expectStatus(
    await fetch(`${baseUrl}/api/file-system`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [archive._id, renamedFolder._id, wildcardUpload._id] }),
    }),
    200,
    "delete items",
  );
  list = await listItems(baseUrl);
  if (list.length > 0) {
    throw new Error(`expected delete cleanup to empty data root, found ${list.length} item(s)`);
  }

  await expectStatus(await fetch(`${baseUrl}/api/options?type=GET_FILE_MAXSIZE`, { method: "PUT" }), 200, "legacy options");
  console.log(`[lasso-files] verified package and API lifecycle on port ${verifyPort}`);
} finally {
  child.kill("SIGTERM");
}

await verifyWorkspaceRegistry(extractRoot, verifyPort + 1);
await verifyServiceManifest();

async function verifyWorkspaceRegistry(extractRoot, port) {
  const workspaceRoot = path.join(repoRoot, "output", "verify-workspaces", targetPlatform);
  const writableRoot = path.join(workspaceRoot, "nginx-workspace");
  const readOnlyRoot = path.join(workspaceRoot, "nginx-config");
  const hiddenRoot = path.join(workspaceRoot, "hidden");
  const registryPath = path.join(workspaceRoot, "registry.json");
  await rm(workspaceRoot, { recursive: true, force: true });
  await mkdir(writableRoot, { recursive: true });
  await mkdir(readOnlyRoot, { recursive: true });
  await mkdir(hiddenRoot, { recursive: true });
  await writeFile(path.join(writableRoot, "index.html"), "<h1>ok</h1>");
  await writeFile(path.join(readOnlyRoot, "nginx.conf"), "events {}");
  await writeFile(
    registryPath,
    JSON.stringify(
      {
        entries: [
          {
            sourceId: "service-lasso-workspaces",
            serviceId: "nginx",
            rootId: "workspace",
            label: "Workspace",
            path: writableRoot,
            mode: "read-write",
          },
          {
            sourceId: "service-lasso-workspaces",
            serviceId: "nginx",
            rootId: "config",
            label: "Config",
            path: readOnlyRoot,
            mode: "read-only",
          },
          {
            sourceId: "service-lasso-workspaces",
            serviceId: "nginx",
            rootId: "hidden",
            label: "Hidden",
            path: hiddenRoot,
            mode: "read-write",
            hidden: true,
          },
        ],
      },
      null,
      2,
    ),
  );

  const child = spawn(process.execPath, [path.join(extractRoot, "src", "server.mjs")], {
    cwd: extractRoot,
    env: {
      ...process.env,
      SERVICE_PORT: String(port),
      FILES_PORT: String(port),
      FILES_SOURCE_PROVIDER: "service-lasso-workspaces",
      FILES_WORKSPACES_REGISTRY_PATH: registryPath,
    },
    stdio: "inherit",
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl);
    const sources = await jsonRequest(baseUrl, "/api/sources", undefined, 200, "workspace sources");
    if (sources.provider !== "service-lasso-workspaces" || sources.status !== "ok" || sources.services.length !== 1) {
      throw new Error(`unexpected workspace source status: ${JSON.stringify(sources)}`);
    }
    if (!Array.isArray(sources.sources) || !sources.sources.some((source) => (source.sourceId || source.id) === "local-data-root")) {
      throw new Error(`managed /api/sources omitted local-data-root: ${JSON.stringify(sources)}`);
    }
    const fileSources = await jsonRequest(baseUrl, "/api/file-sources", undefined, 200, "managed file sources");
    if (fileSources.defaultSourceId !== "service-lasso-workspaces") {
      throw new Error(`managed default source changed: ${JSON.stringify(fileSources)}`);
    }

    const list = await listItems(baseUrl);
    const service = expectItem(list, (item) => item.virtual && item.serviceId === "nginx" && item.path === "/nginx", "service group");
    const workspace = expectItem(
      list,
      (item) => item.virtual && item.rootId === "workspace" && item.mode === "read-write" && item.parentId === service._id,
      "writable workspace root",
    );
    const config = expectItem(
      list,
      (item) => item.virtual && item.rootId === "config" && item.mode === "read-only" && item.readOnly,
      "read-only config root",
    );
    expectItem(list, (item) => item.name === "index.html" && item.parentId === workspace._id, "workspace file");
    expectItem(list, (item) => item.name === "nginx.conf" && item.parentId === config._id && item.readOnly, "read-only file");
    if (list.some((item) => item.rootId === "hidden")) {
      throw new Error("hidden workspace root was exposed");
    }

    await jsonRequest(
      baseUrl,
      "/api/file-system/folder",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "assets", parentId: workspace._id }),
      },
      201,
      "create folder in writable root",
    );
    await expectStatus(
      await fetch(`${baseUrl}/api/file-system/folder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "blocked", parentId: config._id }),
      }),
      403,
      "reject write in read-only root",
    );
    await expectStatus(
      await fetch(`${baseUrl}/api/file-system/rename`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: list.find((item) => item.name === "nginx.conf")._id,
          newName: "renamed.conf",
        }),
      }),
      403,
      "reject rename in read-only root",
    );

    console.log(`[lasso-files] verified Service Lasso workspace provider on port ${port}`);
  } finally {
    child.kill("SIGTERM");
  }
}
