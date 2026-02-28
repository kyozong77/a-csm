# A-CSM Batch Runner (200-case default)

`scripts/acsm-batch-runner.mjs` runs `acsm-orchestrator` over many inputs with a deterministic batch policy.

## Core behavior

- Default maximum batch size: `200` cases
- Optional early stop when a case returns `NO_GO`
- Optional inclusion of full per-case orchestrator result payloads
- Optional resume mode from a previous batch result file (`--resume-from`)

## Input formats

1. Cases wrapper:

```json
{
  "cases": [
    {
      "id": "case-1",
      "input": {
        "turns": [
          { "id": "T1", "role": "user", "text": "..." }
        ]
      }
    }
  ]
}
```

2. Array shorthand:

```json
[
  { "turns": [{ "id": "T1", "role": "user", "text": "..." }] },
  { "text": "single turn shorthand" }
]
```

## Run batch

```bash
node scripts/acsm-batch-runner.mjs \
  --input config/acsm-batch-input.200.sample.json \
  --config config/acsm-orchestrator.json \
  --output logs/acsm-batch-200-result.json \
  --format both
```

## CLI options

- `--input <path>`: batch input file (required)
- `--config <path>`: orchestrator config file
- `--output <path>`: output path
- `--format json|markdown|both`: output format (default `json`)
- `--max-cases <int>`: maximum allowed case count (default `200`)
- `--stop-on-no-go [true|false]`: stop early when first NO_GO appears
- `--include-results [true|false]`: include full per-case orchestrator outputs
- `--resume-from <path>`: reuse completed case decisions from previous batch output

## Exit codes

- `0`: all processed cases are `GO` and no blocking batch finding
- `1`: at least one case is `NO_GO`, or batch validation failed
- `2`: CLI argument error (missing `--input`)
