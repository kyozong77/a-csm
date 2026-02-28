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

## Run

```bash
node scripts/acsm-orchestrator.mjs \
  --input config/acsm-orchestrator-input.sample.json \
  --config config/acsm-orchestrator.json \
  --output logs/acsm-orchestrator-result.json \
  --format both
```

Or via npm script:

```bash
npm run acsm:run -- \
  --input config/acsm-orchestrator-input.sample.json \
  --config config/acsm-orchestrator.json \
  --output logs/acsm-orchestrator-result.json \
  --format both
```

## Output Highlights

- `decision`: `GO | NO_GO`
- `summary`:
  - `releaseGateDecision`
  - `schemaDecision`
  - `tagDecisionLevel`
  - `vcdStatus`
  - `blockingFindings`
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
