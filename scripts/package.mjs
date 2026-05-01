import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serviceVersion = process.env.FILES_SERVICE_VERSION ?? "1.0.0";
const targetPlatform = process.env.TARGET_PLATFORM ?? process.platform;

const targets = {
  win32: { archiveType: "zip" },
  linux: { archiveType: "tar.gz" },
  darwin: { archiveType: "tar.gz" },
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}: ${result.error?.message ?? "unknown error"}`);
  }
}

function runNpm(args, options = {}) {
  if (process.platform === "win32") {
    run("cmd.exe", ["/d", "/s", "/c", ["npm", ...args].join(" ")], options);
    return;
  }

  run("npm", args, options);
}

function versionedAssetName(version, platform, archiveType) {
  return `lasso-files-${version}-${platform}.${archiveType === "zip" ? "zip" : "tar.gz"}`;
}

async function compressPackage(packageRoot, outputPath, archiveType) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await rm(outputPath, { force: true });

  if (archiveType === "zip") {
    run("powershell", [
      "-NoLogo",
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path ${JSON.stringify(path.join(packageRoot, "*"))} -DestinationPath ${JSON.stringify(outputPath)} -Force`,
    ]);
    return outputPath;
  }

  run("tar", ["-czf", outputPath, "-C", packageRoot, "."]);
  return outputPath;
}

export async function packageFiles(platform = targetPlatform, version = serviceVersion) {
  const target = targets[platform];
  if (!target) {
    throw new Error(`Unsupported target platform: ${platform}. Supported platforms: ${Object.keys(targets).join(", ")}.`);
  }
  if (!existsSync(path.join(repoRoot, "node_modules"))) {
    throw new Error("node_modules is missing. Run npm ci before packaging.");
  }

  runNpm(["run", "build:ui"]);

  const outputRoot = path.join(repoRoot, "output", "package", version, platform);
  const packageRoot = path.join(outputRoot, "payload");
  const outputPath = path.join(repoRoot, "dist", versionedAssetName(version, platform, target.archiveType));

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(packageRoot, { recursive: true });
  await cp(path.join(repoRoot, "src"), path.join(packageRoot, "src"), { recursive: true });
  await cp(path.join(repoRoot, "build", "public"), path.join(packageRoot, "public"), { recursive: true });
  await cp(path.join(repoRoot, "package-lock.json"), path.join(packageRoot, "package-lock.json"));

  await writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "lasso-files-runtime",
        version,
        private: true,
        type: "module",
        dependencies: {
          archiver: "^7.0.1",
          cors: "^2.8.5",
          express: "^4.19.2",
          "mime-types": "^2.1.35",
          multer: "^2.0.2",
        },
      },
      null,
      2,
    )}\n`,
  );

  runNpm(["install", "--omit=dev"], { cwd: packageRoot });

  await writeFile(
    path.join(packageRoot, "SERVICE-LASSO-PACKAGE.json"),
    `${JSON.stringify(
      {
        serviceId: "files",
        upstream: {
          backendContract: "TypeRefinery services/files",
          frontendSource: "C:/projects/github/react-file-manager/frontend",
          version,
        },
        packagedBy: "service-lasso/lasso-files",
        platform,
        arch: "x64",
        command: "node ./src/server.mjs",
      },
      null,
      2,
    )}\n`,
  );

  if (platform !== "win32") {
    await chmod(path.join(packageRoot, "src", "server.mjs"), 0o755);
  }

  await compressPackage(packageRoot, outputPath, target.archiveType);
  console.log(`[lasso-files] packaged ${outputPath}`);
  return outputPath;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await packageFiles();
}
