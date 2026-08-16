# HEARTLINE 3.9.1 — Editorial Preview regression fix

Base commit:

`b287a96d133e40176c9ff11ea60d8d93de5ae9a9` (HEARTLINE 3.9.0)

This is a regression fix for the unified Final Review workspace.

## Fixes

- Preview no longer leaves a blank canvas during async/layout races.
- A frame without an image still renders the normal device placeholder.
- Preview rendering is generation-token protected against stale async renders.
- Preview errors appear inside the canvas with a Retry action instead of silently
  leaving the workspace blank.
- Final text editing moves from the narrow right inspector to the center under
  Preview.
- Clicking the current frame caption also opens the editor.
- Final text gets debounce autosave and is flushed before changing frame/stage.
- Leaving the editorial workspace starts a final draft persistence attempt.
- Editorial toast notifications move to the upper-right area and no longer cover
  the current frame caption.
- Source Save, projectId, recovery, revisions and final hash semantics are unchanged.

## Windows

Extract this ZIP over the repository root, without deleting existing files.

Then:

```powershell
node .\tools\apply-editorial-preview-fix-3.9.1.mjs
git status --short

npm.cmd run verify-repository
npm.cmd test
npm.cmd run check
```

Only if all checks pass:

```powershell
git add -A
git commit -m "HEARTLINE 3.9.1 editorial Preview fix"
git push
```

The migration refuses to overwrite a modified 3.9.0 Editorial Workspace: it
checks the published SHA-256 of both target Presentation files first.
