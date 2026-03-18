from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from converters._acsm_common import validate_acsm_record
from converters.wildchat_to_acsm import convert_wildchat_row


def _sample_wildchat_row() -> dict[str, object]:
    return {
        "conversation_hash": "wild-001",
        "model": "gpt-4-0314",
        "timestamp": "2023-04-09 00:02:53+00:00",
        "turn": 1,
        "language": "English",
        "toxic": False,
        "redacted": False,
        "country": "United States",
        "state": "Texas",
        "openai_moderation": [{"flagged": False}],
        "detoxify_moderation": [{"toxicity": 0.02}],
        "conversation": [
            {
                "role": "user",
                "content": "Draft a short release note.",
                "hashed_ip": "abc123",
                "header": {"user-agent": "pytest"},
                "country": "United States",
                "state": "Texas",
                "language": "English",
                "redacted": False,
                "toxic": False,
                "timestamp": None,
                "turn_identifier": 101001,
            },
            {
                "role": "assistant",
                "content": "Release notes are ready.",
                "hashed_ip": None,
                "header": None,
                "country": None,
                "state": None,
                "language": "English",
                "redacted": False,
                "toxic": False,
                "timestamp": "2023-04-09 00:02:53+00:00",
                "turn_identifier": 101001,
            },
        ],
    }


def test_convert_wildchat_row_preserves_context_meta() -> None:
    converted = convert_wildchat_row(_sample_wildchat_row())
    assert converted["turns"][0]["boundaryBypass"] is False
    assert converted["turns"][1]["sourceTrust"] == "untrusted"
    assert converted["_meta"]["client_context"]["hashed_ip"] == "abc123"
    assert converted["_meta"]["conversation_hash"] == "wild-001"
    assert validate_acsm_record(converted) == []


def test_convert_wildchat_row_skips_blank_messages() -> None:
    row = _sample_wildchat_row()
    row["conversation"] = [
        {"role": "user", "content": "   "},
        {"role": "assistant", "content": "Non-empty assistant turn."},
    ]
    converted = convert_wildchat_row(row)
    assert len(converted["turns"]) == 1
    assert converted["turns"][0]["role"] == "assistant"


def test_wildchat_cli_supports_parquet_limit_and_report(tmp_path: Path) -> None:
    rows = [_sample_wildchat_row(), _sample_wildchat_row(), _sample_wildchat_row()]
    parquet_path = tmp_path / "wildchat.parquet"
    pq.write_table(pa.Table.from_pylist(rows), parquet_path)

    output_path = tmp_path / "wildchat-output.jsonl"
    report_path = tmp_path / "wildchat-report.json"
    subprocess.run(
        [
            sys.executable,
            "converters/wildchat_to_acsm.py",
            "--input-path",
            str(parquet_path),
            "--output-path",
            str(output_path),
            "--report-path",
            str(report_path),
            "--limit",
            "2",
        ],
        check=True,
        cwd=str(ROOT),
    )

    converted_lines = output_path.read_text(encoding="utf-8").strip().splitlines()
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert len(converted_lines) == 2
    assert report["records_written"] == 2
    assert report["error_count"] == 0
