# Release Gate Operator Freeze Workflow

## Purpose
This runbook defines a safe operator workflow for release-freeze periods under `scripts/release-gate.mjs`.

## Pre-Flight Checklist
Before evaluating gate status:

1. Confirm required CI checks are complete (`tests`, `lint`, `build` by default).
2. Confirm risk metrics are up to date:
   - `criticalOpen`
   - `highOpen`
   - `regressionFailures`
   - `openIncidents`
3. Confirm artifact list and hashes (if hash gate is enabled):
   - `artifacts.present`
   - `artifacts.hashes` (SHA-256)

## Freeze Exception Workflow
When freeze is active (`freeze.active = true`):

1. Capture exception approval:
   - set `freeze.exceptionApproved = true`
   - set `freeze.exceptionTicketId` when `requireExceptionTicketWhenFrozen = true`
2. Capture exception validity window:
   - set `freeze.exceptionExpiresAt` (ISO datetime) when `requireExceptionExpiryWhenFrozen = true`
   - optionally set `meta.evaluationTime` for deterministic validation
3. Capture rollback readiness:
   - set `freeze.rollbackPlanLinked = true`
   - set `freeze.rollbackOwner` when `requireRollbackOwnerWhenFrozen = true`

If any required freeze field is missing/invalid/expired, gate decision is `NO_GO`.

## Approval Workflow
If approval rules are enabled:

1. Set `approvals.totalApprovals` to the effective count.
2. Set `approvals.securityApproved = true` when `requireSecurityApproval = true`.
3. Set `approvals.qaApproved = true` when `requireQaApproval = true`.

Any unmet required approval causes `NO_GO`.

## Warning vs Blocking Behavior
1. `warningHighPriorityOpenAt` emits non-blocking warning findings.
2. Threshold violations (`max*`) emit blocking findings and produce `NO_GO`.

## Suggested Command
```bash
node scripts/release-gate.mjs \
  --input config/release-gate-input.sample.json \
  --config config/release-gate.json \
  --output logs/release-gate-result.json \
  --format both
```

## Exit Criteria
Release can proceed only when:

1. Gate decision is `GO`.
2. No blocking findings exist.
3. Freeze exception data (if applicable) is complete and not expired.
