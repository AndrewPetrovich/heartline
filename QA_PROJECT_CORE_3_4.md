# HEARTLINE Editor 3.4 — Project Core QA

## Automated checks

```text
npm test
14 tests / 14 pass

npm run check
PASS
```

Covered regressions:

- source reconnect keeps one `projectId`;
- source project/document identity uses UUIDs for new projects;
- missing fragment IDs become stable UUID-backed identities;
- review approval is invalidated by source hash change;
- source scan distinguishes unchanged/moved/modified/deleted;
- explicit transport import creates a new UUID project;
- Project ZIP restore keeps an existing `projectId` instead of creating a copy;
- save writes recovery + revision before source replacement;
- external modification produces conflict and source is not overwritten;
- simulated source write failure leaves source intact and recovery pending;
- autosave revision policy does not create revisions on every pause;
- `.hl-editor/project-context.json` can rehydrate the same project after local cache loss;
- ZIP path traversal is rejected;
- ZIP bomb ratio/size limits are rejected.

## Static checks

`node --check` passes for `heartline-db.js`, `heartline-assets.js`, `sw.js` and all modules under `hl-editor/`.

## Compatibility

Reader, Storyboard, Graph 2.1, exporter and runtime modules are not rewritten. `heartline-app.js` remains the compatibility presentation; Project Core observes its workspace mutations and routes source-backed persistence through the new Application layer.

## Browser capability note

Source-directory attachment uses the File System Access API. Unsupported browsers keep transport import/export behaviour but cannot be considered source-backed. The port boundary intentionally allows a Tauri/native filesystem adapter to replace the browser adapter without changing ProjectService/domain rules.
