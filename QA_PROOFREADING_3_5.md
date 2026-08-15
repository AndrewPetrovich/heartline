# HEARTLINE Editor 3.5 — Proofreading QA

## Automated result

```text
npm test
32 tests / 32 pass

npm run check
PASS
```

## New proofreading regressions covered

- five review passes are initialized deterministically;
- per-fragment reviewed hash invalidates only the changed fragment;
- unresolved text issue overrides reviewed state;
- durable text anchor relocates after surrounding text shifts;
- double spaces / repeated words / mixed scripts / dash / punctuation checks;
- project terminology proposes canonical spelling;
- potentially dangerous nested-quantifier regex is rejected;
- safe Unicode regex search/replace works;
- chapter aggregation preserves changed/attention priority;
- review route coverage handles a shared scene without requiring duplicate review;
- unresolved issue blocks fragment completion;
- new review stores offsets and simplified workflow state;
- proofreading text edit leaves approved visual assignment untouched;
- bulk replace creates a safety revision and invalidates the old reviewed hash;
- scene completion skips fragments with unresolved issues;
- final book approval invokes project-level hash-bound approval;
- unique legacy quoted comments are upgraded to durable anchors.

## Existing Project Core regressions retained

The 14 tests from 3.4 continue to pass, including reconnect identity, source conflict protection, recovery, source-write failure, revision throttling, context rehydration and ZIP safety.

## Static validation

`node --check` passes for Project Core and every module under `hl-editor/`, including all new proofreading modules.
