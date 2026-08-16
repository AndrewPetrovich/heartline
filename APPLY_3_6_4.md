# HEARTLINE 3.6.4 — Restore Library Readiness Card

Expected base commit:

`fd6fa9c400c507ff2adee87a45f330b2c4537f39`

This is a non-destructive Presentation-only update.

## Result

Library cards keep:
- clean decorative cover;
- one project title;
- proofreading readiness block;
- last working position;
- open-project button.

The restored readiness block shows:
- proofreading status;
- percentage;
- checked / total fragments;
- remaining fragments;
- open reviews;
- changed-after-review fragments;
- last chapter and scene.

Still removed:
- `Структура и производство`;
- structural statistics grid;
- visual production row.

The block reads from the existing `ProofreadingService` model, so it does not
create a second review-state source of truth.

## Apply

```bash
git checkout main
git pull

# Extract this ZIP over the repository root.

npm run verify-repository
npm test
npm run check

git add -A
git commit -m "HEARTLINE 3.6.4 restore proofreading readiness card"
git push
```
