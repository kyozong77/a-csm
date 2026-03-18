# A-CSM Limitations

## Purpose

This document states what the current baseline can and cannot support.
It exists to prevent over-claiming.

## Current Scope Boundaries

- A-CSM is a deterministic post-session analysis pipeline.
- A-CSM is not a runtime moderation gateway, live chatbot router, or refusal engine.
- A-CSM is not a medical diagnostic tool, legal compliance certification, or psychological assessment tool.
- A-CSM evaluates conversational risk signals after interaction artifacts are available.

## Validation Status Limits

- Synthetic validation is implemented and reproducible in the repository.
- Ground-truth fixtures exist for deterministic regression and schema consistency checks.
- Real-world validation planning exists, but the public evidence package is not yet complete.
- No public benchmark comparison pack against adjacent tooling is currently shipped.

## Data Limits

- Raw real-world transcripts are intentionally kept outside any future public repository.
- Private holdout evaluation depends on de-identification, governance review, and documented sampling policy.
- Current repository artifacts do not yet represent a multilingual or domain-balanced benchmark corpus.
- Long-horizon, adversarial, and format-noise stress packs are planned but not yet released as a complete public pack.

## Operational Limits

- Outputs remain decision-support artifacts and require qualified human review.
- Conservative escalation reduces under-flagging risk but may still produce false positives in ambiguous edge cases.
- Input quality affects outcome quality; malformed, partial, or poorly normalized transcripts can reduce interpretability.
- Current release-gate logic reflects repository-readiness checks, not external safety certification.

## Research Communication Limits

Claims that are currently supportable:

- deterministic execution on the committed baseline
- reproducible local tests and coverage
- explicit annotation and validation workflow design
- synthetic validation readiness planning

Claims that are not yet supportable without further evidence:

- superior benchmark performance over adjacent guardrail systems
- production-grade multilingual robustness
- validated clinical, legal, or regulatory suitability
- generalization claims across all conversational domains

## Required Reviewer Reading

Before any future public release, reviewers should read:

- `docs/evaluation-plan.md`
- `docs/public-claims-policy.md`
- `docs/annotation-workflow.md`
- `docs/validation-framework.md`
- `docs/release-prep-phase-gate.md`
