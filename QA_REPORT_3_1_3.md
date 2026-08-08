# HEARTLINE Editor 3.1.3 — QA summary

## Scope
Rich project cards in Library: covers, project statistics, caching, project menu, archive/search/sort, last working position.

## Static checks
- All runtime JavaScript files pass `node --check`.
- `novel.json`, `moon-oath.json`, `manifest.webmanifest`, `package.json` parse successfully.
- All local `src`/`href` references from `index.html` exist.
- Production build script completes and copies the new statistics and library-card modules to `dist/`.

## Statistics smoke test

### Последняя подача
- chapters: 10
- scenes: 52
- frames: 1504
- choice options: 40
- significant options: 40
- endings: 3
- structural/state branch points: 14
- words: 15 824
- estimated single-route reading time: ≈ 40–45 min
- estimated unique route content: 70%

### Лунная клятва
- chapters: 12
- scenes: 81
- frames: 2560
- choice options: 42
- significant options: 42
- endings: 3
- structural/state branch points: 13
- words: 24 252
- reading time: 110–125 min (source: `storyMetadata.targetRuntimeMinutes`)
- estimated unique route content: 5%

The UI intentionally displays source-derived/current-project values rather than numbers from the design reference image.

## Data safety
- No IndexedDB schema deletion or reset.
- Existing projects without cover/statistics fields remain valid.
- Statistics are stored as optional project metadata and can be recalculated.
- Cover is stored as a normal project Asset and exported with Project ZIP.
