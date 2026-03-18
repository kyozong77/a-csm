# Public V1 Core Verification (2026-03-18)

## Scope

This verification pass targets the curated public-core publication package for `A-CSM v0.1.0`.

- Goal: confirm the package is suitable for GitHub publication as the public-core `v0.1.0` release.
- Constraint: keep the release focused on the reproducible baseline and aligned public documentation.
- Execution mode: local-only verification on the curated publication package.

## Packaging Adjustments Applied

The desktop publication package was aligned before verification:

- identity metadata was normalized to `Independent Researcher`
- stale DOI placeholder metadata was removed from `CITATION.cff`
- a missing sample config was added at `config/input-contract-config.sample.yaml`
- the performance baseline was regenerated so the committed baseline matches current released behavior
- a publication dossier was added at `docs/publication-release-dossier.md`
- stale preprint drafts and generated preprint build artifacts were excluded from the package root

## Command Results

### Syntax check

Command:

```bash
npm run lint:syntax
```

Result:

- `PASS`

### Full test suite

Command:

```bash
npm test
```

Result:

- `921 pass`
- `0 fail`
- `41 suites`

### Coverage run

Command:

```bash
npm run test:coverage
```

Result:

- `PASS`

### Performance baseline

Command:

```bash
npm run performance:baseline
```

Result:

- `readiness: ready`
- `accuracy: 1.0`
- `false_positive_rate: 0`
- `false_negative_rate: 0`
- `regression decision: PASS`

### Security scan

Command:

```bash
npm run security:scan
```

Result:

- `No secret findings.`

### Workspace audit

Command:

```bash
npm run audit:workspace
```

Result:

- `readiness: READY`
- `requiredMissingCount: 0`
- `referenceMissingCount: 0`

### Representative runtime checks

Commands:

```bash
npm run acsm:run -- --input config/acsm-orchestrator-input.sample.json --config config/acsm-orchestrator.json --validation config/validation-runner-result.sample.json --output logs/acsm-orchestrator-result.json --format both
npm run acsm:run:200
npm run regression:check
```

Result:

- orchestrator sample run: `PASS`
- batch 200 sample run: `PASS`
- regression suite: `PASS`

## Verification Conclusion

The curated desktop package is suitable as the runnable public-core `v0.1.0` GitHub release candidate.

- Core checks pass locally on the curated package.
- The regenerated performance baseline now matches current released behavior.
- Public-facing documentation is aligned with the reproducible release boundary.
- The package remains a bounded research artifact, not a clinical, legal, or universal production safety system.
