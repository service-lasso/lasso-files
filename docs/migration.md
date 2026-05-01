# Migration Notes

The TypeRefinery donor service exposed an Angular UI and path-based Koa API. `lasso-files` keeps the app-owned file-manager intent but replaces the internals with a filesystem-backed Express API and React UI.

## Preserved Legacy Entrypoints

| Legacy URL | Status in `lasso-files` |
| --- | --- |
| `GET /files` | Preserved, now serves the React UI |
| `GET /api/*event` | Preserved as an SSE-compatible no-op progress stream |
| `PUT /api/options?type=GET_FILE_MAXSIZE` | Preserved |
| `PUT /api/options?type=GET_FILE_FILTER` | Preserved |
| `GET /api/<path>` | Preserved for directory listing or file download |
| `DELETE /api/<path>` | Preserved for deleting a path |
| `POST /api/<path>?type=CREATE_FOLDER` | Preserved for folder creation |

## Changed Behavior

The old upload/progress/archive behavior used path-based raw request streams and Angular-specific progress metadata. New applications should use the canonical React API:

- Upload files with `POST /api/file-system/upload` multipart form data.
- Create archives by downloading multiple `files=<id>` values from `/api/file-system/download`.
- Treat `/api/file-system` ids as path-derived identifiers, not MongoDB ObjectIds.

## Recommended Migration

1. Replace direct calls to `/api/<path>?type=UPLOAD_FILE` with `POST /api/file-system/upload`.
2. Replace path-based move/rename calls with id-based `/copy`, `/move`, and `/rename` calls.
3. Use `/content/<path>` for previews instead of direct `/api/<path>` links.
4. Keep `/files` as the human-facing UI link.
