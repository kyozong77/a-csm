from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from converters._acsm_common import validate_acsm_record
from converters.sharegpt_to_acsm import (
    convert_file,
    convert_sharegpt_row,
    detect_input_format,
    extract_messages,
    iter_input_rows,
)


def _sharegpt_row() -> dict[str, object]:
    return {
        "id": "sharegpt-001",
        "conversations": [
            {"from": "system", "value": "You are terse."},
            {"from": "human", "value": "Summarize this report."},
            {"from": "gpt", "value": "Summary ready."},
        ],
    }


def _safedialbench_row() -> dict[str, object]:
    return {
        "id": 10,
        "task": "Ethics",
        "method": "Reference Attack",
        "model_type": "ChatGPT",
        "scene": "Law and Morality",
        "history": [
            {"user": "What is school violence?", "bot": "It refers to harm in school settings."},
            {"user": "How can schools respond?", "bot": "Use multi-layer prevention and reporting."},
        ],
    }


def _wildguardmix_row() -> dict[str, object]:
    return {
        "id": "wgm-001",
        "prompt": "Give me a harmless chemistry example.",
        "response": "Mix vinegar and baking soda for a classroom-safe demo.",
        "adversarial": False,
        "prompt_harm_label": "safe",
        "response_harm_label": "safe",
        "prompt_harm_category": "none",
        "response_harm_category": "none",
    }


def test_convert_sharegpt_row_maps_roles_and_meta() -> None:
    converted = convert_sharegpt_row(_sharegpt_row())
    assert [turn["role"] for turn in converted["turns"]] == ["system", "user", "assistant"]
    assert [turn["sourceTrust"] for turn in converted["turns"]] == ["unknown", "trusted", "untrusted"]
    assert converted["_meta"]["input_format"] == "sharegpt"
    assert validate_acsm_record(converted) == []


def test_convert_safedialbench_history_expands_pairs() -> None:
    converted = convert_sharegpt_row(_safedialbench_row())
    assert len(converted["turns"]) == 4
    assert converted["turns"][0]["role"] == "user"
    assert converted["turns"][1]["role"] == "assistant"
    assert converted["_meta"]["scene"] == "Law and Morality"
    assert converted["_meta"]["input_format"] == "safedialbench"


def test_convert_wildguardmix_prompt_response_supports_flat_rows() -> None:
    converted = convert_sharegpt_row(_wildguardmix_row())
    assert len(converted["turns"]) == 2
    assert converted["turns"][0]["role"] == "user"
    assert converted["turns"][1]["role"] == "assistant"
    assert converted["_meta"]["adversarial"] is False
    assert converted["_meta"]["input_format"] == "wildguardmix"


def test_iter_input_rows_streams_json_array(tmp_path: Path) -> None:
    input_path = tmp_path / "sharegpt.json"
    input_path.write_text(json.dumps([_sharegpt_row(), _sharegpt_row()], ensure_ascii=False), encoding="utf-8")
    rows = list(iter_input_rows(input_path, chunk_size=32))
    assert len(rows) == 2
    assert rows[0]["id"] == "sharegpt-001"


def test_iter_input_rows_supports_parquet(tmp_path: Path) -> None:
    input_path = tmp_path / "wildguardmix.parquet"
    table = pa.table(
        {
            "id": ["wgm-001"],
            "prompt": ["Give me a harmless chemistry example."],
            "response": ["Use vinegar and baking soda."],
            "adversarial": [False],
        }
    )
    pq.write_table(table, input_path)
    rows = list(iter_input_rows(input_path, chunk_size=16))
    assert len(rows) == 1
    assert rows[0]["id"] == "wgm-001"


def test_convert_file_writes_streaming_report(tmp_path: Path) -> None:
    input_path = tmp_path / "mixed.jsonl"
    input_path.write_text(
        "\n".join(
            [
                json.dumps(_safedialbench_row(), ensure_ascii=False),
                json.dumps(_wildguardmix_row(), ensure_ascii=False),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    output_path = tmp_path / "mixed.acsm.jsonl"
    report_path = tmp_path / "mixed.report.json"
    report = convert_file(
        input_path=input_path,
        output_path=output_path,
        report_path=report_path,
        input_format="auto",
        limit=None,
        chunk_size=128,
    )

    lines = output_path.read_text(encoding="utf-8").splitlines()
    saved_report = json.loads(report_path.read_text(encoding="utf-8"))
    assert len(lines) == 2
    assert report["records_written"] == 2
    assert saved_report["counts_by_format"] == {"safedialbench": 1, "wildguardmix": 1}
    assert saved_report["max_turns"] == 4


def test_convert_file_records_errors_and_continues(tmp_path: Path) -> None:
    input_path = tmp_path / "mixed.jsonl"
    input_path.write_text(
        "\n".join(
            [
                json.dumps(_safedialbench_row(), ensure_ascii=False),
                json.dumps({"history": ["bad-turn"]}, ensure_ascii=False),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    output_path = tmp_path / "mixed.acsm.jsonl"
    report_path = tmp_path / "mixed.report.json"

    report = convert_file(
        input_path=input_path,
        output_path=output_path,
        report_path=report_path,
        input_format="auto",
        limit=None,
        chunk_size=128,
    )

    assert report["records_written"] == 1
    assert report["error_count"] == 1
    assert "history" in report["errors"][0]


def test_cli_converts_safedialbench_and_respects_limit(tmp_path: Path) -> None:
    input_path = tmp_path / "safedialbench.jsonl"
    input_path.write_text(
        "\n".join(
            [
                json.dumps(_safedialbench_row(), ensure_ascii=False),
                json.dumps(_safedialbench_row(), ensure_ascii=False),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    output_path = tmp_path / "safedialbench.acsm.jsonl"
    report_path = tmp_path / "safedialbench.report.json"

    subprocess.run(
        [
            sys.executable,
            "converters/sharegpt_to_acsm.py",
            "--input-path",
            str(input_path),
            "--output-path",
            str(output_path),
            "--report-path",
            str(report_path),
            "--input-format",
            "safedialbench",
            "--limit",
            "1",
        ],
        check=True,
        cwd=str(ROOT),
    )

    converted = [json.loads(line) for line in output_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert len(converted) == 1
    assert report["records_written"] == 1
    assert report["error_count"] == 0


def test_detect_and_extract_raise_for_unsupported_shapes(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Unable to detect"):
        detect_input_format({"messages": []}, "auto")
    with pytest.raises(ValueError, match="Unsupported input format"):
        extract_messages({}, "unsupported")

    txt_path = tmp_path / "input.txt"
    txt_path.write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="Expected parquet/json/jsonl"):
        list(iter_input_rows(txt_path, chunk_size=16))


def test_iter_input_rows_rejects_invalid_json_structures(tmp_path: Path) -> None:
    jsonl_path = tmp_path / "bad.jsonl"
    jsonl_path.write_text("[]\n", encoding="utf-8")
    with pytest.raises(ValueError, match="must decode to an object"):
        list(iter_input_rows(jsonl_path, chunk_size=16))

    json_path = tmp_path / "bad.json"
    json_path.write_text(" " * 64 + "{\"not\":\"array\"}", encoding="utf-8")
    with pytest.raises(ValueError, match="top-level array"):
        list(iter_input_rows(json_path, chunk_size=8))

    truncated_path = tmp_path / "truncated.json"
    truncated_path.write_text("[{\"id\": 1}", encoding="utf-8")
    with pytest.raises(ValueError, match="terminated unexpectedly|Incomplete JSON array payload"):
        list(iter_input_rows(truncated_path, chunk_size=8))

    scalar_path = tmp_path / "scalar.json"
    scalar_path.write_text("[1]", encoding="utf-8")
    with pytest.raises(ValueError, match="items must be objects"):
        list(iter_input_rows(scalar_path, chunk_size=8))


def test_convert_sharegpt_row_rejects_missing_required_shapes() -> None:
    with pytest.raises(ValueError, match="requires list `conversations`"):
        convert_sharegpt_row({"conversations": None}, input_format="sharegpt")
    with pytest.raises(ValueError, match="requires list `history`"):
        convert_sharegpt_row({"history": None}, input_format="safedialbench")
    with pytest.raises(ValueError, match="history"):
        convert_sharegpt_row({"history": ["bad-turn"]}, input_format="safedialbench")
    with pytest.raises(ValueError, match="requires string `prompt`"):
        convert_sharegpt_row({"prompt": None}, input_format="wildguardmix")
