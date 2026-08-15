# HEARTLINE 3.5.2 — Readability patch

Base: `b2aa3743c64f7bc6b219604bc28f9b5a30521fc5` or a descendant containing HEARTLINE 3.5.2.

This is a **non-destructive CSS/UI patch**. Do not remove any existing repository files.

Changes:
- increases small UI text across HEARTLINE;
- substantially enlarges the Proofreading outline, scene rows and fragment excerpts;
- enlarges proofreading metadata, comments, forms and navigation;
- keeps the novel text visually dominant;
- hides `К непроверенному`, `Поиск / замена`, `Стиль и качество` from the Proofreading toolbar;
- preserves max font weight 600 (semibold);
- does not change proofreading/save/recovery business logic.

Apply:
```bash
git checkout main
git pull
# extract this ZIP over the repository root, replacing heartline-typography.css
npm test
npm run check
git add -A
git commit -m "HEARTLINE proofreading readability pass"
git push
```
