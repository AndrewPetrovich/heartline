# HEARTLINE 3.7 — Architecture Consolidation

Base: `47d6ccec82e54ed55bcf5169d7c6fff665d3e7e8` (HEARTLINE 3.6.4).

This package adds new architecture modules **and** an explicit migration script for the large legacy files.
Do not delete the repository before extracting it.

```bash
git checkout main
git pull

# Extract this archive over the repository root.
node tools/apply-architecture-consolidation.mjs

npm run verify-repository
npm test
npm run check

git status
git add -A
git commit -m "HEARTLINE 3.7 architecture consolidation"
git push
```

The migration script refuses to run unless `package.json` reports 3.6.4 and all expected source patterns are present.
Before modifying an existing file it writes a best-effort backup under `.git/heartline-update-backups/3.7.0/`, which is not committed.
