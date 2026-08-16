# HEARTLINE 3.7 Architecture

## Dependency direction

```text
Presentation → Application → Domain / Ports ← Infrastructure
                         ↑
                  bootstrap/composition-root
```

### Composition root
`hl-editor/bootstrap/composition-root.js` is the only place that constructs Project, Proofreading, source-adapter, sample-catalog and story-profile infrastructure.

### Legacy UI boundary
`heartline-app.js` no longer imports IndexedDB or asset infrastructure directly. It reaches the old APIs through transitional Application gateways. These gateways are intentionally narrow migration boundaries and must shrink over time; new features may not add new direct persistence calls to Presentation.

### Legacy domain adapters
`heartline-domain.js` and `heartline-db.js` no longer discover the parser through `window`. The composition root injects the parser adapter once at startup.

### Story profiles
Novel-specific route names, variables, chapter naming conventions and dynamic GOTO rules live only in `hl-editor/infrastructure/story-profiles/`. Generic Parser, StoryEngine and GraphModel resolve a `StoryFormatProfile` instead of knowing a specific novel.

### Source adapters
`novel.json` is no longer a Project Core policy. It belongs to the concrete HEARTLINE JSON source adapter. `SourceAdapterRegistry` allows future Markdown/folder/other adapters without changing ProjectService.

### Presentation lifecycle
There is one `MutationObserver`, owned by `presentation-coordinator.js` and scoped to the root view. Bridge, Proofreading, typography and Design System expose idempotent `enhance()`/`apply()` hooks instead of observing the whole document independently.

### Architecture gate
`npm run check` now includes `tools/verify-architecture.mjs`, preventing direct Presentation→IndexedDB/Infrastructure imports, duplicate MutationObservers and reintroduction of known legacy route constants into generic Parser/Engine/Graph files.
