# HEARTLINE 3.7.1 — Windows migration fix

This patch is for the repository state where the 3.7 architecture modules were
already committed, but `tools/apply-architecture-consolidation.mjs` did not
apply the migration and `package.json` is still 3.6.4.

## Why 3.7 failed on Windows

Git commonly checks text files out as CRLF on Windows. The original migration
matched multiline source fragments with LF-only strings, so its validation
stopped before writing any files.

The old `npm run check` also used the Unix-only `find | xargs` pipeline.

3.7.1 fixes both problems:

- migration matching is CRLF/LF agnostic and preserves the existing local EOL;
- `npm run check` uses `tools/check-js-syntax.mjs`, implemented entirely in Node.

## Apply in PowerShell

Extract this ZIP over the current local HEARTLINE repository. Do not delete
anything first.

Then run ONLY the migration:

```powershell
node .\tools\apply-architecture-consolidation.mjs
```

A successful run must end with a line similar to:

```text
HEARTLINE 3.7 architecture consolidation applied (...)
Next on Windows: npm.cmd run verify-repository && npm.cmd test && npm.cmd run check
```

Then verify that the migration really changed files:

```powershell
git status --short
```

You should see modifications to `heartline-app.js`, `heartline-engine.js`,
`heartline-parser.js`, `heartline-graph-model.js`, `package.json`, and other
architecture files.

Only then run:

```powershell
npm.cmd run verify-repository
npm.cmd test
npm.cmd run check
```

If all three pass:

```powershell
git add -A
git commit -m "Apply HEARTLINE 3.7.1 architecture migration"
git push
```

Do not commit if the migration command or any validation command fails.
