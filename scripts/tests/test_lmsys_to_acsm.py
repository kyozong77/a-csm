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
from converters.lmsys_to_acsm import convert_lmsys_row


def _sample_lmsys_row() -> dict[str, object]:
    return {
        "conversation_id": "conv-001",
        "model": "gpt-4",
        "turn": 2,
        "language": "English",
        "redacted": False,
        "openai_moderation": [{"flagged": False}],
        "conversation": [
            {"role": "user", "content": "Please summarize the release notes."},
            {"role": "assistant", "content": "Here is a short summary."},
            {"role": "system", "content": "Keep the answer concise."},
        ],
    }


def test_convert_lmsys_row_maps_roles_and_meta() -> None:
    converted = convert_lmsys_row(_sample_lmsys_row())
    assert converted["turns"][0]["role"] == "user"
    assert converted["turns"][0]["sourceTrust"] == "trusted"
    assert converted["turns"][1]["role"] == "assistant"
    assert converted["turns"][1]["sourceTrust"] == "untrusted"
    assert converted["turns"][2]["role"] == "system"
    assert converted["turns"][2]["sourceTrust"] == "unknown"
    assert converted["_meta"]["conversation_id"] == "conv-001"
    assert validate_acsm_record(converted) == []


def test_convert_lmsys_row_rejects_unknown_role() -> None:
    row = _sample_lmsys_row()
    row["conversation"] = [{"role": "moderator", "content": "invalid"}]
    try:
        convert_lmsys_row(row)
    except ValueError as exc:
        assert "Unsupported role" in str(exc)
    else:
        raise AssertionError("Expected ValueError for unsupported role.")


def test_lmsys_cli_supports_jsonl_and_parquet(tmp_path: Path) -> None:
    row = _sample_lmsys_row()
    jsonl_path = tmp_path / "sample.jsonl"
    jsonl_path.write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")

    output_path = tmp_path / "output.jsonl"
    report_path = tmp_path / "report.json"
    subprocess.run(
        [
            sys.executable,
            "converters/lmsys_to_acsm.py",
            "--input-path",
            str(jsonl_path),
            "--output-path",
            str(output_path),
            "--report-path",
            str(report_path),
        ],
        check=True,
        cwd=str(ROOT),
    )
    converted = json.loads(output_path.read_text(encoding="utf-8").strip())
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert converted["_meta"]["source"] == "lmsys"
    assert report["records_written"] == 1
    assert report["error_count"] == 0

    parquet_path = tmp_path / "sample.parquet"
    pq.write_table(pa.Table.from_pylist([row, row]), parquet_path)
    parquet_output = tmp_path / "parquet-output.jsonl"
    subprocess.run(
        [
            sys.executable,
            "converters/lmsys_to_acsm.py",
            "--input-path",
            str(parquet_path),
            "--output-path",
            str(parquet_output),
            "--limit",
            "1",
        ],
        check=True,
        cwd=str(ROOT),
    )
    assert len(parquet_output.read_text(encoding="utf-8").strip().splitlines()) == 1
