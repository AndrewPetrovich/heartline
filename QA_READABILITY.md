# HEARTLINE Proofreading readability QA

Scope: typography/UI-only patch over HEARTLINE 3.5.2.

Readability contract:
- default app text >= 15px where inherited;
- controls = 14px;
- main nav = 13px;
- proofreading chapter/scene/fragment navigation = 13px primary text;
- proofreading context = 15px desktop;
- proofreading editor = 20px desktop;
- proofreading comments/forms = 13–14px;
- status/help metadata = 11–12px;
- maximum font weight = 600.

Toolbar simplification:
- `#hlProofPending` hidden;
- `#hlProofSearch` hidden;
- `#hlProofQuality` hidden;
- `#hlProofView` remains available.

No source/project logic is changed.
