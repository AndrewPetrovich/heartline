# HEARTLINE Cloud Sync backend contract

HEARTLINE 3.1 remains local-first. Automatic cross-device sync is intentionally disabled until an authenticated backend is connected.

Recommended minimum backend:
- authenticated user/project access;
- object storage for image blobs;
- metadata store for project/version/workspace/review state;
- optimistic concurrency with `revision` / ETag;
- encrypted transport and private-by-default buckets;
- conflict endpoint returning base/local/remote snapshots rather than last-write-wins.

Suggested operations:
- `GET /projects`
- `GET /projects/:id/snapshot`
- `PUT /projects/:id/snapshot` with `If-Match`
- `POST /projects/:id/assets` (content hash deduplication)
- `GET /projects/:id/assets/:assetId`

Conflict rule: never silently overwrite text, reviews or visual assignments when both local and remote changed after the same base revision. Return a conflict object and show a Diff in the editor.

Until this backend exists, Project ZIP is the supported cross-device transfer mechanism.
