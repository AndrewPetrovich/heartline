# HEARTLINE Editor 3.5.2 — QA

## Automated checks

```text
npm test
40 tests / 40 pass

npm run check
PASS
Typography/UI simplification policy: PASS
```

## New regressions

- proofreading right pane renders without Checks/Dictionary tabs;
- standalone `Проверить текст` action is absent from the editor;
- `heartline-typography.css` is loaded by the app shell;
- the typography policy contains no weight above 600;
- legacy weights are neutralized globally;
- semantic emphasis remains semibold;
- existing 36 proofreading/project-core regressions remain green.

## UI contract

The right pane has no tab strip. It displays either:
- `Замечания`; or
- `Стиль и качество`, opened from the top toolbar.

Local deterministic checks remain available inside `Стиль и качество` through the current-fragment section.

## Typography contract

```text
body/default = 400
maximum emphasis = 600
font-synthesis = none
```

The final stylesheet uses deliberate `!important` rules because legacy HEARTLINE 3.x styles contain numeric weights up to 850.
