from __future__ import annotations

import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.download_lmsys_dataset import compute_stats
from pipeline.download_wildguardmix_dataset import build_tag_mapping_summary


def test_compute_stats_counts_valid_english_rows(tmp_path: Path) -> None:
    rows = [
        {
            "conversation_id": "conv-1",
            "model": "gpt-4",
            "conversation": [{"role": "user", "content": "Hello"}],
            "turn": 1,
            "language": "English",
            "openai_moderation": [],
            "redacted": False,
        },
        {
            "conversation_id": "conv-2",
            "model": "gpt-4",
            "conversation": [],
            "turn": 1,
            "language": "English",
            "openai_moderation": [],
            "redacted": False,
        },
        {
            "conversation_id": "conv-3",
            "model": "gpt-4",
            "conversation": [{"role": "user", "content": "Bonjour"}],
            "turn": 1,
            "language": "French",
            "openai_moderation": [],
            "redacted": False,
        },
    ]
    parquet_path = tmp_path / "sample.parquet"
    pq.write_table(pa.Table.from_pylist(rows), parquet_path)

    report = compute_stats([parquet_path])
    assert report["total_rows"] == 3
    assert report["english_rows"] == 2
    assert report["empty_conversation_rows"] == 1
    assert report["valid_rows"] == 1
    assert report["field_integrity"]["conversation_id"]["missing_rows"] == 0


def test_build_tag_mapping_summary_aggregates_axes() -> None:
    rows = [
        {
            "prompt_harm_label": "safe",
            "response_harm_label": "safe",
            "response_refusal_label": "refusal",
            "adversarial": False,
        },
        {
            "prompt_harm_label": "harmful",
            "response_harm_label": "harmful",
            "response_refusal_label": "compliance",
            "adversarial": True,
        },
    ]
    summary = build_tag_mapping_summary(rows)
    assert summary["axis_counts"]["TAG_SAF"] == 2
    assert summary["axis_counts"]["TAG_CTX"] == 1
    assert summary["axis_counts"]["TAG_SYS"] == 2
    assert summary["combined"]["TAG_SAF:high"] == 1
    assert summary["combined"]["TAG_SAF:low"] == 1


def test_build_tag_mapping_summary_treats_unharmful_as_safe() -> None:
    rows = [
        {
            "prompt_harm_label": "unharmful",
            "response_harm_label": "unharmful",
            "response_refusal_label": "null",
            "adversarial": False,
        }
    ]
    summary = build_tag_mapping_summary(rows)
    assert summary["combined"]["TAG_SAF:low"] == 1
