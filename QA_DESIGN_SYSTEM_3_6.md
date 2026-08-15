# HEARTLINE 3.6 — UX / Design System QA

Base audited and used for this update:
`abea3d4f980dc2328be70a2f5f1c70a021d2fb5e`

## Automated result

```text
npm test
53 tests / 53 pass
0 fail

npm run check
PASS

Typography/UI simplification policy: PASS
```

## New design-system regressions

- design system is loaded from the Presentation entry point;
- Presentation Design System does not directly import DB/infrastructure;
- ActionCallout has a single blue primary CTA language;
- Library, Storyboard, Graph, Reviews, Export and Versions have dedicated UI enhancers;
- Graph advanced controls are moved behind progressive disclosure;
- Storyboard actions are quiet until card engagement on desktop;
- proofreading normal chrome removes persistent technical fragment ID;
- Undo/Redo utilities become contextual;
- Design System defines no font weight above 600.

## Existing safety regressions retained

The existing suite still passes for:

- stable projectId / document identity;
- source conflict protection;
- recovery after failed save;
- revision throttling;
- context rehydration;
- ZIP safety;
- granular reviewedHash;
- durable review anchors;
- proofreading forward completion;
- source-backed project approval;
- typography/readability rules.

This update contains no business-domain or persistence changes.
