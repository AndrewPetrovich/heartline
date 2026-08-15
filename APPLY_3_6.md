# Apply HEARTLINE 3.6

Expected base commit:

`abea3d4f980dc2328be70a2f5f1c70a021d2fb5e`

This is a **non-destructive update**. Do not clear the repository before applying it.

## What changes

HEARTLINE 3.6 adds a Presentation Design System without changing Project Core,
source saving, project identity, recovery, revisions, import/export semantics or
proofreading domain rules.

The update adds:

- reusable ActionCallout / InlineNotice / Disclosure visual language;
- one recommended next action on key screens;
- simplified Library cards and a "Continue proofreading" callout;
- Storyboard actions shown on engagement instead of permanently;
- progressive disclosure for advanced Graph controls;
- sequential next-item callout in Review Queue;
- simpler Export with preflight as the main status callout;
- source-backed backup state integrated into Export preflight;
- revision creation callout in version history;
- contextual proofreading onboarding for anchored comments;
- less technical metadata in everyday UI;
- contextual Undo/Redo visibility;
- consistent keyboard focus and reduced-motion handling.

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
git commit -m "HEARTLINE 3.6 presentation design system"
git push
```

No files should be deleted as part of this update.
