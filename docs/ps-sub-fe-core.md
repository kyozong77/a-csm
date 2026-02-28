# PS/SUB/F/E Derivation Core

`RZV-95` implementation for deterministic `PS` / `SUB` / `F` / `E` derivation.

## Scope

- 0-4 ordinal scoring per axis (`FR`, `CA`, `SR`, `SA`).
- State derivation:
  - `ST_NRM` when score <= `nrmMax`
  - `ST_DEV` when `nrmMax` < score < `almMin`
  - `ST_ALM` when score >= `almMin`
- Tie-breaking for same-score subtype selection using `tieBreakOrder`.
- Collapse flag (`F`) and compact evidence summary (`E`) generation.

## CLI

```bash
npm run derive:ps -- \
  --input config/ps-sub-fe-input.sample.json \
  --config config/ps-sub-fe-core.json \
  --format both \
  --output logs/ps-sub-fe-result.json
```

## Output

JSON fields:

- `ps`: `ST_NRM` | `ST_DEV` | `ST_ALM`
- `sub`: `SUB_FR` | `SUB_CA` | `SUB_SR` | `SUB_SA` | `SUB_NONE` | `SUB_SAFE_MODE`
- `f`: `{ triggered, level, reasons }`
- `e`: safe evidence summary string
- `summary.overallScore`: final 0-4 ordinal score
- `trace` and `findings` for auditability

## Validation Coverage

`test/ps-sub-fe-core.test.mjs` includes:

- Region boundary consistency (`0..4` and custom threshold set)
- Tie-breaking determinism
- Collapse flag behavior
- Evidence ranking/fallback
- Config/input validation and safe fallback path
- CLI success and failure exit codes
