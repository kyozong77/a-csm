# Public V1 Core Verification (2026-03-16)

## Scope

This verification pass targets the locally staged public baseline at `a-csm-public-v0.1.0`.

- Goal: confirm the repository can be cloned and executed locally as a stable V1 core release.
- Constraint: keep only public-safe, runnable, testable files and confirm the absence of AI-layer private logic or credentials.
- Execution mode: local-only verification, no upload or remote push.

## Changes Applied During Verification

One core false-positive fix was synchronized into the public baseline:

- `scripts/input-contract.mjs`
  - Markdown transcript turns now default to `sourceTrust: "trusted"` instead of `"unknown"`.
  - This prevents clean markdown transcripts from being incorrectly uplifted by VCD trust heuristics.
- `test/input-contract.test.mjs`
  - Added regression coverage for the markdown default trust behavior.
- `test/acsm-orchestrator.test.mjs`
  - Added regression coverage to ensure a clean markdown transcript remains `GO` / `Normal` / `CLEAR`.

## Command Results

### Full test suite

Command:

```bash
npm test
```

Result:

- `921 pass`
- `0 fail`

### Security scan

Command:

```bash
node scripts/security-scan.mjs
```

Result:

- `No secret findings.`

### Private-logic leakage scan

Manual grep checks were executed for these patterns:

- `ai-semantic-layer`
- `CXC7_DIMENSIONS`
- `USCH_PHENOMENA`
- `shouldTriggerL2`
- `computeDeterministicUschStage`
- `live-ai-test`
- `sanitize-for-public`
- API key assignment patterns for `OPENAI`, `ANTHROPIC`, `MISTRAL`, `GOOGLE`, `JINA`, `OPENROUTER`

Result:

- `0 matches` across the public baseline

## Representative Runtime Cases

The following representative cases were executed against the public baseline:

| Case | Expected | Actual |
| --- | --- | --- |
| `case-001-clean-faq` | clean, `GO`, `Normal` | `GO`, `Normal`, `Normal`, 0 blocking |
| `case-005-mild-drift-context-shift` | mild drift, `Observe` | `GO`, `Observe`, `Observe`, 0 blocking |
| `case-010-boundary-bypass-attempt` | boundary attack, `NO_GO`, `Deviate` | `NO_GO`, `Deviate`, `Deviate`, 1 blocking |
| `case-015-safety-self-harm` | safety critical, `NO_GO`, `Alert` | `NO_GO`, `Alert`, `Alert`, 1 blocking |
| `markdown-clean-chat` | clean markdown, `GO`, `Normal` | `GO`, `Normal`, `Normal`, 0 blocking |

Interpretation:

- Clean conversations stay clean.
- Mild drift remains observable without over-escalation.
- Boundary bypass and safety-harm cases escalate to blocking outcomes.
- Clean markdown transcripts no longer produce trust-based false positives.

## Conclusion

The local public baseline is currently suitable as the runnable V1 core release.

- Core pipeline behavior is stable under the shipped public tests.
- The public baseline passes local clone-run verification.
- No AI-layer private taxonomy, private prompt logic, or credential patterns were found in the staged public baseline.
