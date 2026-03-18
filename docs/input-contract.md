# Input Contract + Preprocessor

Normalize markdown transcript input into stable turn records before entering the A-CSM pipeline.

## Features

- Stable turn IDs (`T001`, `T002`, ...)
- Speaker parsing from `User:`, `Assistant:`, `Human:`, `AI:`, `System:`
- Optional front matter metadata/config parsing
- Optional YAML/JSON config override loading
- Validation for empty transcript, invalid roles, duplicate IDs, and empty turns

## CLI

```bash
npm run input:check -- \
  --input config/input-contract-input.sample.md \
  --config config/input-contract-config.sample.yaml \
  --output logs/input-contract-result.json \
  --format both
```

The sample config is optional. If omitted, the command uses the built-in deterministic defaults defined in `scripts/input-contract.mjs`.

## Output

The command returns JSON with:

- `metadata`
- `turns`
- `config`
- `validation`
- `findings`
- `trace`

Exit code is `0` when input is valid and `1` when validation fails.

## Test

```bash
node --test test/input-contract.test.mjs
```
