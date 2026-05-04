import { spawnSync } from "node:child_process";
import { rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(repoRoot, "output", "e2e-data");

await rm(dataRoot, { recursive: true, force: true });
await mkdir(dataRoot, { recursive: true });

const viteBin = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const build = spawnSync(
  process.execPath,
  [viteBin, "build", "frontend", "--outDir", "../build/public", "--emptyOutDir"],
  {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
  },
);

if (build.status !== 0) {
  throw build.error ?? new Error(`vite build failed with exit code ${build.status}`);
}

process.env.FILES_PORT = process.env.E2E_PORT ?? "18200";
process.env.FILES_DATA_PATH = dataRoot;

await import("../src/server.mjs");
