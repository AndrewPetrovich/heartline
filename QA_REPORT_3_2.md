# HEARTLINE Editor 3.2 — QA

Проверено 8 августа 2026 в Chromium 144, локальная production-like сборка.

## Desktop 1600×900
- Основные вкладки первого уровня: Библиотека / Читать / Сториборд / Граф — PASS.
- Dropdown Инструменты / Проект — PASS.
- Graph 2.0 содержит 4 режима — PASS.
- Лунная клятва v5: Карта главы ~9 canvas nodes; Карта решений ~18 nodes включая 3 финала; Анализ путей ~14 nodes включая 3 финала; Карта романа 12 глав + start + 3 финала.
- Финалы из storyMetadata.finals представлены отдельными ending nodes — PASS.
- Поиск / zoom / fit / pan handlers присутствуют — PASS.
- Story Graph summary: 100 сцен, 31 branch-point решения, 3 финала, 27 470 слов — PASS.

## Mobile 390×844
- Нижняя навигация: Библиотека / Читать / Сториборд / Граф / Ещё — PASS.
- Горизонтальный overflow: 0 px — PASS.
- Graph открывается, 4 режима доступны — PASS.
- Inspector открывается как fixed bottom sheet после выбора узла — PASS.

## Static checks
- `node --check` для JS-модулей — PASS.
- novel.json / moon-oath.json — valid JSON.
- `npm run build` — PASS.
