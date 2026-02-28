# Workspace Map

## Current Repo
- Path: `/Users/bjhon/CascadeProjects/Codex_Main`
- Purpose: static site deployment repo + local release gate tooling.
- Git remote: `git@github.com:kyozong77/Z_RZVN_Web.git`

## Related A-CSM Paths
- `/Users/bjhon/CascadeProjects/Z_RZVN_Web/src/app/research/usci`
  - contains `usci` related implementation in the Next.js project.
- `/Users/bjhon/Downloads/ZENODO_PUBLIC`
  - external dataset/reference folder; not part of current git repo.
- `/Users/bjhon/CascadeProjects/Codex_Main/_usci_split_en`
  - reference path only (informational check); currently missing in this repo.

## Quick Verification
Run the workspace audit command:

```bash
npm run audit:workspace
```

The command prints audit JSON and writes `logs/workspace-audit.json`.

Path policy:
- `requiredPaths`: missing path means workspace is `NOT_READY`.
- `referencePaths`: missing path is informational and does not block readiness.

## Notes
- In `Codex_Main`, `app.js`, `index.html`, `style.css`, and `assets/` are tracked files.
- Current untracked artifacts are automation outputs under `config/`, `logs/`, `scripts/`, `test/`, and `package.json`.
