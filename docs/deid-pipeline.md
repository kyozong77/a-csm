# De-identification Pipeline (RZV-92)

Deterministic local-first PII scan + replacement pipeline for transcript-safe downstream processing.

## Covered PII Types

- `email`
- `phone`
- `ipv4`
- `tw_national_id`
- `credit_card` (Luhn validated)
- `query_secret` (sensitive URL query values such as token/password/api_key)

## CLI

```bash
npm run deid:check -- \
  --input config/deid-input.sample.json \
  --config config/deid-policy.json \
  --format both \
  --output logs/deid-result.json
```

## Output Summary

- `summary.totalReplacements`: total redactions performed.
- `summary.countsByType`: per-PII-type replacement counts.
- `summary.piiTypesDetected`: sorted detected type list.
- `summary.blockingFindings`: validation blockers count.

## Audit Fields

Each replacement entry includes:

- `type`
- `start` / `end` / `length`
- `digestBefore` (SHA-256 prefix; no raw sensitive value)
- `replacement`
- optional `turnId` and `turnIndex`

## Validation Coverage

`test/deid-pipeline.test.mjs` verifies:

- stable detection and replacement by type
- false-positive control (invalid IDs/cards/IP)
- replacement strategy behavior (`indexed-token`, `fixed-token`)
- max-per-type auditing
- text mode and turns mode
- CLI success/failure exit behavior
