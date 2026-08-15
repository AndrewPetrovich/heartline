# Apply HEARTLINE 3.6.1

Expected base commit:

`f263a242d4e7d611d1eb5a42bd50352a62013015`

This is a **non-destructive Presentation-only update**. Do not clear the repository.

## Changes

- removes the persistent blue onboarding callout from the proofreading comments pane;
- keeps the normal compact `+ замечание` workflow;
- makes Library project cards proofreading-first;
- each card now shows proofreading readiness, percent, checked/total fragments, remaining fragments, open reviews, changed-after-review fragments, and the last proofreading position;
- moves visual-production metrics into `Структура и производство` disclosure;
- removes the 4-column micro-card desktop layout in favor of readable 360–420 px cards;
- removes the artificial 560 px card height;
- increases visible Library card typography and control sizes;
- preserves max emphasis at semibold (600);
- changes no project identity, source save, recovery, revisions, import/export or proofreading domain rules.

## Apply

```bash
git checkout main
git pull

# Extract this ZIP over the repository root, replacing matching files.

npm run verify-repository
npm test
npm run check

git status
git add -A
git commit -m "HEARTLINE 3.6.1 proofreading-first library cards"
git push
```
