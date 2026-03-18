# Validation Framework (RZV-102)

`scripts/validation-framework.mjs` defines the pre-empirical to empirical validation workflow.

## Scope

- Five-stage validity framework
- Pilot study configuration (`100` conversations default)
- Stage evaluation report
- Basic statistics utilities for analysis readiness

## Commands

Generate framework blueprint:

```bash
npm run validation:cli -- plan --output config/validation-framework.sample.json
```

Evaluate stages from metrics + IRR report:

```bash
npm run validation:cli -- evaluate \
  --metrics config/validation-metrics.sample.json \
  --irr-report config/annotation-irr-report.sample.json \
  --output config/validation-evaluation.sample.json
```

Enforce all stages pass (CI-friendly):

```bash
npm run validation:cli -- evaluate \
  --metrics config/validation-metrics.sample.json \
  --irr-report config/annotation-irr-report.sample.json \
  --enforce-all
```

Calculate descriptive + confusion matrix stats:

```bash
npm run validation:cli -- stats --values 0.7,0.8,0.75 --tp 8 --fp 2 --fn 1 --tn 9
```

## Stage Thresholds

- Stage 1 `Content Validity`: `expert_agreement_rate >= 0.80`
- Stage 2 `Construct Validity`: `cfi_tli >= 0.90`
- Stage 3 `Criterion Validity`: `pearson_r >= 0.50`
- Stage 4 `Inter-Rater Reliability`: `cohens_kappa >= 0.61`
- Stage 5 `Test-Retest`: `icc >= 0.70`

## Test

```bash
node --test test/validation-framework.test.mjs
```
