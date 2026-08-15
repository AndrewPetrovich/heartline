# Apply HEARTLINE 3.4 Project Core

This overlay is based on `AndrewPetrovich/heartline` commit:

`62ca19cd81a93b7379e7203693d03a10a8f5eb0a`

Copy the overlay into the repository root, preserving paths and replacing the existing files included in the archive.

Changed existing files:

- `heartline-db.js`
- `heartline-assets.js`
- `index.html`
- `manifest.webmanifest`
- `sw.js`
- `PACKAGE.txt`

New Project Core files:

- `hl-editor/**`
- `tests/**`
- `package.json`
- `HL_EDITOR_ARCHITECTURE.md`
- `QA_PROJECT_CORE_3_4.md`
- `README_v340.txt`

Validation:

```bash
npm test
npm run check
```

Expected result at packaging time: 14 tests passed, static syntax checks passed.

The GitHub connector used to prepare this overlay had read access but returned HTTP 403 for both file writes and branch creation, so no remote commit was created from the session that generated this package.
