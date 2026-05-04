# lasso-files

Release-backed Service Lasso file manager service.

`lasso-files` provides a Node/Express filesystem-backed API and a React file-manager UI for browsing, uploading, downloading, renaming, moving, copying, and deleting app-owned files.

## Service Contract

- Service id: `files`
- Runtime dependency: `@node`
- Default port: `8199`
- Data root: `${SERVICE_DATA_PATH}` or `FILES_DATA_PATH`
- Healthcheck: `GET /healthcheck` returns `200`
- Global environment exported to dependants:
  - `FILES_URL=http://127.0.0.1:${SERVICE_PORT}`
  - `FILES_PORT=${SERVICE_PORT}`

## Release Assets

Each release contains:

- `lasso-files-1.0.0-win32.zip`
- `lasso-files-1.0.0-linux.tar.gz`
- `lasso-files-1.0.0-darwin.tar.gz`
- `service.json`
- `SHA256SUMS.txt`

## URL Contracts

The canonical React UI contract is documented in [docs/url-contracts.md](docs/url-contracts.md).

Compatibility and migration notes for existing path-based integrations are documented in [docs/migration.md](docs/migration.md).

## Run Locally

Use this direct mode when developing or quickly checking the service without a Service Lasso app:

```powershell
npm ci
npm run build:ui
$env:FILES_PORT = "8199"
$env:FILES_DATA_PATH = "$PWD\data"
node .\src\server.mjs
```

Open the UI:

```text
http://127.0.0.1:8199/files
```

Check health:

```powershell
Invoke-RestMethod http://127.0.0.1:8199/healthcheck
```

Direct mode uses the same server entry point that the packaged service uses. `FILES_DATA_PATH` controls where uploaded and managed files are stored.

## Run With Service Lasso

In a consuming Service Lasso app, commit the service manifest at:

```text
services/files/service.json
```

The manifest points to the latest `service-lasso/lasso-files` GitHub release. Service Lasso downloads the matching platform archive, runs the service through `@node`, assigns the service port, and exports:

- `FILES_URL`
- `FILES_PORT`

The default UI URL is:

```text
http://127.0.0.1:8199/files
```

## Local Verification

```powershell
npm ci
npm test
```

The verification packages the current OS, extracts the archive, starts the packaged service, checks health/UI routes, exercises folder creation, file upload, list, download, rename, delete, and stops the process.
