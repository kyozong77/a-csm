# A-CSM Validation Pipeline

`scripts/acsm-validation-pipeline.mjs` runs validation readiness and orchestrator in one command.

## What It Does

1. Compute IRR + readiness via `validation-runner`
2. Inject readiness into orchestrator input (`validation.readiness`)
3. Run orchestrator and release gate with the injected readiness

## Run

```bash
npm run acsm:run:validated -- \
  --annotation-batch config/annotation-batch.sample.json \
  --orchestrator-input config/acsm-orchestrator-input.sample.json \
  --orchestrator-config config/acsm-orchestrator.validation-gate.json \
  --validation-metrics config/validation-metrics.sample.json \
  --artifact-dir logs/release-artifacts \
  --release-gate-input-output logs/release-gate-input.from-validation.json \
  --output logs/acsm-validation-pipeline-result.json \
  --format both
```

## Exit Codes

- `0`: final decision `GO`
- `1`: final decision `NO_GO`
- `2`: missing required arguments

## Notes

- If orchestrator release gate enables `requireValidationReadiness`, non-ready validation blocks release.
- You can enable strict mode via `config/acsm-orchestrator.validation-gate.json`.
- Markdown orchestrator input is supported (`.md` / `.markdown`) through input-contract conversion.

## Fixed Release Artifacts (`--artifact-dir`)

When `--artifact-dir <dir>` is provided, the command writes deterministic artifacts:

- `validation-runner-result.json`
- `acsm-orchestrator-result.json`
- `acsm-validation-pipeline-result.json`
- `acsm-validation-pipeline-result.md` (`--format json` 時不產生)
- `acsm-validation-artifacts-index.json` (includes SHA-256, file size, summary)

## Release Gate Input Export (`--release-gate-input-output`)

When both options are provided:

- `--artifact-dir <dir>`
- `--release-gate-input-output <path>`

the pipeline also writes a ready-to-use release gate input JSON that includes:

- `artifacts.present` from artifact index file names
- `artifacts.hashes` from artifact index SHA-256 values
- `validation.readiness` from validation summary
- `meta.validationArtifactIndexPath` for traceability

Use the exported release-gate input with validation-artifact profile:

```bash
node scripts/release-gate.mjs \
  --input config/release-gate-input.from-validation.sample.json \
  --config config/release-gate.validation-artifacts.json \
  --output logs/release-gate-validation-artifacts-result.json \
  --format both
```

## Test

```bash
node --test test/acsm-validation-pipeline.test.mjs
```
