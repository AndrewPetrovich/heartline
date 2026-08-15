# HEARTLINE 3.6.1 — QA

Base: `f263a242d4e7d611d1eb5a42bd50352a62013015`

## Automated result

```text
npm test
56 tests / 56 pass
0 fail

npm run check
PASS
Typography/UI simplification policy: PASS
```

## New regressions

- persistent proofreading onboarding callout is absent;
- Library card readiness comes from the ProofreadingService model;
- Library cards show `Готовность вычитки`;
- open reviews and changed-after-review counts are represented;
- last proofreading position is represented;
- desktop Library layout no longer uses the 4-column micro-card presentation;
- Library title and primary card controls use readable sizes;
- Design System remains Presentation-only and imports no persistence layer;
- max visual font weight remains 600.

## Existing safety regressions retained

Stable project identity, source conflict protection, recovery, revisions,
context rehydration, ZIP safety, granular reviewedHash, durable anchors and
proofreading forward completion all remain green.
