# HEARTLINE v3 — QA report

Проверено 08.08.2026.

## Автоматические проверки

- `node --check` для всех JS-модулей и Service Worker — успешно.
- TypeScript strict check для публичных domain interfaces — успешно.
- CSS parsing через tinycss2 — 0 ошибок.
- JSON validation загрузки manifest, novel и schema — успешно.
- Story Engine smoke test — маршрут доходит до завершения; choices и timeline работают.
- Story Graph fixture — 69 nodes, 94 edges.
- Browser CDP smoke test (file origin, clean profile):
  - Library;
  - Reader;
  - Storyboard;
  - Asset Library;
  - Preview Lab;
  - Reviews;
  - Versions;
  - GPT;
  - Story Graph;
  - Export.
  Все разделы открылись без Runtime exceptions.
- Media E2E smoke test:
  - upload PNG;
  - thumbnail and preview;
  - visual status draft → approved;
  - text edit invalidates approved visual to needs-review;
  - quality metrics update.
- Responsive screenshot smoke test: desktop Reader and 390×844 Preview.

## Fixture

- 52 scenes;
- 17 choices;
- 1504 renderable Frames;
- Story Graph: 69 nodes / 94 edges.

## Не входящие в статический GitHub Pages пакет инфраструктурные gates

CI screenshot visual regression, multi-browser farm и performance lab должны подключаться в репозитории разработки. Сам PlayerRenderer и обязательные device presets уже выделены для таких тестов.
