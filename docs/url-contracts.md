# URL Contracts

`lasso-files` serves the React UI and a filesystem-backed JSON API from the same origin.

## UI

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/` | React file manager UI |
| `GET` | `/files` | React file manager UI; preserved from the legacy TypeRefinery service entry route |
| `GET` | `/content/<path>` | Raw file preview/static content from the configured data root |

## Canonical React API

Base path: `/api/file-system`

| Method | URL | Body/query | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/file-system` | none | List all files and folders recursively |
| `POST` | `/api/file-system/folder` | `{ "name": "Docs", "parentId": null }` | Create a folder |
| `POST` | `/api/file-system/upload` | multipart `file`, optional `parentId` | Upload a file |
| `POST` | `/api/file-system/copy` | `{ "sourceIds": ["..."], "destinationId": null }` | Copy files or folders |
| `PUT` | `/api/file-system/move` | `{ "sourceIds": ["..."], "destinationId": null }` | Move files or folders |
| `PATCH` | `/api/file-system/rename` | `{ "id": "...", "newName": "new.txt" }` | Rename a file or folder |
| `DELETE` | `/api/file-system` | `{ "ids": ["..."] }` | Delete files or folders |
| `GET` | `/api/file-system/download?files=<id>` | one or more `files` query values | Download one file directly or multiple items as `files.zip` |

Items use deterministic path-derived ids. The root folder id is `root`; child ids are stable while the path is stable.

## Item Shape

```json
{
  "_id": "ZG9jcy9yZWFkbWUudHh0",
  "name": "readme.txt",
  "isDirectory": false,
  "path": "/docs/readme.txt",
  "parentId": "ZG9jcw",
  "size": 42,
  "mimeType": "text/plain",
  "createdAt": "2026-05-01T00:00:00.000Z",
  "updatedAt": "2026-05-01T00:00:00.000Z"
}
```
