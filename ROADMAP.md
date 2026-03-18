# A-CSM Roadmap

## Current Release

- Version: `0.1.0`
- Status: initial public release

## Completed

### Milestone 1: Repository Identity And Integrity

- Naming, versioning, and repository metadata are consistent.
- Core standards files: `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `CITATION.cff`.
- CI pipeline with lint, test, coverage, performance-baseline, and security checks.

### Milestone 2: Release Gates And Reproducibility

- Syntax check, tests, coverage, performance baseline, and security scan pass locally and in CI.
- End-to-end orchestrator, batch runner, and regression suite pass on baseline inputs.
- Workspace audit reports `READY`.

### Milestone 3: Validation Transparency

- Synthetic fixtures, annotation workflow, IRR thresholds, and validation framework documented.
- `docs/evaluation-plan.md`, `docs/public-claims-policy.md`, and `docs/limitations.md` present and consistent.
- Public and private evaluation assets clearly separated.

## Planned

### Milestone 4: Real-World Validation

- De-identified real-world holdout evaluation with documented consent and governance review.
- Expanded multilingual evaluation coverage.
- Inter-rater reliability reporting on non-synthetic data.

### Milestone 5: Comparative Benchmarks

- Benchmark pack against adjacent guardrail and safety tooling.
- Standardized evaluation protocol for cross-tool comparison.

### Milestone 6: Community And Ecosystem

- Public contribution workflow with review gates.
- Additional dataset converters for emerging dialogue formats.
- Extended documentation and tutorial materials.
