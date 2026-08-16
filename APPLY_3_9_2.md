# HEARTLINE 3.9.2 — Preview text visualization fix

Base commit:

`7c8c4a96686e634a6c9553e04ac38911b202cc9d` (HEARTLINE 3.9.1)

## What changes

The Final Review Preview now uses two-phase rendering:

1. a synchronous device shell is rendered immediately from the current
   `fragmentId`, speaker and text;
2. if an image exists, its object URL is loaded asynchronously and the same
   Preview is hydrated with the image.

Therefore a frame without an image still shows the real mobile device with:
- scene chrome;
- speaker;
- current novel text;
- dialogue panel;
- the normal "Изображение не назначено" placeholder behind it.

The compact row:

`NICO · current text · Редактировать`

is intentionally preserved at all times. Opening the text editor no longer
replaces/removes this row; the larger editor appears below it.

No Project Core or persistence semantics change.

## Apply on Windows

Extract over the current HEARTLINE 3.9.1 repository, without deleting files.

```powershell
node .\tools\apply-editorial-preview-fix-3.9.2.mjs
git status --short

npm.cmd run verify-repository
npm.cmd test
npm.cmd run check
```

If all checks pass:

```powershell
git add -A
git commit -m "HEARTLINE 3.9.2 Preview text visualization"
git push
```
