# A-CSM Public Core Release Dossier

## Release Identity

- Project: `A-CSM: AI Contextual Signal Matrix`
- Traditional Chinese formal name: `AI 對話語境偵測系統 (A-CSM)`
- Public release label: `v0.1.0`
- Release class: `public-core baseline`
- Lead: `ZON RZVN`
- Role: `Independent Researcher, Taiwan`
- Repository host target: `github.com/kyozong77/A-CSM`
- Code license: `MIT`
- Technical report license: `CC BY-NC-ND 4.0`
- Reserved technical report DOI: `10.5281/zenodo.19097267`

## Executive Summary

A-CSM: AI Contextual Signal Matrix is a deterministic post-session research pipeline for assessing conversational AI risk across repeated interaction. The public release is intentionally limited to the most reproducible and auditable layer of the system: a runnable Node.js baseline that can be executed locally, inspected directly, and validated against released fixtures without relying on external model APIs or confidential evaluation logic.

This release is designed for external technical review, reproducibility checks, structured red-teaming follow-up, and conversation-risk research. It is not positioned as a clinical instrument, legal compliance system, or universal safety benchmark. The strongest defensible claim is narrower: A-CSM provides a public-safe, reproducible baseline for evaluating user-side contextual risk in multi-turn AI conversations.

## Why This Release Exists

Many public AI safety evaluations remain centered on single-turn outputs. That leaves a practical blind spot: risk can accumulate across an interaction trajectory even when no single message appears catastrophic in isolation. A-CSM is built to examine that interaction-level surface.

The current public core addresses a concrete need:

- deterministic reruns on the same input
- structured evidence traces rather than opaque model judgments
- conversation-level review rather than single-output inspection
- public-safe release boundaries that avoid exposing confidential scoring policy or private evaluation assets

## Public Release Boundary

This repository is the released public-core baseline, not the confidential internal system. It intentionally excludes:

- proprietary scoring policy and unreleased thresholds
- private taxonomy layers and confidential evaluation logic
- real-world private holdout dialogue archives
- unreleased AI-layer adjudication or confidential reviewer workflows

The released repository includes the deterministic execution layer, sample inputs, reproducible fixtures, validation notes, release-gate tooling, and audit-ready output artifacts needed for independent technical inspection.

## What The Public Core Contains

### Core Runtime Surface

The released executable path is centered on a deterministic Node.js orchestration flow:

1. Input normalization
2. Deterministic de-identification
3. Rule-based event extraction
4. Contextual defense inference
5. Repeat-aware ledger tracking
6. Conservative escalation logic
7. State derivation
8. Schema validation and release-gate decisioning

This core path uses native Node.js modules only. The repository also contains optional auxiliary research utilities for dataset conversion and annotation support. Those utilities are not required to run the released orchestrator and are not part of the core scoring dependency claim.

### Public-Facing Assessment Dimensions

The public artifact exposes four assessment dimensions:

- `FR` — factual reliability
- `CA` — context alignment
- `SR` — user-side safety
- `SA` — system accountability

The public report surface emits canonical states `Normal`, `Observe`, `Deviate`, and `Alert`, with structured machine-readable evidence for downstream review.

### Public Output Commitments

The released output contract centers on:

- `risk_status`
- `peak_status`
- `stability_index`
- `evidence_list`
- `false_positive_warnings`
- `human_review_note`
- `event_evidence_map`
- `confidence_interval`
- `digital_fingerprint`
- `rule_version`

These fields are intended to keep the released baseline auditable, repeatable, and portable across review settings.

## Reproducibility And Validation Position

The public-core release is defined by reproducibility before ambition. The baseline is expected to support:

- stable local execution
- deterministic output on repeated runs
- released fixture agreement on the committed baseline
- transparent limitations and public-claims discipline

The current evidence surface is synthetic and fixture-based. That boundary matters. Public readers should understand that this repository demonstrates a reproducible technical baseline, not completed real-world deployment validation.

The validation posture for this release should therefore be described as:

- synthetic verification completed on the public baseline
- real-world private holdout evaluation planned or in progress
- comparative benchmark work planned
- multilingual expansion planned

## Recommended Public Positioning

The most defensible external description is:

> A-CSM is an independent public-core baseline for evaluating user-side contextual risk in AI conversations, with a deterministic local execution path and reproducible technical artifacts.

Recommended framing terms:

- independent researcher
- public-core baseline
- deterministic pipeline
- reproducible release
- contextual AI risk
- user-side contextual risk
- conversation-level review

Avoid these claims unless new evidence is published:

- best-in-class safety performance
- complete real-world validation
- clinical suitability
- legal or regulatory certification
- full disclosure of the internal research system

## Suitable Uses

This public release is suitable for:

- technical due diligence
- reproducibility review
- academic and policy discussion
- public-interest AI governance analysis
- trust and safety prototyping
- post-session risk inspection research

It is not suitable as a stand-alone authority for medical, legal, or crisis decision-making.

## Suggested Press Summary

A-CSM is an independent research and evaluation initiative focused on user-side contextual risk in AI conversations. Its public release is a deterministic, inspectable, locally runnable baseline for structured post-session analysis. Rather than claiming to solve all AI safety problems, A-CSM addresses a narrower and under-measured surface: how risk can accumulate across repeated interaction, including contextual drift, judgment outsourcing, unstable reliance, and conversation-level misalignment.

## Release Package Guidance

For a professional GitHub publication, the repository should read as an intentional public release rather than a working dump. That means:

- identity and citation metadata must be aligned
- public claims must match what the repository can actually reproduce
- stale preprint drafts and generated log artifacts should stay out of the public root
- the latest verification memo should document the released baseline itself
- sample configs referenced by docs must exist in the repository

## Research Context

A-CSM is best understood as the executable implementation layer in a broader research stack:

1. `CXC-7` — conversational context analysis framework  
   Source: [https://doi.org/10.5281/zenodo.18615646](https://doi.org/10.5281/zenodo.18615646)
2. `CXOD-7` — contextual offense-defense framing  
   Source: [https://doi.org/10.5281/zenodo.17403793](https://doi.org/10.5281/zenodo.17403793)
3. `USCH` — User-Side Contextual Hallucination  
   Source: [https://doi.org/10.2139/ssrn.6135732](https://doi.org/10.2139/ssrn.6135732)
4. `USCI` — post-interaction four-axis assessment method  
   Source: [https://doi.org/10.5281/zenodo.18678458](https://doi.org/10.5281/zenodo.18678458)
5. `A-CSM` — executable public-core implementation layer  
   Source: this repository

## Public References

The broader relevance of user-side contextual risk is supported by recent public signals:

- OpenAI and MIT Media Lab, "Early methods for studying affective use and emotional well-being on ChatGPT"  
  Source: [https://openai.com/index/affective-use-study/](https://openai.com/index/affective-use-study/)
- U.S. Federal Trade Commission, inquiry into AI chatbots acting as companions  
  Source: [https://www.ftc.gov/news-events/news/press-releases/2025/09/ftc-launches-inquiry-ai-chatbots-acting-companions](https://www.ftc.gov/news-events/news/press-releases/2025/09/ftc-launches-inquiry-ai-chatbots-acting-companions)
- Common Sense Media, warning on AI companion safety risks  
  Source: [https://www.commonsensemedia.org/press-releases/common-sense-media-warns-against-ai-toy-companions-after-research-reveals-safety-risks](https://www.commonsensemedia.org/press-releases/common-sense-media-warns-against-ai-toy-companions-after-research-reveals-safety-risks)
- MLCommons AILuminate safety scope note  
  Source: [https://mlcommons.org/ailuminate/safety/](https://mlcommons.org/ailuminate/safety/)
- KPMG and University of Melbourne, trust and use of AI report  
  Source: [https://kpmg.com/xx/en/our-insights/ai-and-technology/trust-attitudes-and-use-of-ai.html](https://kpmg.com/xx/en/our-insights/ai-and-technology/trust-attitudes-and-use-of-ai.html)

## Contact

- Lead researcher: `ZON RZVN`
- Role: `Independent Researcher, Taiwan`
- ORCID: [0009-0002-6597-7245](https://orcid.org/0009-0002-6597-7245)
- Contact: `zon@rzvn.io`
