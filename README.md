# A-CSM — AI Contextual Signal Matrix

A deterministic, zero-dependency pipeline for contextual risk assessment of AI-generated conversations. A-CSM processes multi-turn dialogues through an 8-stage pipeline and produces structured GO / NO_GO decisions with full audit traces.

## Architecture

```
Input → DEID → Event Engine → VCD Inference → Ledger/Repeat
     → TAG Escalation → PS/SUB/F/E → Schema/Invariant → Release Gate → Decision
```

| Stage | Module | Purpose |
|-------|--------|---------|
| 1 | `deid-pipeline` | De-identification and PII masking |
| 2 | `event-engine-v1` | 43-rule phrase-based event detection across 4 risk axes |
| 3 | `vcd-inference` | Violation–Context–Decision inference |
| 4 | `ledger-repeat-engine` | Fact/commitment/context ledger with repeat tracking |
| 5 | `tag-escalation` | Tiered alert escalation (LOW → MEDIUM → HIGH → CRITICAL) |
| 6 | `ps-sub-fe-core` | Pattern–Subtlety–Frequency–Evidence scoring |
| 7 | `schema-invariant-service` | Schema validation and invariant checking |
| 8 | `release-gate` | Final GO / NO_GO gate with operator freeze workflow |

### Risk Axes

| Axis | Description |
|------|-------------|
| **FR** | Factual Reliability — fabricated citations, hallucinated facts |
| **CA** | Contextual Awareness — instruction conflict, role confusion |
| **SR** | Safety Risk — violence, self-harm, illegal instruction |
| **SA** | Situational Awareness — crash loops, resource exhaustion |

## Quick Start

```bash
# Run the full pipeline on a single conversation
node scripts/acsm-orchestrator.mjs \
  --input config/acsm-orchestrator-input.sample.json \
  --config config/acsm-orchestrator.json \
  --output logs/acsm-orchestrator-result.json

# Run a batch of up to 200 conversations
node scripts/acsm-batch-runner.mjs \
  --input config/acsm-batch-input.200.sample.json \
  --config config/acsm-orchestrator.json \
  --output logs/acsm-batch-200-result.json \
  --max-cases 200

# Run the event engine standalone
node scripts/event-engine-v1.mjs \
  --input config/event-engine-input.sample.json \
  --output logs/event-engine-result.json
```

## Programmatic API

```javascript
import { runAcsmOrchestrator } from "./scripts/acsm-orchestrator.mjs";
import { runAcsmBatch } from "./scripts/acsm-batch-runner.mjs";

// Single conversation
const result = runAcsmOrchestrator(input, config);
// result.decision → "GO" | "NO_GO"

// Batch processing
const batchResult = runAcsmBatch(
  { cases: [{ id: "case-1", input: conversationInput }] },
  orchestratorConfig,
  { maxCases: 200, stopOnNoGo: false, includeResults: true }
);
```

## Testing

```bash
# Run all tests
npm test

# Run a specific test file
node --test test/event-engine-v1.test.mjs

# Run batch stress tests (200-case scale)
node --test test/batch-200-stress.test.mjs
```

**1,243 tests** across 16 test files covering all 8 pipeline stages, batch processing, end-to-end report quality, false-positive/false-negative statistics, and real-world conversation samples.

| Test File | Scope |
|-----------|-------|
| `event-engine-v1.test.mjs` | 43 rules × 4 check types + config validation |
| `acsm-orchestrator.test.mjs` | Full pipeline orchestration |
| `acsm-batch-runner.test.mjs` | Batch runner API and options |
| `batch-200-stress.test.mjs` | 200-case stress, performance baselines, determinism |
| `lmsys-chat-sample.test.mjs` | LMSYS real-world chat corpus |
| `real-conversation-clean.test.mjs` | 70 clean conversation samples |
| `fp-fn-statistics.test.mjs` | False positive / false negative rate analysis |
| `e2e-report-quality.test.mjs` | End-to-end report structure and quality |
| `deid-pipeline.test.mjs` | De-identification stage |
| `vcd-inference.test.mjs` | VCD inference with 20-rule matrix |
| `ledger-repeat-engine.test.mjs` | Ledger tracking and repeat detection |
| `tag-escalation.test.mjs` | Alert level escalation |
| `ps-sub-fe-core.test.mjs` | Pattern–Subtlety–Frequency–Evidence |
| `schema-invariant-service.test.mjs` | Schema validation |
| `release-gate.test.mjs` | Release gate decisions and freeze workflow |
| `regression-suite.test.mjs` | Cross-stage regression checks |

## Project Structure

```
scripts/          12 pipeline modules (ESM, zero dependencies)
config/           JSON configuration and sample inputs
test/             16 test files (node:test, node:assert)
docs/             Per-module technical documentation
logs/             Pipeline output artifacts
```

## Design Principles

- **Zero dependencies** — Node.js standard library only (`node:test`, `node:assert`, `node:fs`, `node:crypto`)
- **Deterministic** — identical input always produces identical output
- **Auditable** — every run produces a full trace with step-by-step decisions
- **Batch-native** — process up to 200+ conversations per run with stop-on-failure and resume support

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm test` | Run all 1,243 tests |
| `npm run acsm:run` | Single orchestrator run |
| `npm run acsm:run:batch` | Batch run |
| `npm run acsm:run:200` | 200-case batch with sample data |
| `npm run regression:check` | Regression suite |
| `npm run events:check` | Event engine standalone |
| `npm run schema:check` | Schema invariant check |
| `npm run deid:check` | DEID pipeline standalone |
| `npm run vcd:check` | VCD inference standalone |
| `npm run tag:check` | TAG escalation standalone |
| `npm run ledger:check` | Ledger engine standalone |
| `npm run derive:ps` | PS/SUB/F/E derivation |
| `npm run audit:workspace` | Workspace audit |

## Requirements

- Node.js ≥ 18 (ESM support required)
- No `npm install` needed — zero external dependencies

## License

Proprietary. All rights reserved.
