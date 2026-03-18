# Schema + Invariant Validation Service (RZV-98)

`RZV-98` implementation for service-style `validate_usci_output` and `demo_run_usci` validation flow.

## What It Validates

- Top-level schema fields (`schemaVersion`, `ps`, `sub`, `f`, `e`, `vcd`, `event_log`)
- Enum checks for `PS/SUB` and event `axis/severity`
- Event-log consistency (`turn_index` non-negative and non-decreasing)
- Core invariants:
- `ps=ST_ALM` requires `f=true`
- `ps=ST_NRM` requires `sub` in `SUB_NONE|SUB_SAFE_MODE`
- `vcd.status=TRIGGERED` requires non-empty `vcd.trace`

## CLI

```bash
npm run schema:check -- \
  --input config/schema-invariant-input.sample.json \
  --config config/schema-invariant-service.json \
  --output logs/schema-invariant-result.json \
  --format both
```

Exit codes:

- `0`: all cases passed
- `1`: one or more cases failed
- `2`: CLI argument error (missing `--input`)

## Programmatic API

```js
import {
  validate_usci_output,
  demo_run_usci
} from "./scripts/schema-invariant-service.mjs";

const single = validate_usci_output(usciOutput, config);
const batch = demo_run_usci(batchInput, config);
```

## Input Modes

- Single object (`{...}`) -> one validation case.
- Array (`[{...}, {...}]`) -> batch validation.
- Cases wrapper (`{ cases: [{ id, output }, ...] }`) -> named batch cases.
