# HEARTLINE 3.6.2 — Unified Sans Typography

Expected base commit:

`17eb0687ab028aee3580e1920b9fee1894e92631`

This is a **non-destructive Presentation-only update**.

## What changes

- removes serif typography from the actual rendered UI;
- uses the same font stack already defined by the main HEARTLINE application:
  `Inter → system-ui → Segoe UI → Roboto → Arial → sans-serif`;
- overrides legacy Georgia / Times declarations in Reader, Storyboard,
  project cover placeholders and Proofreading;
- preserves monospace only for technical `code / pre / kbd / samp` surfaces;
- removes the Proofreading "Литературный serif" selector;
- normalizes the stored reader preference to `sans`;
- changes no project identity, source saving, review state, recovery,
  revisions, import/export or other business logic.

## Apply

```bash
git checkout main
git pull

# Extract this ZIP over the repository root, replacing matching files.

npm run verify-repository
npm test
npm run check

git add -A
git commit -m "HEARTLINE 3.6.2 unified sans typography"
git push
```
