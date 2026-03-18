# A-CSM Evaluation Plan

## Objective

This plan defines the minimum evaluation structure required before A-CSM can be presented as a publication-ready research tool.

## Evaluation Packs

### 1. Public Demo Pack

Purpose:
- provide reproducible examples any reviewer can run locally

Target shape:
- `40-60` synthetic or releasable cases
- balanced across benign, mild drift, moderate concern, and blocking scenarios

Required artifacts:
- input files
- expected outcome summaries
- reproducible execution command

### 2. Dual-Rater Gold Pack

Purpose:
- establish annotation discipline and inter-rater reliability

Target shape:
- `30-50` conversations
- two independent raters
- adjudication note for disagreements

Required metrics:
- Cohen's kappa
- agreement rate
- disagreement categories

### 3. Private Real-World Holdout

Purpose:
- test whether the pipeline remains useful beyond synthetic fixtures

Target shape:
- `80-120` de-identified conversations
- stratified by length, severity, and domain

Required controls:
- governance log
- de-identification check
- sampling note

### 4. Stress Pack

Purpose:
- test brittleness and robustness

Target shape:
- adversarial or jailbreak-style conversations
- long-horizon multi-turn drift
- format-noise and malformed transcript variants
- multilingual or code-switch cases

## Core Metrics

- Determinism: same input produces the same output and fingerprint
- Ground-truth alignment: `risk_status` agreement on curated fixtures
- False positive rate
- False negative rate
- Cohen's kappa for dual-rater annotation
- Schema consistency and report-field consistency
- Stability under format variation

## Minimum Acceptance Thresholds

- Tests: `921 pass / 0 fail` or higher for the current publication package
- Coverage: no regression below the current committed baseline without explicit approval
- Ground-truth alignment: `>= 85%`
- False negative rate: `< 5%`
- False positive rate: `< 15%`
- Cohen's kappa: `>= 0.61`
- Workspace audit: `READY`

## Review Sequence

1. Confirm deterministic local baseline on committed fixtures.
2. Re-run ground-truth and regression packs.
3. Review dual-rater gold pack and IRR report.
4. Run private holdout evaluation with governance note.
5. Run stress pack for edge-case failures.
6. Update `public-claims-policy` and `limitations` before any public split.

## Required Outputs Per Evaluation Cycle

- validation framework report
- IRR report
- release-gate input bundle
- reviewer summary of pass / fail / pending items
- explicit list of unresolved limitations
