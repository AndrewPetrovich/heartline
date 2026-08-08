# HEARTLINE Editor 3.1 architecture

Runtime modules now use stable names. Release numbers live in `window.HEARTLINE_BUILD`, the Service Worker cache key and package metadata—not in module filenames.

Core layers: `heartline-domain.js`, `heartline-engine.js`, `heartline-db.js`, `heartline-assets.js`, `heartline-player-renderer.js`, `heartline-graph.js`, import/export, and the application orchestration layer.

Reader is split into shared ReaderCore content plus explicit desktop/mobile chrome. Large asset work is offloaded to `heartline-image-worker.js` when Worker + OffscreenCanvas are available.

`npm run build` emits a `dist/` folder with content-hashed top-level app/CSS assets and generated Service Worker. CI runs responsive Reader regression checks.

## Cross-device sync
Automatic cloud sync is intentionally not faked. GitHub Pages is static hosting and provides neither private per-user storage nor application authentication. Project ZIP remains the safe transfer mechanism until a real authenticated backend/object store is connected.
