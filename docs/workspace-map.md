# Workspace Map

## Current Repo
- Repo root: current working directory of this repository
- Purpose: core A-CSM pipeline, tests, validation tooling, and release-prep documentation
- Scope: deterministic Node.js research implementation plus release-gate workflow

## Repository Layout
- `scripts/`
  - executable pipeline and validation modules
- `config/`
  - stage configs, sample inputs, and workspace audit policy
- `test/`
  - automated test suite and fixture data
- `docs/`
  - operator guides, validation notes, and release-prep documentation
- `validation/`
  - optional annotation and inter-rater support helpers

## Quick Verification
Run the workspace audit command:

```bash
npm run audit:workspace
```

The command prints audit JSON and writes `logs/workspace-audit.json`.

Path policy:
- `requiredPaths`: missing path means repository readiness is `NOT_READY`.
- `referencePaths`: missing path is informational and does not block readiness, but should be resolved before first public release.

## Notes
- The workspace audit is intentionally portable and must not depend on developer-specific absolute paths.
- Release-prep expectations are documented in `docs/release-prep-phase-gate.md`.
