import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stat } from "node:fs/promises";
import { FileStore } from "./file-store.mjs";
import { normalizeRelativePath } from "./path-ids.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot =
  [path.join(packageRoot, "public"), path.join(packageRoot, "build", "public")].find((candidate) =>
    existsSync(path.join(candidate, "index.html")),
  ) ?? null;
const dataRoot = path.resolve(
  process.env.FILES_DATA_PATH || process.env.SERVICE_DATA_PATH || path.join(packageRoot, "data"),
);
const port = Number(process.env.SERVICE_PORT || process.env.FILES_PORT || process.env.PORT || 8199);
const maxUploadMb = Number(process.env.FILES_MAXSIZE_MB || process.env.FM_MAXSIZE || 300);

const store = new FileStore(dataRoot);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxUploadMb * 1024 * 1024,
  },
});

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "2mb" }));

if (publicRoot) {
  app.use(express.static(publicRoot, { index: false }));
}

app.get("/healthcheck", async (_request, response) => {
  await store.ensureRoot();
  response.json({
    status: "ok",
    service: "files",
    dataRoot,
  });
});

app.get("/api/file-system", async (_request, response) => {
  response.json(await store.list());
});

app.post("/api/file-system/folder", async (request, response) => {
  response.status(201).json(await store.createFolder(request.body?.name, request.body?.parentId));
});

app.post("/api/file-system/upload", upload.single("file"), async (request, response) => {
  response.status(201).json(await store.writeFile(request.file, request.body?.parentId));
});

app.post("/api/file-system/copy", async (request, response) => {
  await store.copy(request.body?.sourceIds, request.body?.destinationId);
  response.json({ message: "Item(s) copied successfully!" });
});

app.put("/api/file-system/move", async (request, response) => {
  await store.move(request.body?.sourceIds, request.body?.destinationId);
  response.json({ message: "Item(s) moved successfully!" });
});

app.patch("/api/file-system/rename", async (request, response) => {
  const item = await store.rename(request.body?.id, request.body?.newName);
  response.json({ message: "File or Folder renamed successfully!", item });
});

app.delete("/api/file-system", async (request, response) => {
  await store.delete(request.body?.ids);
  response.json({ message: "File(s) or Folder(s) deleted successfully." });
});

app.get("/api/file-system/download", async (request, response) => {
  await store.sendDownload(request.query.files, response);
});

app.use("/content", express.static(dataRoot, { fallthrough: false }));

app.get(["/", "/files"], (_request, response) => {
  if (!publicRoot) {
    response.status(503).json({
      error: "UI assets are missing. Run npm run build:ui before starting from source.",
    });
    return;
  }
  response.sendFile(path.join(publicRoot, "index.html"));
});

app.get("/api/*event", (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.write("retry: 2000\nid: 0\ndata: {\"files\":{}}\n\n");
  request.on("close", () => response.end());
});

app.put("/api/options", (request, response) => {
  const type = request.query.type;
  if (type === "GET_SHOW_ALL_FILES") {
    response.json(true);
    return;
  }
  if (type === "TOGGLE_SHOW_ALL_FILES" || type === "SHOW_ALL_FILES_ON" || type === "SHOW_ALL_FILES_OFF") {
    response.json(true);
    return;
  }
  if (type === "GET_FILE_FILTER") {
    response.json({ file: process.env.FILES_FILTER || "", mime: process.env.FILES_MIMEFILTER || "" });
    return;
  }
  if (type === "GET_FILE_MAXSIZE") {
    response.json(maxUploadMb * 1024 * 1024);
    return;
  }
  response.status(400).send("Arg type error!");
});

app.get("/api/*", async (request, response) => {
  const relativePath = normalizeRelativePath(request.params[0] || "");
  const absolute = store.resolve(relativePath);
  const stats = await stat(absolute);
  if (stats.isDirectory()) {
    response.json(await store.legacyList(relativePath));
    return;
  }
  response.download(absolute, path.basename(relativePath));
});

app.delete("/api/*", async (request, response) => {
  const relativePath = normalizeRelativePath(request.params[0] || "");
  await store.delete([Buffer.from(relativePath, "utf8").toString("base64url")]);
  response.send("Deleting successful!");
});

app.post("/api/*", upload.single("file"), async (request, response) => {
  const relativePath = normalizeRelativePath(request.params[0] || "");
  const type = request.query.type;
  if (type === "CREATE_FOLDER") {
    const parent = path.posix.dirname(relativePath);
    const name = path.posix.basename(relativePath);
    const parentId = parent === "." ? null : Buffer.from(parent, "utf8").toString("base64url");
    await store.createFolder(name, parentId);
    response.send("Creating folder successful!");
    return;
  }

  response.status(400).send("Arg type error!");
});

app.use((error, _request, response, _next) => {
  const status = error.status || error.statusCode || 500;
  response.status(status).json({ error: error.message || "Internal server error" });
});

await store.ensureRoot();
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`[lasso-files] listening on ${port}, data root ${dataRoot}`);
});

function stop() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
