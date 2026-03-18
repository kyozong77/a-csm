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
from converters.pii_to_acsm import (
    build_generated_cases,
    build_ipv4_cases,
    extract_spy_entities,
    generate_tw_national_id,
    is_valid_tw_national_id,
    materialize_spy_row,
)


def _sample_spy_row() -> dict[str, object]:
    return {
        "tokens": ["Contact ", "<EMAIL>", " or call ", "<PHONE_NUM>", "."],
        "ent_tags": ["O", "B-EMAIL", "O", "B-PHONE_NUM", "O"],
    }


def test_materialize_spy_row_replaces_entities_and_preserves_offsets() -> None:
    text, entities = materialize_spy_row(_sample_spy_row(), 1)
    assert "example.org" in text
    assert entities[0]["entity_type"] == "email"
    assert text[entities[0]["start"] : entities[0]["end"]] == entities[0]["value"]
    assert entities[1]["entity_type"] == "phone"
    assert f'{entities[1]["value"]} .' in text


def test_generate_tw_national_id_returns_valid_values() -> None:
    values = {generate_tw_national_id(index) for index in range(10)}
    assert len(values) == 10
    assert all(is_valid_tw_national_id(value) for value in values)


def test_build_generated_cases_supports_taiwan_local_types() -> None:
    cases = {
        "tw_phone": build_generated_cases("tw_phone", 2),
        "tw_address": build_generated_cases("tw_address", 2),
        "tw_uniform_id": build_generated_cases("tw_uniform_id", 2),
    }
    assert all(len(rows) == 2 for rows in cases.values())
    phone_truth = cases["tw_phone"][0][1]
    address_truth = cases["tw_address"][0][1]
    uniform_truth = cases["tw_uniform_id"][0][1]
    assert phone_truth["entities"][0]["detector_type"] == "tw_phone"
    assert address_truth["entities"][0]["entity_type"] == "address"
    assert uniform_truth["entities"][0]["detector_type"] == "tw_uniform_id"


def test_cli_generates_outputs_and_ground_truth(tmp_path: Path) -> None:
    spy_path = tmp_path / "spy.jsonl"
    spy_path.write_text(json.dumps(_sample_spy_row(), ensure_ascii=False) + "\n", encoding="utf-8")

    wildchat_row = {
        "conversation_hash": "wild-001",
        "model": "gpt-4",
        "conversation": [
            {
                "role": "user",
                "content": "Please block IP 192.168.0.1 from the router.",
                "hashed_ip": "abc123",
                "header": {"user-agent": "pytest"},
            }
        ],
    }
    wildchat_path = tmp_path / "wildchat.parquet"
    pq.write_table(pa.Table.from_pylist([wildchat_row]), wildchat_path)

    output_path = tmp_path / "pii.acsm.jsonl"
    ground_truth_path = tmp_path / "pii.truth.jsonl"
    report_path = tmp_path / "pii.report.json"
    subprocess.run(
        [
            sys.executable,
            "converters/pii_to_acsm.py",
            "--spy-legal-path",
            str(spy_path),
            "--spy-medical-path",
            str(spy_path),
            "--wildchat-path",
            str(wildchat_path),
            "--output-path",
            str(output_path),
            "--ground-truth-path",
            str(ground_truth_path),
            "--report-path",
            str(report_path),
            "--email-cases",
            "1",
            "--phone-cases",
            "1",
            "--ipv4-cases",
            "1",
            "--tw-id-cases",
            "2",
            "--credit-card-cases",
            "2",
            "--query-secret-cases",
            "2",
        ],
        check=True,
        cwd=str(ROOT),
    )

    records = [json.loads(line) for line in output_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    truths = [json.loads(line) for line in ground_truth_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert len(records) == len(truths)
    assert report["tw_national_id_cases"] == 2
    assert report["counts_by_detector"]["ipv4"] == 1
    assert all(validate_acsm_record(record) == [] for record in records)
