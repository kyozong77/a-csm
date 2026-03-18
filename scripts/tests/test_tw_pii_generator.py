from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from generators import tw_pii_generator


def test_generator_validators_accept_generated_values() -> None:
    for index in range(20):
        assert tw_pii_generator.is_valid_tw_national_id(tw_pii_generator.generate_tw_national_id(index))
        assert tw_pii_generator.is_valid_tw_mobile(tw_pii_generator.generate_tw_mobile(index))
        assert tw_pii_generator.is_valid_luhn(tw_pii_generator.generate_tw_credit_card(index))
        assert tw_pii_generator.is_valid_tw_address(tw_pii_generator.generate_tw_address(index))
        assert tw_pii_generator.is_valid_tw_uniform_id(tw_pii_generator.generate_tw_uniform_id(index))


def test_cli_writes_expected_counts(tmp_path: Path) -> None:
    output_path = tmp_path / "tw_pii.jsonl"
    report_path = tmp_path / "tw_pii.report.json"
    subprocess.run(
        [
            sys.executable,
            "generators/tw_pii_generator.py",
            "--count-per-type",
            "3",
            "--output-path",
            str(output_path),
            "--report-path",
            str(report_path),
        ],
        check=True,
        cwd=str(ROOT),
    )
    rows = [json.loads(line) for line in output_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert len(rows) == 15
    assert report["records_written"] == 15
    assert report["validation_pass_rate"]["tw_uniform_id"] == 1.0
