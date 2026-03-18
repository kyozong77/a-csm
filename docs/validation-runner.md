# Validation Runner (RZV-102 Integration)

`scripts/validation-runner.mjs` links annotation IRR output to validation stage evaluation.

## Command

```bash
npm run validation:run -- \
  --batch config/annotation-batch.sample.json \
  --metrics config/validation-metrics.sample.json \
  --output logs/validation-runner-result.json \
  --target-kappa 0.61
```

## Enforce readiness

```bash
npm run validation:run -- \
  --batch config/annotation-batch.sample.json \
  --metrics config/validation-metrics.sample.json \
  --enforce-all
```

The bundled sample batch is available at `config/annotation-batch.sample.json`.

When `--enforce-all` is enabled, exit code is `1` if either:

- IRR target is not met (`cohens_kappa < target_kappa`)
- Any validation stage is not `passed`

## Output

- `irr_report`: batch IRR metrics
- `validation_report`: five-stage readiness report
- `summary.readiness`: `ready` or `not_ready`

## Test

```bash
node --test test/validation-runner.test.mjs
```
