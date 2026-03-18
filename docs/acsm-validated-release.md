# A-CSM Validated Release Runner

`scripts/acsm-validated-release.mjs` runs the full release-ready path in one command:

1. validation pipeline (`validation-runner` + orchestrator)
2. fixed artifact bundle export
3. release-gate evaluation using validation-artifact profile

## Run

```bash
npm run acsm:run:release -- \
  --annotation-batch config/annotation-batch.sample.json \
  --orchestrator-input config/acsm-orchestrator-input.sample.json \
  --validation-metrics config/validation-metrics.sample.json \
  --artifact-dir logs/release-artifacts \
  --release-gate-input-output logs/release-gate-input.from-validation.json \
  --output logs/acsm-validated-release-result.json \
  --format both
```

## Default Release Gate Config

If `--release-gate-config` is not provided, the runner uses:

- `config/release-gate.validation-artifacts.json`

This profile requires:

- `validation.readiness = ready`
- required validation artifacts present
- SHA-256 hash for each required artifact

## Exit Codes

- `0`: final decision `GO`
- `1`: final decision `NO_GO` or runtime error
- `2`: missing required arguments

## Test

```bash
node --test test/acsm-validated-release.test.mjs
```
