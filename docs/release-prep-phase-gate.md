# A-CSM Release Prep Checklist And Phase Gates

## Objective

This document defines the local-only preparation workflow that must pass before A-CSM is pushed to a public repository.

## Naming And Version Policy

- Official first mention: `A-CSM: AI Contextual Signal Matrix`
- Short form: `A-CSM`
- Traditional Chinese formal name: `AI 對話語境偵測系統 (A-CSM)`
- Public-facing release label: `v0.1.0`
- Engineering version: `0.1.0`

## Phase 0: Scope Freeze

Checklist:

- Core release scope is limited to the A-CSM pipeline, tests, configs, and docs.
- Public repository URL is not claimed until the canonical remote is decided.
- Raw real-world transcripts remain outside the public repository.

Gate:

- No stale clone URL, remote URL, or personal absolute path remains in public-facing files.

## Phase 1: Identity And Packaging

Checklist:

- `README.md`, `package.json`, `CITATION.cff`, `CHANGELOG.md`, `ROADMAP.md`, and `CONTRIBUTING.md` are aligned.
- `workspace-audit` uses repository-portable rules.
- Container files reflect actual runtime intent.

Gate:

- Project naming, release labels, and engineering version are internally consistent.

## Phase 2: Quality Gates

Run:

```bash
npm run lint:syntax
npm test
npm run test:coverage
npm run performance:baseline
npm run security:scan
npm run audit:workspace
npm run acsm:run -- --input config/acsm-orchestrator-input.sample.json --config config/acsm-orchestrator.json --output logs/acsm-orchestrator-result.json --format both
npm run acsm:run:200
npm run regression:check
```

Gate:

- Every command exits `0`.
- Workspace audit reports `READY`.
- No generated artifact exposes a private absolute path.

## Phase 3: Validation Transparency

Checklist:

- Public docs explain annotation workflow, IRR target, and validation thresholds.
- Public-facing planning docs include `evaluation-plan`, `public-claims-policy`, and `limitations`.
- Synthetic fixtures and private real-world holdout policy are separated.
- Public readers can understand what is already validated and what remains pre-empirical.

Gate:

- An independent reviewer can answer:
  - what data is public,
  - what data is private,
  - what the ground-truth baseline is,
  - what the current limitations are,
  - and which public claims are already supportable.

## Phase 4: Reviewer Pass

Reviewer workflow:

- Codex lane A: repository identity, docs, roadmap, and release framing
- Codex lane B: CI, tooling, audit, container, and reproducibility checks
- Claude Code CLI: end-of-phase reviewer only

Gate:

- Reviewer signs off that the repository reads as an intentional research tool rather than an exploratory draft.
- Public push is blocked until all prior gates pass.

## Final Push Criteria

- Canonical public remote exists.
- Public branch history is curated.
- Release note is prepared.
- Tag is ready.

Only after all criteria pass should the repository be pushed to a public Git hosting platform.
