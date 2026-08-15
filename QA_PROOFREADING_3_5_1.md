# HEARTLINE Editor 3.5.1 — QA

## Automated checks

```text
npm test
36 tests / 36 pass

npm run check
PASS
```

Новые/обновлённые regression checks:

- proofreading context больше не содержит passes;
- state 3.5.0 с pass records мигрирует в единый latest reviewed record;
- content hash по-прежнему инвалидирует только изменённый fragmentId;
- open review блокирует автоматическую отметку fragment как reviewed;
- style guide сохраняется в proofreading context;
- novel style analysis возвращает редакционную готовность и стилевые метрики;
- анализ явно не позиционируется как оценка художественной ценности;
- все 14 Project Core data-safety regressions продолжают проходить.

## UX contract

`Вперёд` является единственным навигационным действием, которое автоматически завершает текущий fragmentId. `Назад`, `Первая`, `Последняя` и прямой выбор в outline только сохраняют текст и меняют позицию.

При открытом замечании `Вперёд` разрешает продолжить чтение, но fragment остаётся `attention`.
