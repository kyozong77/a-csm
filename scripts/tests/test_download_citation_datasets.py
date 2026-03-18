from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.download_citation_datasets import build_markdown, summarize_citecheck, summarize_refchecker


def test_summarize_refchecker_counts_triplets(tmp_path: Path) -> None:
    base = tmp_path / "refchecker" / "source" / "benchmark" / "human_annotations_v1"
    for context_name in ["accurate_context", "noisy_context", "zero_context"]:
        context_dir = base / context_name
        context_dir.mkdir(parents=True, exist_ok=True)
        for index, filename in enumerate(
            [
                "model_a_answers.json",
                "model_b_answers.json",
            ],
            start=1,
        ):
            rows = [
                {
                    "id": f"{context_name}-{index}-1",
                    "response": "sample",
                    "claude2_response_kg": [{"triplet": ["a", "b", "c"], "human_label": "Entailment"}],
                },
                {
                    "id": f"{context_name}-{index}-2",
                    "response": "sample",
                    "claude2_response_kg": [{"triplet": ["x", "y", "z"], "human_label": "Contradiction"}],
                },
            ]
            (context_dir / filename).write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")

    import pipeline.download_citation_datasets as mod

    original = mod.REFCHECKER_CONTEXT_FILES
    mod.REFCHECKER_CONTEXT_FILES = {
        "accurate_context": ["model_a_answers.json", "model_b_answers.json"],
        "noisy_context": ["model_a_answers.json", "model_b_answers.json"],
        "zero_context": ["model_a_answers.json", "model_b_answers.json"],
    }
    try:
        summary = summarize_refchecker(tmp_path / "refchecker" / "source")
    finally:
        mod.REFCHECKER_CONTEXT_FILES = original

    assert summary["responses"] == 12
    assert summary["triplets"] == 12
    assert summary["triplet_label_distribution"]["Entailment"] == 6
    assert summary["triplet_label_distribution"]["Contradiction"] == 6


def test_summarize_citecheck_counts_labels(tmp_path: Path) -> None:
    base = tmp_path / "citecheck" / "source" / "dataset"
    base.mkdir(parents=True, exist_ok=True)
    rows = [
        {"idx": 1, "query": "q", "answer": "a", "statement": "s", "quote": "qt", "label": 1, "method": "none"},
        {"idx": 2, "query": "q", "answer": "a", "statement": "s", "quote": "qt", "label": 0, "method": "ch"},
    ]
    for split_name in ["train.jsonl", "dev.jsonl", "test.jsonl"]:
        (base / split_name).write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")

    summary = summarize_citecheck(tmp_path / "citecheck" / "source")
    assert summary["rows"] == 6
    assert summary["label_distribution"]["1"] == 3
    assert summary["label_distribution"]["0"] == 3
    assert summary["method_distribution"]["none"] == 3
    assert summary["method_distribution"]["ch"] == 3


def test_build_markdown_contains_key_sections() -> None:
    report = {
        "refchecker": {
            "source": "amazon-science/RefChecker",
            "code_license": "Apache-2.0",
            "annotation_license": "CC-BY-4.0",
            "files": [1, 2],
            "responses": 10,
            "triplets": 20,
            "empty_triplet_rows": 0,
            "by_context": {"zero_context": 10},
            "triplet_label_distribution": {"Entailment": 12, "Contradiction": 8},
        },
        "citecheck": {
            "source": "xzy-xzy/CiteCheck",
            "license": "MIT",
            "rows": 100,
            "label_distribution": {"1": 50, "0": 50},
            "method_distribution": {"none": 40, "ch": 60},
            "positive_ratio": 0.5,
        },
    }
    markdown = build_markdown(report)
    assert "## RefChecker" in markdown
    assert "## CiteCheck" in markdown
    assert "## A-CSM Mapping" in markdown
