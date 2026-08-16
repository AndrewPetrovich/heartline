# HEARTLINE 3.8 — Preview Lab QA

## Local package / migration-fixture validation

```text
Device/Profile + Preview architecture + Diagnostics + Runtime closure:
16 tests / 16 PASS

Preview architecture gate:
PASS

New JavaScript modules:
syntax PASS

CRLF/LF-safe migration fixture:
PASS
```

The fixture validates the exact migration contracts used against HEARTLINE
3.7.1, including:

- Application service injection;
- removal of `DEVICE_PRESETS` from Preview Presentation;
- replacement of the Preview workspace;
- enhanced `frameDiagnostics`;
- composition-root registration;
- index / service worker / repository wiring;
- runtime module dependency closure;
- package version/check scripts.

## Required validation in the complete repository

After applying the migration:

```powershell
npm.cmd run verify-repository
npm.cmd test
npm.cmd run check
```

The full repository test suite remains the release gate because this package
does not contain a complete checkout of the repository.
