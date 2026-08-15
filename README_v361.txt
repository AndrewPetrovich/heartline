HEARTLINE Editor 3.6.1 — Proofreading-first Library Cards
=========================================================

Proofreading comments
---------------------
The persistent blue onboarding card is removed from the normal comments panel.
It consumed too much vertical space in the main proofreading workspace. The
existing compact review form remains available without duplicated guidance.

Library cards
-------------
Cards now answer the editorial question first: "How ready is this novel?"

Visible information per project:
- proofreading status: Not started / In progress / Needs attention / Proofread;
- large proofreading percentage;
- checked fragments / total fragments;
- fragments remaining;
- open text reviews;
- fragments changed after proofreading;
- last proofreading chapter and scene.

Structural and visual-production statistics remain available under the
"Структура и производство" disclosure, but no longer compete with proofreading
readiness on the first visual level.

Desktop density
---------------
The old 4-column micro-card layout and 560px minimum card height are overridden.
Cards use readable 360–420px columns, larger typography, and natural height.

Architecture
------------
All changes remain in Presentation / Design System. The Library card numbers are
read from the same ProofreadingService model used by the Proofreading workspace;
there is no duplicate review-state source of truth.
