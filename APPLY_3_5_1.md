# Apply HEARTLINE 3.5.1

Expected base: `5cd9637c56f4f54a6465968b53dc5889157c901e` (HEARTLINE 3.5.0) or a descendant containing the same 3.5 Proofreading Workspace.

This is a non-destructive update. Do **not** clear the repository.

1. Extract this ZIP over the repository root and replace matching files.
2. Run:

```bash
npm run verify-repository
npm test
npm run check
```

3. Review `git status`.
4. Commit/push:

```bash
git add -A
git commit -m "HEARTLINE 3.5.1 unified proofreading reader"
git push
```
