from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.download_polyguard_dataset import build_markdown, classify_path, summarize_dataset


def test_classify_path_handles_policy_and_task_groups() -> None:
    assert classify_path("social_media/Discord/data_safe.jsonl") == {"group": "social_media", "source": "Discord", "label": "safe"}
    assert classify_path("finance/Output/FINRA/data_unsafe.jsonl") == {"group": "finance_output", "source": "FINRA", "label": "unsafe"}
    assert classify_path("code/bias_code.jsonl") == {"group": "code", "source": "bias_code", "label": "task"}


def test_summarize_dataset_counts_rows(tmp_path: Path) -> None:
    files = {
        "social_media/Discord/data_safe.jsonl": [
            {"instance": "a", "category": "c", "rule": "r"},
            {"instance": "b", "category": "c", "rule": "r"},
        ],
        "finance/Output/FINRA/data_unsafe.jsonl": [
            {"original instance": "a", "rephrased instance": "b", "output": "c"}
        ],
        "code/bias_code.jsonl": [
            {"prompt": "p", "completion": "c"}
        ],
    }
    for relative, rows in files.items():
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")

    summary = summarize_dataset(tmp_path)
    assert summary["rows"] == 4
    assert summary["groups"]["social_media"] == 2
    assert summary["groups"]["finance_output"] == 1
    assert summary["groups"]["code"] == 1
    assert summary["labels"]["safe"] == 2
    assert summary["labels"]["unsafe"] == 1
    assert summary["labels"]["task"] == 1


def test_build_markdown_contains_mapping() -> None:
    report = {
        "dataset_id": "AI-Secure/PolyGuard",
        "rows": 10,
        "files": [1, 2],
        "groups": {"social_media": 5, "cyber": 5},
        "labels": {"safe": 4, "unsafe": 4, "task": 2},
    }
    markdown = build_markdown(report)
    assert "RZV-250" in markdown
    assert "## A-CSM Mapping" in markdown
