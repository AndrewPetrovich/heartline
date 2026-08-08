# Архитектура HEARTLINE v3

## Слои

- `db.js` — IndexedDB repositories, schema v3, v2 migration, visual scopes.
- `domain.js` — Frame projection, statuses, metrics, diagnostics, immutable helpers.
- `engine.js` — независимый story playback engine.
- `assets.js` — Blob media repository, SHA-256, thumbnails, assignments.
- `player-renderer.js` — единый renderer Preview/Runtime.
- `graph.js` — graph model, layout, SVG renderer and navigation.
- `app.js` — application orchestration and views.
- `legacy/*` — adapter boundary for existing DOCX/ZIP import/export.

## Версионность визуалов

Рабочий scope:

```text
workspace:<projectId>
```

Snapshot версии:

```text
version:<versionId>
```

При создании версии текущий workspace materializes text edits в Novel content, а visual scope клонируется в version scope.

## Миграция

Миграция открывает `heartline-editor-v2` только для чтения, копирует данные в `heartline-editor-v3`, создаёт VisualAssignment для каждого renderable Fragment и записывает результат в `migrationJournal`. Исходная v2 база не удаляется.
