# A-CSM Orchestrator (RZV-100)

`scripts/acsm-orchestrator.mjs` provides a deterministic end-to-end A-CSM execution pipeline.

## Stages

1. De-identify transcript content (`deid-pipeline`)
2. Detect four-axis risk events (`event-engine-v1`)
3. Infer VCD defense posture (`vcd-inference`)
4. Build repeat-aware ledgers (`ledger-repeat-engine`)
5. Compute TAG escalation level (`tag-escalation`)
6. Derive `PS/SUB/F/E` (`ps-sub-fe-core`)
7. Validate USCI schema and invariants (`schema-invariant-service`)
8. Evaluate release gate readiness (`release-gate`)

## Input

Supports:

- `turns` mode
- `text` shortcut mode (normalized to a single turn)
- markdown transcript mode (`.md` / `.markdown`) via `input-contract`

Example:

```json
{
  "turns": [
    {
      "id": "T1",
      "role": "user",
      "sourceTrust": "trusted",
      "boundaryBypass": false,
      "text": "Please summarize the confirmed requirements."
    }
  ]
}
```

Markdown transcript example:

```markdown
User: Please summarize the confirmed requirements.
Assistant: I will keep the summary aligned with validated scope.
```

## Run

```bash
node scripts/acsm-orchestrator.mjs \
  --input config/acsm-orchestrator-input.sample.json \
  --config config/acsm-orchestrator.json \
  --validation config/validation-runner-result.sample.json \
  --output logs/acsm-orchestrator-result.json \
  --format both
```

Or via npm script:

```bash
npm run acsm:run -- \
  --input config/acsm-orchestrator-input.sample.json \
  --config config/acsm-orchestrator.json \
  --validation config/validation-runner-result.sample.json \
  --output logs/acsm-orchestrator-result.json \
  --format both
```

Markdown transcript run:

```bash
npm run acsm:run -- \
  --input config/input-contract-input.sample.md \
  --config config/acsm-orchestrator.json \
  --output logs/acsm-orchestrator-from-md.json \
  --format both
```

## Output Highlights

- `decision`: `GO | NO_GO`
- `summary`:
  - `inputFormat`
  - `releaseGateDecision`
  - `validationReadiness`
  - `schemaDecision`
  - `tagDecisionLevel`
  - `vcdStatus`
  - `blockingFindings`
- `inputContract` (only when markdown input is used)
- `steps`: raw stage results for each engine
- `derived`:
  - sanitized turns
  - merged unified events
  - derived axis scores
  - generated schema input
  - generated release gate input

## Mapping Rules

Default mapping includes:

- Axis to ledger:
  - `FR -> fact`
  - `CA -> context`
  - `SR -> commitment`
  - `SA -> context`
- Axis to tag:
  - `FR -> TAG_FCT`
  - `CA -> TAG_CTX`
  - `SR -> TAG_SAF`
  - `SA -> TAG_SYS`
- VCD family to A-CSM axis:
  - prompt/boundary/context families -> `CA`
  - data exfiltration/coercion -> `SR`

All mappings are configurable through `config/acsm-orchestrator.json`.

## Exit Codes

- `0`: decision is `GO`
- `1`: decision is `NO_GO`
- `2`: CLI argument error (missing `--input`)

## Validation Integration

- `--validation <path>` accepts a JSON payload from `validation-runner`.
- Orchestrator maps readiness to release gate input:
  - `ready` / `empirical_ready` -> `ready`
  - others -> `not_ready`
- When `releaseGate.requireValidationReadiness = true`, non-ready status blocks release.
