# HEARTLINE Editor v3.0 — Frame & Visual Pipeline

HEARTLINE v3 — редактор полного цикла для интерактивных мобильных новелл. Основная единица проекта — **Frame**:

```text
Frame = Fragment текста + VisualAssignment + Asset изображения
```

Каждый отображаемый диалог, нарратив, мысль и Choice prompt автоматически получает отдельный VisualAssignment. Технические команды не требуют изображения.

## Что реализовано

- импорт DOCX, HEARTLINE JSON и Project ZIP;
- автоматическая миграция данных из `heartline-editor-v2` без удаления IndexedDB;
- модульная архитектура: persistence, domain, story engine, media pipeline, PlayerRenderer и Story Graph;
- хранение оригинальных изображений и thumbnails как Blob в IndexedDB;
- SHA-256 дедупликация изображений;
- независимое назначение изображения каждому Frame;
- повторное использование одного Asset в нескольких Frames с отдельными crop/status;
- focal point, zoom, overlay и device-specific overrides;
- статусы visual: missing, draft, needs-review, approved, rejected;
- автоматическая инвалидизация approved visual после изменения текста;
- Reader с Inspector `Кадр / Изображение / Замечания`;
- текстовые и визуальные замечания, включая точку на изображении;
- Storyboard сцены, фильтры, массовая загрузка и массовое утверждение;
- Asset Library;
- Mobile Preview Lab с общим PlayerRenderer;
- пресеты 320×568, 360×800, 375×812, 390×844, 412×915;
- сравнение трёх устройств;
- диагностика переполнения текста, доли панели, focal overlap и разрешения;
- Story Graph с wheel zoom, middle-button/Space+drag pan и quality counters;
- версии текста + visual manifest, text/visual Diff и Undo/Redo;
- GPT request ZIP, import revision.json, ручное принятие/отклонение;
- Project ZIP, runtime ZIP, Master DOCX, JSON, reviews CSV и quality report;
- production runtime блокируется, если хотя бы один обязательный Frame не имеет изображения;
- offline PWA с версионированной директорией `app-v300`.

## Обновление существующего GitHub Pages

1. Распакуйте UPDATE-пакет.
2. В репозитории `AndrewPetrovich/heartline` выберите **Add file → Upload files**.
3. Перетащите все файлы и папки из UPDATE-пакета в корень репозитория.
4. Подтвердите замену файлов и сделайте Commit в `main`.
5. После завершения GitHub Pages один раз откройте:

```text
https://andrewpetrovich.github.io/heartline/upgrade-v300.html
```

Страница удаляет только старые Service Worker и Cache Storage. IndexedDB с версиями, замечаниями и прогрессом не очищается. Затем выполняется переход в HEARTLINE v3, где запускается автоматическая миграция v2 → v3.

## Изображения

Массовая загрузка умеет сопоставлять файлы с кадрами по Fragment ID:

```text
FR_CH01_SC01_001.webp
FR_CH01_SC01_002.png
```

Если имя файла совпадает с Fragment ID или начинается с него, Asset автоматически назначается соответствующему Frame.

Новая встроенная новелла содержит примерно 1504 Frames. После первой миграции для каждого из них создаётся VisualAssignment со статусом `missing`. Реальные изображения необходимо загрузить через Storyboard или Asset Library.

## Project ZIP

Полный пакет содержит:

```text
project.json
novel.json
metadata.json
visual-manifest.json
reviews.json
assets/*
```

Project ZIP переносит версии, workspace, комментарии, визуальные настройки, сессии и GPT-кандидатов. При конфликте Project ID импорт создаёт безопасный новый ID и перепривязывает версии и Assets.

## Runtime build

Production runtime включает только актуальный сценарий, visual manifest, используемые Assets и общий PlayerRenderer. Редакторские замечания и история в runtime не попадают.

Черновой runtime с placeholders можно собрать в любой момент. Production runtime требует отсутствие `missing visual`.

## Горячие клавиши

- `← / →` — предыдущий / следующий Frame;
- `C` — текстовое замечание;
- `E` — Inspector текста;
- `I` — Inspector изображения;
- `P` — Mobile Preview Lab;
- `A` — утвердить визуал;
- `Ctrl/Cmd + Z` — Undo;
- `Ctrl/Cmd + Shift + Z` — Redo.

## Файлы приложения

```text
index.html
app-v300/
  app.js
  db.js
  domain.js
  engine.js
  assets.js
  player-renderer.js
  graph.js
  app.css
legacy/
  parser.js
  exporter.js
novel.json
manifest.webmanifest
sw.js
upgrade-v300.html
```

`legacy/parser.js` и `legacy/exporter.js` используются как изолированные адаптеры существующих DOCX/ZIP форматов. Новые domain, persistence, media, renderer и graph подсистемы не зависят от монолитного v2 app.js.
