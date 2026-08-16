# HEARTLINE 3.9 — Editorial Pipeline

Base commit:

`9d86d9fc072219d5f62b5c564d13d5d982d3e2ee` (HEARTLINE 3.8 Preview Lab)

This update combines the core editorial flow into one workspace:

1. **Вычитка**
2. **Визуалы**
3. **Финальная проверка**

The stages share the same `projectId`, `fragmentId`, Proofreading state, visual
assignments and workspace context. They are not separate projects or copies.

## Apply on Windows

Extract this ZIP **over the repository root**, without deleting existing files.

Then from PowerShell:

```powershell
node .\tools\apply-editorial-pipeline-3.9.mjs
git status --short
```

A successful migration prints:

```text
HEARTLINE 3.9.0 editorial pipeline applied (...)
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
git commit -m "HEARTLINE 3.9 editorial pipeline"
git push
```

Do not commit if the migration or any validation command fails.

## Data safety

The update does not change:
- source-backed Save;
- `projectId`;
- external hash conflict detection;
- recovery;
- revision/backup policies.

Text edits still use the existing Proofreading/Project save flow. Final-review
state is context only and is invalidated by text or visual hash changes.
