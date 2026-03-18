# Contributing to A-CSM

## Scope

A-CSM is a deterministic Node.js research implementation. Changes must preserve deterministic behavior, auditability, and release-gate clarity. The released core scoring path uses native Node.js modules only; optional auxiliary research utilities may use Python for dataset conversion or annotation support.
Contributions should be based on a reviewed local state rather than exploratory work.

## Working Model

- Use a local feature branch or worktree for all non-trivial edits.
- Consolidate publication-prep work locally before creating any future public split.
- Do not publish partial cleanup work to a public remote.

## Required Checks Before Merge

Run all commands from the repository root:

```bash
npm run lint:syntax
npm test
npm run test:coverage
npm run security:scan
npm run acsm:run -- --input config/acsm-orchestrator-input.sample.json --config config/acsm-orchestrator.json --output logs/acsm-orchestrator-result.json --format both
npm run acsm:run:200
npm run regression:check
```

If the change touches validation logic or annotation workflows, also run:

```bash
npm run validation:run -- --batch logs/annotation-batch.json --metrics config/validation-metrics.sample.json --output logs/validation-runner-result.json --target-kappa 0.61
```

## Coding Rules

- Do not add external npm dependencies.
- Keep runtime logic synchronous and deterministic.
- Use ESM only.
- Add or update tests for every behavior change.
- Do not weaken existing tests to make a change pass.

## Documentation Rules

- Use the official first mention: `A-CSM: AI Contextual Signal Matrix`.
- Use `A-CSM` after the first mention.
- Use the Traditional Chinese formal name only in Chinese-facing materials: `AI 對話語境偵測系統 (A-CSM)`.
- Keep any future public-facing documentation free of developer-specific absolute paths.

## Data Handling

- Never commit raw PII, private transcripts, or credentials.
- Keep real-world evaluation corpora outside any future public repository.
- Public fixtures must be synthetic, public-domain, or otherwise releasable.
- Private holdout sets must be de-identified and documented in a separate governance record.

## Commit Guidance

- Keep commits focused and reviewable.
- Prefer Conventional Commit prefixes such as `docs:`, `feat:`, `fix:`, and `chore:`.
- Before any future public release, squash or curate cleanup history so the initial public branch reads as intentional work rather than exploratory churn.
