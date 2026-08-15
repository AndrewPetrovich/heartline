# HEARTLINE Editor 3.5 — Proofreading Workspace

## Purpose

Version 3.5 makes proofreading a first-class workflow instead of treating it as a side effect of Reader comments.

The working loop is:

```text
open next unchecked fragment
→ read/edit
→ add durable anchored issue if needed
→ resolve/verify issue
→ mark fragment/scene/chapter reviewed
→ content hash guards the review state
→ final pass can approve the whole source project
```

## Granular review state

Proofreading state is stored inside the project workspace context and therefore participates in the existing `.hl-editor/project-context.json` checkpoint.

Review is tracked per `fragmentId` and per pass. Default passes:

1. Первичное чтение
2. Орфография и пунктуация
3. Стиль
4. Логика и continuity
5. Финальная проверка

Each reviewed unit stores a content fingerprint. If only one fragment changes later, only that fragment becomes `changed`; unrelated chapters remain reviewed. Scene/chapter/book status is derived from child units and is never a second source of truth.

Open text issues take precedence over a reviewed flag, so a fragment with an unresolved issue cannot be completed accidentally.

## Durable text anchors

New proofreading issues store:

- `fragmentId`;
- `startOffset` / `endOffset`;
- selected `quotedText`;
- short prefix/suffix context;
- fragment content hash.

When surrounding text changes, HEARTLINE tries to relocate the quote using its context. Ambiguous or stale anchors are surfaced rather than silently pointing to the wrong text. Legacy quote-only comments are upgraded automatically when their quote is unique in the fragment.

## Issue workflow

The proofreading UI uses a small editorial state machine:

```text
open → fix-proposed → verify → resolved
                       ↘ wont-fix
```

Legacy HEARTLINE review statuses remain as compatibility fields, but GPT is no longer represented as a status. Automation origin belongs in `review.automation`.

## Editing and visual independence

Edits made from Proofreading Workspace update `workspace.textEdits` and the normal change-event history, but they do **not** invalidate approved visual assignments. Punctuation and spelling changes therefore do not create fake visual work.

Semantic visual impact remains an explicit production decision in the visual workflow.

## Search / replace

Search supports:

- entire book;
- current chapter;
- only unchecked fragments;
- only fragments changed after review;
- case sensitivity;
- safe regular expressions;
- preview before commit.

Bulk replace creates a safety revision for source-backed projects before changing the workspace. Source save then runs through the existing conflict/recovery pipeline.

## Local deterministic checks

The built-in checker never sends novel text to an external service. It can report:

- repeated spaces;
- whitespace before punctuation;
- trailing whitespace;
- repeated adjacent words;
- mixed Cyrillic/Latin tokens;
- straight quotes in Russian-text policy;
- hyphen between spaces instead of dash;
- optional repeated punctuation;
- project terminology variants;
- configured forbidden words/forms.

Findings can be fixed when a deterministic replacement exists, converted to a normal anchored review issue, or ignored.

## Project dictionary

The project proofreading context stores canonical terms, known variants and notes. This is intended for names, locations, titles, forms of address and other terminology that generic spellcheckers cannot know.

## Interactive-route coverage

If source metadata contains `reviewRoutes`, Proofreading Workspace calculates route coverage from scene completion. Shared scenes are reviewed once and contribute to every route containing them; branch-exclusive scenes remain visible until covered.

## Final approval

Granular completion is independent from the project-level source hash. On the final pass, completing the whole book also calls Project Core's hash-bound review/approval use case for source-backed projects. A later source change therefore invalidates project approval while preserving granular information about exactly which fragment changed.
