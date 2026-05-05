import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageFiles } from "./package.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serviceVersion = process.env.FILES_SERVICE_VERSION ?? "1.0.0";
const targetPlatform = process.env.TARGET_PLATFORM ?? process.platform;
const verifyPort = Number(process.env.VERIFY_PORT ?? 18199);

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
