# A-CSM v0.1.0 Public Core Manifest

This document defines the concrete scope of the GitHub upload package for `A-CSM v0.1.0`.

## Release Intent

This package is the public, reproducible, and runnable core release of `A-CSM: AI Contextual Signal Matrix`.

It is limited to the deterministic baseline that can be cloned, executed locally, inspected directly, and validated with released fixtures.

## Included Runtime Surface

The public core includes the following executable path:

1. `scripts/input-contract.mjs`
2. `scripts/deid-pipeline.mjs`
3. `scripts/event-engine-v1.mjs`
4. `scripts/vcd-inference.mjs`
5. `scripts/ledger-repeat-engine.mjs`
6. `scripts/tag-escalation.mjs`
7. `scripts/ps-sub-fe-core.mjs`
8. `scripts/schema-invariant-service.mjs`
9. `scripts/release-gate.mjs`
10. `scripts/acsm-orchestrator.mjs`

The package also includes the released support scripts required for batch execution, validation, regression review, and release verification:

- `scripts/acsm-batch-runner.mjs`
- `scripts/acsm-validation-pipeline.mjs`
- `scripts/acsm-validated-release.mjs`
- `scripts/validation-framework.mjs`
- `scripts/validation-runner.mjs`
- `scripts/regression-suite.mjs`
- `scripts/performance-baseline.mjs`
- `scripts/security-scan.mjs`
- `scripts/workspace-audit.mjs`

## Included Release Assets

- `config/` sample inputs and released configuration files
- `test/` automated test suite and released fixtures
- `docs/` runtime, validation, release, and limitations documentation
- `CITATION.cff`
- `docs/report-metadata/` report DOI metadata and bibliography only
- `LICENSE`
- `.github/workflows/ci.yml`

## Explicitly Excluded

The public core does not include:

- private taxonomy
- proprietary scoring logic
- private evaluation assets
- confidential evaluation layers
- unreleased datasets
- internal semantic layers
- confidential decision routing
- runtime intervention systems
- technical report source files, PDFs, and report assets

## Minimum Local Verification Path

Run the following commands from repository root:

```bash
npm run lint:syntax
npm test
npm run test:coverage
npm run performance:baseline
npm run security:scan
npm run audit:workspace
npm run acsm:run -- \
  --input config/acsm-orchestrator-input.sample.json \
  --config config/acsm-orchestrator.json \
  --validation config/validation-runner-result.sample.json \
  --output logs/acsm-orchestrator-result.json \
  --format both
npm run acsm:run:200
npm run regression:check
```

## Authority Order

If release-boundary statements conflict, use the following order:

1. repository root `README.md`
2. `docs/acsm-orchestrator.md`
3. `docs/input-contract.md`
4. `docs/public-v1-core-verification-2026-03-18.md`
5. this manifest
