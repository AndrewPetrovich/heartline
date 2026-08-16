# HEARTLINE 3.6.4 — QA

Local contract tests:

```text
6 tests
6 pass
0 fail
```

Validated:
- readiness card is restored;
- it reads from HEARTLINEProofreading.service;
- percentage / remaining / reviews / changed / last position are present;
- structure and production remain removed;
- asynchronous rendering is guarded against duplicate readiness cards;
- no persistence or project identity logic is touched.
