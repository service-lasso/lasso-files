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

  const folderResponse = await expectStatus(
    await fetch(`${baseUrl}/api/file-system/folder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "docs", parentId: null }),
    }),
    201,
    "create folder",
  );
  const folder = await folderResponse.json();

  const form = new FormData();
  form.append("parentId", folder._id);
  form.append("file", new Blob(["hello files"], { type: "text/plain" }), "hello.txt");
  const uploadResponse = await expectStatus(
    await fetch(`${baseUrl}/api/file-system/upload`, { method: "POST", body: form }),
    201,
    "upload file",
  );
  const uploaded = await uploadResponse.json();

  const list = await (await expectStatus(await fetch(`${baseUrl}/api/file-system`), 200, "list")).json();
  if (!list.some((item) => item._id === uploaded._id && item.parentId === folder._id)) {
    throw new Error("uploaded file was not present in list output");
  }

  const download = await expectStatus(
    await fetch(`${baseUrl}/api/file-system/download?files=${encodeURIComponent(uploaded._id)}`),
    200,
    "download file",
  );
  if ((await download.text()) !== "hello files") {
    throw new Error("downloaded file content did not match upload");
  }

  const rename = await expectStatus(
    await fetch(`${baseUrl}/api/file-system/rename`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: uploaded._id, newName: "renamed.txt" }),
    }),
    200,
    "rename file",
  );
  const renamed = (await rename.json()).item;

  await expectStatus(
    await fetch(`${baseUrl}/api/file-system`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [renamed._id, folder._id] }),
    }),
    200,
    "delete items",
  );

  await expectStatus(await fetch(`${baseUrl}/api/options?type=GET_FILE_MAXSIZE`, { method: "PUT" }), 200, "legacy options");
  console.log(`[lasso-files] verified package and API lifecycle on port ${verifyPort}`);
} finally {
  child.kill("SIGTERM");
}
