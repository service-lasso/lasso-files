# lasso-files

Release-backed Service Lasso file manager service.

`lasso-files` provides a Node/Express filesystem-backed API and a React file-manager UI for browsing, uploading, downloading, renaming, moving, copying, and deleting app-owned files.

## Service Contract

- Service id: `files`
- Runtime dependency: `@node`
- Default HTTP endpoint: `web` on `127.0.0.1:8199`
- UI endpoint: `ui` at `${endpoint.ui.url}`
- Data root: `${SERVICE_DATA_PATH}` or `FILES_DATA_PATH`
- Allowed upload extensions: `FILES_ALLOWED_EXTENSIONS`
- Blocked upload extensions: `FILES_BLOCKED_EXTENSIONS`
- Max upload size: `FILES_MAXSIZE_MB`
- File sources:
  - `local-data-root` points at `FILES_DATA_PATH`, `SERVICE_DATA_PATH`, or `./data`.
  - `service-lasso-workspaces` points at `FILES_SERVICE_LASSO_WORKSPACES_PATH` or `SERVICE_LASSO_WORKSPACE_ROOT` when provided by a managed Service Lasso runtime.
  - `FILES_DEFAULT_SOURCE_ID` can choose a registered source explicitly.
- Healthcheck: `GET /healthcheck` returns `200`
- Global environment exported to dependants:
  - `FILES_URL=${endpoint.base_url.url}`
  - `FILES_PORT=${endpoint.web.port}`

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
npm run dev
```

Open the UI:

```text
http://127.0.0.1:8199/files
```

Check health:

```powershell
Invoke-RestMethod http://127.0.0.1:8199/healthcheck
```

`npm run dev` builds the React UI and starts the same server entry point that the packaged service uses. By default it uses port `8199` and stores files under `./data`.

Override defaults when needed:

```powershell
$env:FILES_PORT = "18200"
$env:FILES_DATA_PATH = "D:\tmp\lasso-files-data"
$env:FILES_ALLOWED_EXTENSIONS = ".txt,.pdf,.png"
$env:FILES_BLOCKED_EXTENSIONS = ""
$env:FILES_MAXSIZE_MB = "300"
npm run dev
```

If the UI has already been built, use `npm start` to start the server without rebuilding.

## Allowed Files

Allowed uploads are configured by extension and enforced by the server. The React UI reads the same setting from the service config API, so the file picker and backend stay aligned.

Set allowed file extensions at startup:

```powershell
$env:FILES_ALLOWED_EXTENSIONS = ".txt,.pdf,.png"
npm run dev
```

Use `*` to allow every extension. Add blocked extensions to deny high-risk types while keeping the rest open:

```powershell
$env:FILES_ALLOWED_EXTENSIONS = "*"
$env:FILES_BLOCKED_EXTENSIONS = ".exe,.bat,.cmd,.ps1"
```

Blocked extensions always win. For example, if `.exe` appears in both `FILES_ALLOWED_EXTENSIONS` and `FILES_BLOCKED_EXTENSIONS`, uploads ending in `.exe` are rejected.

Runtime config API:

- `GET /api/config` returns `allowedExtensions`, `blockedExtensions`, `acceptedFileTypes`, `blockedFileTypes`, `allowAllFiles`, `maxUploadBytes`, and `maxUploadMb`.
- `PUT /api/config` or `PATCH /api/config` with `{ "allowedExtensions": [".txt", ".pdf"], "blockedExtensions": [".exe"] }` updates the in-memory extension rules.
- The runtime update is intentionally not persisted; restart-time config still comes from environment/service manifest values.

## File Sources

The server routes file operations through source providers instead of assuming one local root. Standalone/dev mode registers `local-data-root` as the default source so the existing `FILES_DATA_PATH` behaviour stays unchanged. Managed Service Lasso runtimes can also register `service-lasso-workspaces` from a workspace registry or from `SERVICE_LASSO_WORKSPACE_ROOT` / `FILES_SERVICE_LASSO_WORKSPACES_PATH`. When that source is present, it becomes the default unless `FILES_DEFAULT_SOURCE_ID` is set. `local-data-root` remains registered and visible.

Source ids are stable and visible from:

- `GET /api/file-sources`
- `GET /api/sources`
- `GET /healthcheck`
- `GET /api/file-system` item fields `sourceId`, `sourceRootId`, and `permissions`

Each source reports read/write/remove support per root. Providers cannot resolve paths outside their approved roots. Existing endpoints still default to the active source. Requests may opt into a registered source with `sourceId` in the query string or JSON/form body.

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

### Service Lasso Workspace Provider

Managed launches can browse Service Lasso-approved workspace roots instead of the standalone local data root. Enable the provider with:

```powershell
$env:FILES_SOURCE_PROVIDER = "service-lasso-workspaces"
$env:FILES_WORKSPACES_REGISTRY_PATH = "C:\path\to\workspace-registry.json"
npm run dev
```

`SERVICE_LASSO_MANAGED=1`, `SERVICE_LASSO_FILES_SOURCE_PROVIDER=service-lasso-workspaces`, or a configured workspace registry also selects this provider.

The registry can be provided by file, inline JSON, or API:

- `FILES_WORKSPACES_REGISTRY_PATH` or `SERVICE_LASSO_WORKSPACES_REGISTRY_PATH`
- `FILES_WORKSPACES_REGISTRY_JSON` or `SERVICE_LASSO_WORKSPACES_REGISTRY_JSON`
- `FILES_WORKSPACES_REGISTRY_URL` or `SERVICE_LASSO_WORKSPACES_REGISTRY_URL`

Registry entries use this shape:

```json
{
  "sourceId": "service-lasso-workspaces",
  "serviceId": "nginx",
  "rootId": "workspace",
  "label": "Workspace",
  "path": "C:\\projects\\service-lasso\\workspace\\nginx",
  "mode": "read-write"
}
```

`GET /api/sources` reports provider availability and groups roots by `serviceId`. `GET /api/file-system` includes virtual service and root folders with `sourceId`, `serviceId`, `rootId`, `mode`, and `readOnly` metadata. Roots marked `hidden` or `protected` are omitted. Read-only roots can be browsed and downloaded, but create, upload, rename, move, and delete operations return `403`.

## Local Verification

```powershell
npm ci
npm test
```

The verification packages the current OS, extracts the archive, starts the packaged service, checks health/UI routes, exercises folder creation, file upload, list, download, rename, delete, and stops the process.
