# Apply HEARTLINE 3.5.2

Base expected: `efef2019f9d58a64cc95833493776d817ab0df71` (HEARTLINE 3.5.1) or a descendant containing the same Unified Proofreading Reader.

This is a **non-destructive update**. Do not clear or replace the repository with only this package.

## Changes

- removes the standalone `Проверить текст` button under the proofreading editor;
- removes the `Проверки/Качество` and `Словарь` tabs from the right pane;
- keeps one contextual right pane: `Замечания` or `Стиль и качество`;
- caps all UI font weights at `600` (semibold);
- neutralizes legacy `650–850` declarations at runtime;
- disables synthetic bold;
- bumps HEARTLINE to 3.5.2.

## Apply locally

```bash
git checkout main
git pull
# extract this ZIP over the repository root, replacing matching files
npm run verify-repository
npm test
npm run check
git status
git add -A
git commit -m "HEARTLINE 3.5.2 typography cleanup"
git push
```

If using the GitHub web UI, upload/replace only the files included in this package. Do not delete unchanged repository files.
