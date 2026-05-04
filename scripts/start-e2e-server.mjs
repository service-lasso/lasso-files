import { rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(repoRoot, "output", "e2e-data");

await rm(dataRoot, { recursive: true, force: true });
await mkdir(dataRoot, { recursive: true });

process.env.FILES_PORT = process.env.E2E_PORT ?? "18200";
process.env.FILES_DATA_PATH = dataRoot;

await import("../src/server.mjs");
