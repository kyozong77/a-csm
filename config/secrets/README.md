# Secrets Baseline (RZV-90)

This directory stores local secret material that must not be committed.

## Rules

1. Keep real secret values only in local files under this directory.
2. Commit only non-sensitive templates and this README.
3. Rotate compromised tokens immediately.
4. Never place plaintext credentials in `logs/`, `docs/`, or test fixtures.

## Suggested local files (ignored by git)

- `local.env`
- `api-keys.json`
- `signing.key`
- `pii-salt.txt`

## Data classification

- Class A (critical): API keys, signing keys, salts.
- Class B (restricted): non-public run metadata tied to internal systems.
- Class C (internal): generated non-sensitive reports and debug traces.

## Minimum operating checklist

- No real secret template is required for the public core release.
- `.env` / local secrets files are ignored by git.
- Run `npm run security:scan` before commit.
