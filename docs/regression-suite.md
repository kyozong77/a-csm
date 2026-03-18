# Regression Suite (RZV-99)

This repository includes a deterministic golden regression checker:

- Script: `scripts/regression-suite.mjs`
- Test fixtures: `test/fixtures/regression/*.json`
- Test file: `test/regression-suite.test.mjs`

## Input format

Both baseline and candidate files must be JSON objects with a `cases` array.

```json
{
  "cases": [
    {
      "id": "case-id",
      "output": { "any": "json-compatible value" }
    }
  ]
}
```

## Run

```bash
npm run regression:check -- \
  --baseline test/fixtures/regression/baseline.sample.json \
  --candidate test/fixtures/regression/candidate.sample.json \
  --previous-report logs/regression-report-prev.json \
  --strict-warnings \
  --format both \
  --output logs/regression-report.json
```

## CLI options

- `--baseline <path>`: baseline suite JSON (required)
- `--candidate <path>`: candidate suite JSON (required)
- `--output <path>`: output file path
- `--format json|markdown|both`: output format (default: `json`)
- `--previous-report <path>`: previous regression report for trend comparison
- `--strict-warnings`: treat warning failures as blocking failures

## Failure categories

- `invalid-suite`
- `invalid-cases`
- `invalid-case`
- `invalid-case-id`
- `duplicate-case-id`
- `missing-case`
- `unexpected-case`
- `output-mismatch`

`unexpected-case` is warning-only, while all others are blocking.

## Report extensions

The report includes:

- `schemaVersion`
- `summary.passRate` / `summary.failRate`
- `summary.failureCounts`
- `summary.mismatchTypeCounts`
- `summary.strictWarningsApplied`
- `trend` (when `--previous-report` is provided)
- `smoke` (report invariant validation result)
