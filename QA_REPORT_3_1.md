# HEARTLINE Editor 3.1 — QA report

## Automated/browser checks performed

Chromium smoke test passed for all primary routes:
- Library
- Reader
- Storyboard
- Assets
- Preview
- Reviews
- Versions
- GPT
- Graph
- Export

No page errors were observed during the route pass.

## Responsive Reader

Checked viewports:
- 320×568
- 360×800
- 375×812
- 390×844
- 412×915
- 1440×900 desktop

For 8 consecutive Reader transitions at every mobile viewport:
- horizontal overflow: 0 px
- gap between current frame and mobile navigation: 8 px on every sampled frame
- mobile primary navigation: 5 destinations
- Reader settings sheet opens and exposes typography controls

Desktop context check:
- previous context is not `overflow:hidden`
- no detected scrollHeight/clientHeight clipping

## Functional additions validated

- two built-in projects appear in Library;
- Library dashboard metrics render for both projects;
- desktop grouped navigation and mobile five-item navigation render;
- Focus Mode activates on desktop Reader;
- Production Preflight renders and blocks production runtime with missing required visual assets;
- Asset import succeeds with the new image worker path and creates an asset card;
- Storyboard and Asset Library use bounded initial DOM windows with Load More;
- stable production module filenames resolve without old `v301/v304/v307` imports.

## Known intentional limitation

Automatic cross-device cloud sync is not enabled because the current deployment is static GitHub Pages and has no authenticated private backend/object storage. Project ZIP remains the supported transfer mechanism. `SYNC_BACKEND_SPEC.md` defines the backend contract for the future sync layer.
