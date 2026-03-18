# A-CSM Public Core Agent Rules

## Read First

Before doing any work in this repository, you must read `README.md` first.

Do not modify, summarize, or package this repository until you understand:

1. project purpose
2. public-safe boundary
3. what is intentionally excluded
4. what this repository does not claim

## Repository Role

This repository is the **public GitHub upload candidate** for A-CSM.

It is:

- public-safe
- deterministic
- reproducible
- intended for external sharing

It is not:

- the confidential core
- the full internal research stack
- a source of private scoring or taxonomy logic

## Boundary Rules

Do not import or restore anything from confidential or non-public sources unless the user explicitly asks and the content is checked for public release safety.

Never add:

- private taxonomy
- proprietary scoring rules
- internal prompts
- private evaluation data
- confidential test harness logic

## Release Discipline

Any change to this repository must preserve:

- local runnability
- test stability
- public-boundary clarity
- README accuracy
- no secret leakage
