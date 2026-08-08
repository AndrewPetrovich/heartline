# HEARTLINE Editor 3.1.4 — QA Report

## Scope

Release: **Compact Library + Nested Reader + Novel Updates**

The build was produced from the HEARTLINE 3.1.x codebase and the two user-supplied editor packages dated 2026-08-08.

## Source package reconciliation

### «Последняя подача» — Branching Edition 2.0

Source package reported / contained:

- 72 scenes
- 25 Choice nodes
- 61 options
- 1,673 dialogue / narration / thought image slots
- 106 explicit GOTO edges
- broken GOTO count: 0

HEARTLINE runtime/editor conversion:

- 72 scenes preserved
- 25 Choice nodes preserved
- 61 option variants preserved
- 1,673 source text frames preserved
- 25 Choice prompts represented as editor frames
- 1,698 total editor frames

### «Лунная клятва» — proofreading-v5-branch-lattice

Source package validation: **PASS**.

Source package reported / contained:

- 12 chapters
- 100 scenes
- 2,991 source blocks
- 27 unique Choice IDs / 31 Choice blocks
- 74 variables
- 26,816 words in the source all-branch report
- finals A / B / C
- target runtime 120–135 minutes

HEARTLINE runtime/editor conversion:

- 12 chapters preserved
- 100 scenes preserved
- 31 Choice frames
- 96 option variants
- source narration / dialogue / thought text preserved as individual frames
- branch markers converted to runtime IF controls
- choice effects converted to SET controls
- compound conditions `&&`, `||`, `!`, parentheses and comparisons supported by the Story Engine

## Browser checks

Chromium checks were run against a fresh local origin.

### Library

Viewport: 1600×1000

- project cards: 2
- desktop grid tracks: `368.5px 368.5px 368.5px 368.5px`
- four equal project-card columns reserved on wide desktop
- no JavaScript page errors during initial library render

Viewport: 390×844

- horizontal overflow: 0 px
- mobile library remains one-column

### Reader hierarchy

«Лунная клятва»:

- 12 chapter groups
- only the active chapter is open on entry
- 21 nested scene-family groups detected
- family `1.2 · Полевой стол` contains:
  - `1.2 · Полевой стол`
  - `1.2A · Звонок, который не решает за неё`

The hierarchy supports:

- Chapter → scene family → scene / variant
- auto-open active chapter and active family
- collapsed inactive chapters
- search-aware group expansion

### Syntax / build

- `node --check`: passed for application, engine, statistics, assets, graph, domain and DB modules
- `novel.json`: valid JSON
- `moon-oath.json`: valid JSON
- `npm run build`: passed
- generated build artifacts: content-hashed JS and CSS

## Data migration behavior

Built-in projects now compare the source `contentVersion` on startup.

When a newer built-in edition is detected:

1. a dirty workspace is saved as an autosave version;
2. the new source is stored as a new version rather than overwriting history;
3. visual assignments are carried over where the Fragment ID still exists;
4. carried approved visuals become `needs-review`;
5. reviews pointing to removed Fragment IDs are archived;
6. the statistics cache is invalidated;
7. IndexedDB itself is not deleted.

## Result

Release candidate status: **PASS for packaging**.
