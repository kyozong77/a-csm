# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability in A-CSM, please report it responsibly.

**Do not open a public issue.** Instead, email the maintainer directly with:

1. A description of the vulnerability
2. Steps to reproduce
3. Potential impact assessment

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation plan within 7 days.

## Security Design

A-CSM is designed with security as a core principle:

- **Zero external dependencies** — no supply chain risk from third-party packages
- **No network access** — all processing is local; no data leaves the runtime
- **No file system writes by default** — output is only written when `--output` is explicitly specified
- **Deterministic execution** — identical inputs always produce identical outputs, making behavior auditable
- **Input validation** — all pipeline stages validate input and produce blocking findings for malformed data

## Scope

This policy covers the A-CSM pipeline code in the `scripts/` directory. Static assets in `assets/`, sample configurations in `config/`, and the demo site (`index.html`, `app.js`) are not in scope.
