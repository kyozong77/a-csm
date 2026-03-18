# Ledger + Repeat Handling Engine

`RZV-94` implementation for deterministic `fact/commitment/context` ledger construction and repeat-state handling.

## What It Does

- Validates event schema and `turn_range` / `turn_index` consistency.
- Routes each event to one of three ledgers: `fact`, `commitment`, `context`.
- Tracks repeat states per signature (`ledgerType:entryKey`) with deterministic transitions:
  - `NEW`
  - `REPEATED`
  - `ESCALATED`
  - `RESOLVED`
- Produces structured `trace`, `findings`, and summary counts.

## Config

See [`config/ledger-repeat-engine.json`](../config/ledger-repeat-engine.json).

- `repeatWindowTurns`: max turn-distance to consider a repeat chain.
- `escalateRepeatCount`: repeat count threshold to escalate.
- `maxRangeSpan`: max allowed `turn_range` span.
- `enforceMonotonicTurns`: require non-decreasing normalized turn order.
- `requirePayloadObject`: force payload type to be object.
- `allowCrossLedgerDuplicateKey`: if false, same `entryKey` cannot appear across ledgers.

## CLI

```bash
npm run ledger:check -- \
  --input config/ledger-repeat-input.sample.json \
  --config config/ledger-repeat-engine.json \
  --output logs/ledger-repeat-result.json \
  --format both
```

- `--format json|markdown|both` (default `json`)
- Exit code `1` when blocking findings exist.

## Output

- JSON result with `ledger`, `decisions`, `summary`, `trace`.
- Optional Markdown sidecar (`.md`) when `--format both`.
