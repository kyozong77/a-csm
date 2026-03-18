from __future__ import annotations

import json
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.download_brighter_dataset import build_markdown, summarize_dataset


def test_summarize_dataset_counts_languages_and_emotions(tmp_path: Path) -> None:
    base = tmp_path / "categories"
    eng = base / "eng"
    deu = base / "deu"
    eng.mkdir(parents=True, exist_ok=True)
    deu.mkdir(parents=True, exist_ok=True)

    pq.write_table(
        pa.Table.from_pylist(
            [
                {"id": "1", "text": "hello", "anger": 0, "disgust": None, "fear": 1, "joy": 1, "sadness": 0, "surprise": 0, "emotions": ["fear", "joy"]},
                {"id": "2", "text": "world", "anger": 1, "disgust": 0, "fear": 0, "joy": 0, "sadness": 1, "surprise": None, "emotions": ["anger", "sadness"]},
            ]
        ),
        eng / "train-00000-of-00001.parquet",
    )
    pq.write_table(
        pa.Table.from_pylist(
            [
                {"id": "3", "text": "hallo", "anger": 0, "disgust": 1, "fear": 0, "joy": 0, "sadness": 0, "surprise": 1, "emotions": ["disgust", "surprise"]},
            ]
        ),
        deu / "test-00000-of-00001.parquet",
    )

    summary = summarize_dataset(base, "brighter-test")
    assert summary["rows"] == 3
    assert summary["languages"]["eng"] == 2
    assert summary["languages"]["deu"] == 1
    assert summary["splits"]["train"] == 2
    assert summary["splits"]["test"] == 1
    assert summary["emotion_axes"] == ["anger", "disgust", "fear", "joy", "sadness", "surprise"]
    assert summary["sample_keys"] == ["id", "text", "anger", "disgust", "fear", "joy", "sadness", "surprise"]


def test_build_markdown_contains_mapping_sections() -> None:
    report = {
        "categories": {
            "dataset_id": "a",
            "rows": 10,
            "languages": {"eng": 5, "deu": 5},
            "splits": {"train": 8, "test": 2},
            "emotion_axes": ["anger", "disgust", "fear", "joy", "sadness", "surprise"],
        },
        "intensities": {
            "dataset_id": "b",
            "rows": 12,
            "languages": {"eng": 6, "deu": 6},
            "splits": {"train": 10, "test": 2},
            "emotion_axes": ["anger", "disgust", "fear", "joy", "sadness", "surprise"],
        },
    }
    markdown = build_markdown(report)
    assert "## Categories" in markdown
    assert "## Intensities" in markdown
    assert "## A-CSM Mapping" in markdown
