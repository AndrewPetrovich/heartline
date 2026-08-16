# HEARTLINE 3.6.2 — Font Policy QA

## Font contract

All normal application UI uses one stack:

`Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`

Legacy serif declarations cannot win because the new font policy is loaded from
the composition root after the existing Presentation modules.

Monospace remains allowed only for technical code surfaces.

## Local validation

- `node --check hl-editor/presentation/font-policy.js` — PASS
- `node --test tests/font-policy.test.js` — 5/5 PASS

The patch changes typography/Presentation only. Existing project/save/recovery
business logic is not modified.
