# HEARTLINE 3.8 — Preview Lab

Base commit:

`42c1864633a93de7fafd7a40796a0eff709cc9ce` (HEARTLINE 3.7.1)

This is a non-destructive update with a CRLF/LF-safe migration script.

The ZIP does **not** overwrite the existing player renderer during extraction.
The new renderer is staged under `tools/preview-lab-3.8/` and is only installed
after the migration has validated all expected 3.7.1 source patterns.

## Apply on Windows

1. Extract this ZIP **over the root of your current local `heartline` repository**.
2. Do not delete any existing files first.
3. In PowerShell, from the repository root:

```powershell
node .\tools\apply-preview-lab-3.8.mjs
git status --short
```

A successful migration prints:

```text
HEARTLINE 3.8 Preview Lab applied (...)
```

Then run:

```powershell
npm.cmd run verify-repository
npm.cmd test
npm.cmd run check
```

Only if all checks pass:

```powershell
git add -A
git commit -m "HEARTLINE 3.8 Preview Lab"
git push
```

Do not commit if migration or validation fails.

## Data safety

This update does not change:

- projectId semantics;
- source-backed Save;
- conflict hashes;
- recovery;
- revision/backup policies;
- proofreading state.

The migration backs up every modified existing file under:

`.git/heartline-update-backups/3.8.0/`
