# Annotation Workflow (RZV-101)

`scripts/annotation-workflow.mjs` provides a dual-rater annotation flow for pilot IRR work.

## Commands

Generate a dual-rater template from markdown transcript or input-contract JSON:

```bash
npm run annotation:cli -- template \
  --input config/input-contract-input.sample.md \
  --output logs/annotation-template.json \
  --batch-id pilot-001 \
  --conversation-id conv-001 \
  --target-count 100
```

Calculate IRR (Cohen's Kappa) from an annotation batch:

```bash
npm run annotation:cli -- irr \
  --input logs/annotation-template.json \
  --output logs/annotation-irr-report.json \
  --target-kappa 0.61
```

Enforce kappa threshold as exit code:

```bash
npm run annotation:cli -- irr \
  --input logs/annotation-template.json \
  --target-kappa 0.61 \
  --enforce-target
```

Show batch progress summary:

```bash
npm run annotation:cli -- progress --input logs/annotation-template.json
```

## Data Model

- `batch_id`: batch identifier
- `target_count`: pilot target (default `100`)
- `completed_count`: completed conversation count
- `conversations[].turns`: turn list for annotation
- `conversations[].rater_a` / `rater_b`: annotation item arrays
- `conversations[].cohens_kappa`: optional per-conversation IRR cache

## IRR Logic

- Unit of agreement is per turn.
- Severity label is the maximum severity annotated by each rater on that turn.
- Missing turn annotation is treated as severity `0`.
- Batch kappa is weighted by conversation unit count.

## Test

```bash
node --test test/annotation-workflow.test.mjs
```

