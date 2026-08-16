# HEARTLINE 3.7 — Architecture QA

The package includes new unit/contract tests for:

- StoryProfileRegistry and the isolated legacy story profile;
- SourceAdapterRegistry and adapter-specific `novel.json` policy;
- Presentation dependency direction;
- single Presentation lifecycle observer;
- absence of legacy route constants from generic Parser/Engine/Graph;
- composition-root ownership of infrastructure construction.

After applying the migration to the repository, run:

```text
npm run verify-repository
npm test
npm run check
```

`npm run check` includes the architecture gate.
