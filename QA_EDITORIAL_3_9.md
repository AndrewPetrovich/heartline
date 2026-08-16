# HEARTLINE 3.9 — QA

Local package validation:

```text
Editorial Domain/Application unit tests:
7 tests / 7 PASS

New JavaScript modules:
syntax PASS

CRLF/LF-safe migration fixture:
PASS

Editorial architecture gate fixture:
PASS
```

Covered regression contracts:
- final review is bound to both text and visual hashes;
- text change invalidates final review;
- visual/crop change invalidates final review;
- missing image blocks final completion;
- open remarks keep the final unit unfinished;
- error-level Preview diagnostics block final completion;
- final stage may re-confirm clean current text;
- visual progress is derived from real workspace assignments;
- three stage percentages are independent;
- final stage shows both text and visual remarks already stored for the fragment;
- Presentation does not import DB/Infrastructure;
- no additional MutationObserver is introduced;
- old standalone Proofreading Presentation is removed from composition entry;
- legacy Reader/Preview routes delegate to Editorial Workspace;
- standalone Preview menu entry is removed;
- migration is CRLF/LF safe;
- new workspace has no UI text below 11px and no font weight above semibold.

Full repository release gate after applying:

```powershell
npm.cmd run verify-repository
npm.cmd test
npm.cmd run check
```
