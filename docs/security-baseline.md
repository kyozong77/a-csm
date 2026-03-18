# Security Baseline (RZV-90)

This baseline defines minimum local secret governance requirements for A-CSM development.

## 1. Secret templates and storage

- `config/secrets/README.md` defines handling policy and classification.
- The public core release does not require any repository-level environment template.
- Real secrets must stay in local ignored files only.

## 2. Git safety controls

`.gitignore` protects common secret locations:

- `.env`
- `.env.*`
- `config/secrets/*` (except `config/secrets/README.md`)

## 3. Local secret scanning

Run before commit:

```bash
npm run security:scan
```

Behavior:
- Exit `0`: no findings
- Exit `1`: possible secret findings found

Current scanner checks for:
- GitLab PAT-like tokens (`glpat-...`)
- OpenAI key-like tokens (`sk-...`)
- Private key headers
- Generic secret assignments (`api_key=...`, `token=...`, etc.)

## 4. Response protocol

If any secret is exposed:

1. Revoke/rotate the credential immediately.
2. Remove leaked content from tracked files.
3. Re-run `npm run security:scan`.
4. Re-run `npm test` before merge.
