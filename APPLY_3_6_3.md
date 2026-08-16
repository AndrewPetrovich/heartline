# HEARTLINE 3.6.3 — Library Cleanup

Expected base commit:

`ad8ef8c115eeb8b4ccb0047e193b23cdd77681dd`

This is a **non-destructive Presentation-only update**.

## Changes

- removes duplicated `HEARTLINE` and project title text from placeholder covers;
- keeps the project title only once, in the card body;
- removes `Структура и производство` from Library cards;
- removes the underlying Library `project-stats-grid` and `project-production-row`
  from the rendered card DOM;
- keeps proofreading readiness, remaining fragments, open reviews,
  changed-after-review count and last position as the main card information;
- changes no project identity, source saving, proofreading state, recovery,
  revisions, import/export or other business logic.

## Apply

```bash
git checkout main
git pull

# Extract this ZIP over the repository root.

npm run verify-repository
npm test
npm run check

git add -A
git commit -m "HEARTLINE 3.6.3 library card cleanup"
git push
```
