# Changelog

All notable changes to A-CSM will be documented in this file.

This project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-03-15

### Added

- 8-stage deterministic pipeline: Input Contract, DEID, Event Engine (43 rules), VCD Inference (20 rules), Ledger Repeat, TAG Escalation, PS/SUB/F/E Derivation, Schema Validation.
- End-to-end orchestrator (`scripts/acsm-orchestrator.mjs`) with JSON and Markdown input support.
- Batch runner for processing up to 500 cases in a single run.
- Validated release pipeline with release-gate GO/NO_GO decisions.
- Regression suite for baseline comparison across versions.
- Dashboard CLI for human-readable report summaries.
- Annotation workflow tooling with inter-rater reliability (IRR) support.
- Validation framework with ground-truth fixture comparison.
- USCI four-axis risk model: FR (Fact Reliability), CA (Context Alignment), SR (User-side Safety), SA (System Accountability).
- Canonical report states: Normal, Observe, Deviate, Alert.
- SHA-256 digital fingerprinting for output auditability.
- Confidence interval computation on the 0..4 risk scale.
- 15-turn synthetic demo dialogue with escalation to Alert state.
- Security scan script for pre-commit secret detection.
- Docker packaging for reproducible execution.
- Dataset converters for ShareGPT, LMSYS, WildChat, JailbreakBench, and PII formats.
- CI workflow (GitHub Actions) for lint, test, and security checks.
- Comprehensive test suite with ground-truth fixtures and performance baselines.

### Documentation

- README with pipeline architecture, risk axes, input/output formats, and research context.
- Per-stage documentation for all 8 pipeline stages.
- Evaluation plan, public claims policy, and limitations disclosure.
- Annotation guidelines and validation framework documentation.
- Contributing guide, security policy, and citation metadata.
