# HEARTLINE 3.6.3 — Library Cleanup QA

## Intended UI

Project placeholder cover:
- decorative illustration only;
- no HEARTLINE label;
- no duplicated project title.

Project card body:
- project title;
- date / reading scale metadata;
- proofreading readiness panel;
- last working position;
- open project action.

Removed from Library card:
- `Структура и производство`;
- structural statistics grid;
- visual production row.

The underlying project data is not deleted. This is Presentation-only.

## Local contract validation

- `node --check hl-editor/presentation/library-card-cleanup.js` — PASS
- `node --test tests/library-card-cleanup.test.js` — 5/5 PASS
