# Tag Escalation (RZV-96)

This module implements `TAG` weight scoring and conservative escalation with decision trace.

- Script: `scripts/tag-escalation.mjs`
- Config: `config/tag-policy.json`
- Sample input: `config/tag-policy-input.sample.json`
- Test file: `test/tag-escalation.test.mjs`

## Input format

```json
{
  "events": [
    {
      "axis": "TAG_FCT",
      "severity": "medium",
      "count": 1,
      "reason": "optional note"
    }
  ],
  "previousState": {
    "level": "MEDIUM",
    "stableRounds": 0
  }
}
```

## Run

```bash
npm run tag:check -- \
  --input config/tag-policy-input.sample.json \
  --config config/tag-policy.json \
  --format both \
  --output logs/tag-escalation-result.json
```

## Decision behavior

1. Calculate weighted score per event (`weight * severityScore * count`).
2. Determine base level by thresholds.
3. Apply conservative rules:
   - any `critical` event can force `HIGH`
   - multi-axis medium+ pattern can force `HIGH`
   - optional no-downgrade window based on previous level and stable rounds
4. Every step writes `trace` for auditability.

If input/config validation has blocking findings, final decision level falls back to `HIGH` (safe mode).
