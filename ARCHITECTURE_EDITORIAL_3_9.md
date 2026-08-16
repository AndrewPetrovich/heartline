# HEARTLINE 3.9 — Editorial Pipeline Architecture

## Goal

The user workflow is one long-lived editorial process:

```text
1. Вычитка
      ↓
2. Визуалы
      ↓
3. Финальная проверка
      ↓
READY / Export
```

The stages are freely switchable; they are progress states, not hard locks.

## Dependency direction

```text
Presentation
  EditorialWorkspace
       ↓
Application
  EditorialWorkflowService
       ↓
Ports
  EditorialWorkflowRepository
  VisualAssetGateway
       ↑
Infrastructure
  BrowserEditorialWorkflowRepository
  BrowserVisualAssetGateway

EditorialWorkflowService
       ↓
ProofreadingService
DeviceProfileService
```

Presentation does not import IndexedDB or visual infrastructure.

## Source of truth

Novel text remains in the source-backed project.

`workspace.proofreading` stores text-review state.

`workspace.editorialWorkflow` stores:
- current editorial stage;
- final-review hashes;
- target preview device IDs.

Visual assignments remain in the existing HL context stores.

No additional current copy of the novel text is created.

## Final review

A completed final review stores:

```text
fragmentId
textHash
visualHash
reviewedAt
```

`visualHash` covers the asset ID and visual settings, including focal point,
zoom, overlay and device overrides.

If either text or visual settings change, the final review becomes `changed`.
The previous review record is not silently treated as current.

A final unit can only be completed when:
- current text is reviewed;
- an image is assigned;
- open reviews are resolved;
- Preview has no deterministic error-level diagnostics.

During the final stage, clean text can be re-confirmed automatically by
`Далее`, so a small final correction does not require navigating back to stage 1.

## Unified Presentation

The old standalone Proofreading Presentation is no longer imported from
`hl-editor/index.js`.

`EditorialWorkspace` owns:
- text review;
- image upload and crop controls;
- embedded Preview;
- final readiness;
- next/previous navigation;
- Library three-stage progress.

The legacy Reader and Preview routes delegate to this workspace, preserving old
deep links from Graph/Storyboard without maintaining separate workflows.

The separate Preview button is removed from the Tools menu. The 3.8 device
profile infrastructure and Preview renderer remain reusable inside the final
stage.

## Library progress

Project cards show three independent percentages:

```text
Вычитка
Визуалы
Финальная проверка
```

The recommended CTA advances to the first incomplete stage.

## Compatibility

The old Proofreading Domain/Application/Infrastructure remain in use.
Only its standalone Presentation entry is superseded.

This keeps existing review state, anchors, rules, dictionary and source-save
behavior compatible with older projects.
