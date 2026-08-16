# HEARTLINE 3.8 — Preview Lab Architecture

## Goal

Preview is a Presentation feature over configurable viewport profiles. Device
geometry must not be hardcoded in the renderer or in `heartline-app.js`.

## Layers

```text
Presentation
  heartline-app.js
  heartline-player-renderer.js
  hl-editor/preview/presentation/preview-lab.css
        ↓
Application
  DeviceProfileService
        ↓
Domain
  DeviceProfile geometry / orientation / scaling
        ↑
Infrastructure
  Built-in device profile catalog
```

`bootstrap/composition-root.js` constructs `DeviceProfileService` and injects
the built-in catalog. Presentation receives the service through the existing
Application service container.

## Device catalog

The default catalog contains representative viewport classes:

- iPhone Compact;
- iPhone Standard;
- iPhone Pro;
- iPhone Max;
- Android Compact;
- Android Standard;
- Android Large / Ultra;
- Foldable outer display;
- Foldable inner display.

The exact dimensions and safe-area values live in one infrastructure catalog,
not across the UI or renderer.

A custom viewport can be entered without changing application code.

## Preview UI

Single-device mode:
- responsive Fit / 50% / 75% / 100% / 125% scaling;
- safe-area overlay;
- direct focal-point drag;
- Ctrl/Command + wheel zoom;
- orientation switch;
- device-specific visual overrides.

Comparison mode:
- up to four user-selected profiles;
- presets: Essential, iOS, Android, Edge cases;
- comparison diagnostics matrix.

## Diagnostics

The domain diagnostics now include:
- effective font size;
- safe-area geometry;
- panel ratio against usable viewport;
- missing/low-resolution visual;
- long text;
- focal overlap;
- minimum text size;
- choice touch target;
- excessive choice count.

Rendered Preview additionally checks whether the panel reaches the top safe
area and whether an actual rendered option is smaller than the target size.

## Runtime closure

3.7 moved StoryEngine to StoryProfiles, but the existing runtime exporter still
copied raw modules without all imported dependencies. 3.8 closes that runtime
module graph and also includes the new generic device-profile dependency.

This is a compatibility fix, not a second architecture.
