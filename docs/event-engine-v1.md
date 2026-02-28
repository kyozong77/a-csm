# Event Engine v1 (RZV-93)

Rule-first four-axis risk event detector.

## Axes

- `FR`: factual reliability risk
- `CA`: contextual alignment risk
- `SR`: user-side safety risk
- `SA`: system availability risk

## Coverage

- 43 built-in rules (`FR_01..FR_11`, `CA_01..CA_11`, `SR_01..SR_11`, `SA_01..SA_10`)
- Severity levels: `low`, `medium`, `high`, `critical`
- Optional filtering by `minSeverity`, `enabledRuleIds`, `disabledRuleIds`

## CLI

```bash
npm run events:check -- \
  --input config/event-engine-input.sample.json \
  --config config/event-engine-v1.json \
  --format both \
  --output logs/event-engine-result.json
```

## Output

- `events[]`: detected events with `ruleId`, `axis`, `severity`, `turnId`, `matchedPhrases`, `excerpt`
- `summary.axisCounts` and `summary.severityCounts`
- `trace` and `findings` for auditability

## Validation

`test/event-engine-v1.test.mjs` contains 118 deterministic checks, including:

- core behavior and config validation
- CLI success/failure behavior
- 43 rule trigger checks
- 43 per-rule disable checks
