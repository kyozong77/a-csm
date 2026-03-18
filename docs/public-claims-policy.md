# A-CSM Public Claims Policy

## Purpose

This document defines what may be claimed publicly from the current A-CSM baseline and what must remain framed as planned or unverified.

## Claim Levels

### Level A: Verified On Committed Baseline

Allowed when directly supported by repository artifacts and reproducible local commands.

Examples:
- A-CSM is a deterministic Node.js pipeline whose released core scoring path uses native Node.js modules only.
- The committed baseline passes the repository test suite.
- The repository includes synthetic validation workflow documentation and reproducible fixtures.

### Level B: Supported By Internal Planning, Not Yet Publicly Validated

Allowed only with explicit wording such as `planned`, `in progress`, `under evaluation`, or `not yet publicly released`.

Examples:
- private real-world holdout evaluation is planned
- multilingual stress evaluation is planned
- benchmark comparison pack is planned

### Level C: Not Allowed Without New Evidence

Do not claim these publicly until supported by new evidence packages.

Examples:
- best-in-class performance against other guardrail systems
- production readiness across all conversational domains
- validated multilingual robustness
- suitability as medical, legal, or regulatory decision infrastructure

## Required Evidence Before Public Claims

- reproducible command path
- committed sample artifact or documented reviewer record
- version and date of the claim
- limitation statement when the claim depends on synthetic-only evidence

## Required Wording Rules

- First mention: `A-CSM: AI Contextual Signal Matrix`
- Subsequent mention: `A-CSM`
- Chinese formal name when needed: `AI 對話語境偵測系統 (A-CSM)`
- Public-facing label: `v0.1.0`
- Engineering version: `0.1.0`

## Mandatory Claim Hygiene

- Separate `verified now` from `planned next`.
- Never mix private real-world evaluation with public reproducible evidence unless the governance basis is documented.
- Always disclose when evidence is synthetic-only.
- Link readers to `limitations.md` and `evaluation-plan.md` when making capability statements.
