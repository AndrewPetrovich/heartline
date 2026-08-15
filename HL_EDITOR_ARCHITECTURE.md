# HEARTLINE Editor 3.4 — Project Core architecture

## Source of truth

A source-backed HEARTLINE project is a long-lived workspace over one source directory. The current browser adapter uses `novel.json` as the primary source document and keeps HEARTLINE context in `.hl-editor/` inside the same directory.

```text
Source directory
├─ novel.json                       # source of truth
└─ .hl-editor/
   ├─ context.json                  # projectId, documentId, source hash, review hash
   ├─ project-context.json          # workspace/reviews/cache metadata checkpoint
   ├─ assets/                       # HEARTLINE-owned visual context
   ├─ recovery/                     # pre-save and conflict recovery records
   ├─ revisions/                    # immutable previous source revisions
   └─ backups/                      # source + full HL context backups
```

IndexedDB remains an operational cache for the existing 3.x UI. It is not authoritative for source-backed text: every text save goes through `ProjectService.saveDocument()` and must successfully update the source document before HEARTLINE reports the source save as complete.

Transport-only imports remain supported as an explicit **Import As New** operation. They are marked `transportOnly` until attached to a source directory.

## Layers

```text
Presentation
  hl-editor/presentation/bridge.js
        ↓
Application
  ProjectService / ImportService
        ↓
Domain
  project identity, review hashes, archive policy
        ↓
Ports
  SourceProjectAdapter / ProjectContextRepository
        ↓
Infrastructure
  BrowserFsSourceProjectAdapter / BrowserProjectContextRepository
```

The existing Reader/Storyboard/Graph application remains a compatibility presentation during the transition. Project lifecycle, source saving, restore, revisions, backups, conflict detection and new import semantics are owned by Project Core.

## Project identity

New projects use UUID `projectId` values. A source project gets its identity once in `.hl-editor/context.json`; reconnect, restart, save, export, backup and restore reuse it. Existing pre-3.4 project IDs are preserved for compatibility rather than silently rewritten during migration.

Each source document gets a UUID `documentId`. Missing fragment identities created by the new transport import flow are UUID-backed instead of path/order-derived.

## Save protocol

```text
edit
→ dirty workspace
→ debounce
→ SaveDocument
→ read actual source
→ compare actual hash with expected hash
→ conflict OR continue
→ revision policy
→ recovery record
→ temp/commit write
→ re-read and verify hash
→ update source binding/context hash
→ checkpoint .hl-editor context
→ mark recovery committed
```

An external modification never triggers a silent overwrite. HEARTLINE stores the attempted local content in recovery and sets the workspace to `conflict`.

The browser filesystem adapter uses a temporary sibling file and `FileSystemHandle.move()` when the browser provides it. Where that API is unavailable, `FileSystemWritableFileStream.close()` is the commit boundary and the pre-save recovery/revision remains the crash-safety fallback. A future Tauri/native adapter can implement strict OS atomic replace behind the same port.

## Revisions and recovery

Autosave revisions are content-hash based and rate-limited; recovery is created before each destructive source write. Manual revisions never switch `projectId` or replace the source. Opening an old revision from the 3.x Versions UI is intercepted for source-backed projects and becomes an explicit restore with backup + safety revision.

## Review validity

Project review state stores `reviewedHash` and `reviewedAt`. A previously reviewed/approved project becomes `in-progress` whenever the current source hash differs from `reviewedHash`.

## Import / restore

Transport import follows parse → normalize → validate → preview → commit and creates a new UUID project only because **Import As New** is explicit.

Project ZIP restore preserves the package `projectId`. If that project already exists, HEARTLINE creates a safety snapshot (and a filesystem backup for source-backed projects) and restores into the same identity instead of creating a timestamp copy.

ZIP input is validated for path traversal, entry count, compressed/uncompressed size and suspicious compression ratio before payload extraction.

## Migration

IndexedDB schema version 4 adds source bindings, recovery and safety snapshots. v2 repair is prepared in memory and committed in one multi-store transaction. A pre-migration safety record is written first. Partially migrated v3 state is detected by checking active version/workspace integrity instead of treating any existing `projects` row as successful migration.

## Definition of Done for Project Core

- reconnecting a source directory preserves `projectId`;
- normal save updates `novel.json`, not a new project;
- external source changes produce `conflict`;
- failed writes preserve recovery;
- revisions do not occur per character;
- `.hl-editor` can repopulate lost browser context;
- Project ZIP restore preserves identity;
- archive inputs are resource/path checked;
- critical project rules have repeatable Node tests.
