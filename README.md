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

## Local Verification

```powershell
npm ci
npm test
```

The verification packages the current OS, extracts the archive, starts the packaged service, checks health/UI routes, exercises folder creation, file upload, list, download, rename, delete, and stops the process.
