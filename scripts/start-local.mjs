import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

process.env.FILES_PORT ??= "8199";
process.env.FILES_DATA_PATH ??= path.join(repoRoot, "data");

console.log(
  `[lasso-files] starting local server on port ${process.env.FILES_PORT} with data path ${process.env.FILES_DATA_PATH}`,
);

await import("../src/server.mjs");
