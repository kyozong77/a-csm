# VCD Inference Engine (RZV-97)

`scripts/vcd-inference.mjs` implements Appendix-E style VCD defense matrix inference.

## What it does

- Detects context defense triggers using a 20-rule matrix (`VCDE_01` ... `VCDE_20`).
- Applies source trust penalties (`trusted`, `unknown`, `untrusted`).
- Detects boundary bypass signals via per-turn `boundaryBypass` flags.
- Supports independent enable/disable and rule-level allow/deny lists.
- Emits deterministic event records for downstream `event_log` integration.

## Input schema

```json
{
  "turns": [
    {
      "id": "T1",
      "role": "user",
      "sourceTrust": "trusted|unknown|untrusted",
      "boundaryBypass": false,
      "text": "..."
    }
  ]
}
```

Shortcut mode is also supported:

```json
{ "text": "single turn text" }
```

## Config highlights

- `enabled`: globally enable/disable VCD.
- `minSeverity`: `low|medium|high|critical` filtering.
- `enabledRuleIds` / `disabledRuleIds`: matrix rule controls.
- `dedupeByRulePerTurn`: avoid duplicate same-rule same-turn hits.
- `maxTriggersPerRule`: per-rule cap for deterministic output size.
- `triggerThresholds`: `guarded <= triggered <= lockdown`.
- `responseActions`: action mapping by status.

See [`config/vcd-inference.json`](/Users/bjhon/CascadeProjects/Codex_Main/config/vcd-inference.json).

## Output summary

- `summary.status`: `CLEAR|GUARDED|TRIGGERED|LOCKDOWN|DISABLED`
- `summary.level`: prefixed level (`VCD_*`)
- `summary.action`: mapped response action
- `summary.riskScore`: aggregate score from matrix/trust/boundary signals
- `events`: deterministic event list with `event_id`, `rule_id`, `turn_id`, `turn_index`, `excerpt`

## CLI

```bash
npm run vcd:check -- --input config/vcd-input.sample.json --config config/vcd-inference.json --format both --output logs/vcd-inference-result.json
```

Exit code is `1` when blocking findings exist.
