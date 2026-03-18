from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.stratified_sampler import (
    AXES,
    PS_STATE_BUCKETS,
    RISK_LEVELS,
    SampleCase,
    assign_risk_statuses,
    compute_risk_targets,
    generate_corpus,
    stage_summary,
)


def test_compute_risk_targets_matches_full_corpus_distribution() -> None:
    targets = compute_risk_targets(1700)
    assert targets == {"Normal": 680, "Observe": 425, "Deviate": 340, "Alert": 255}


def test_assign_risk_statuses_consumes_exact_targets() -> None:
    cases = [
        SampleCase(
            case_id=f"case-{index}",
            stage="TAG",
            stage_input_format="tag_events",
            stage_input={"events": []},
            source={"type": "synthetic"},
            annotations={"decisionLevel": "LOW"},
            risk_preferences=preferences,
        )
        for index, preferences in enumerate(
            [
                ("Normal", "Observe"),
                ("Observe", "Normal"),
                ("Deviate", "Observe"),
                ("Alert", "Deviate"),
            ],
            start=1,
        )
    ]
    assign_risk_statuses(cases, {"Normal": 1, "Observe": 1, "Deviate": 1, "Alert": 1})
    assert Counter(case.risk_status for case in cases) == Counter({risk: 1 for risk in RISK_LEVELS})


def test_stage_summary_tracks_ps_axis_state_matrix() -> None:
    cases: list[SampleCase] = []
    for axis in AXES:
        for bucket, _ in PS_STATE_BUCKETS:
            for ordinal in range(10):
                cases.append(
                    SampleCase(
                        case_id=f"{axis}-{bucket}-{ordinal}",
                        stage="PS/SUB/F/E",
                        stage_input_format="ps_input",
                        stage_input={"axisScores": {axis: ordinal}},
                        source={"type": "synthetic"},
                        annotations={"axis": axis, "bucket": bucket},
                        risk_preferences=("Normal", "Observe", "Deviate", "Alert"),
                    )
                )
    summary = stage_summary(cases + [
        SampleCase(
            case_id=f"mixed-{ordinal}",
            stage="PS/SUB/F/E",
            stage_input_format="ps_input",
            stage_input={"axisScores": {"FR": 1, "CA": 1}},
            source={"type": "synthetic"},
            annotations={"axis": "FR", "bucket": "mixed"},
            risk_preferences=("Observe", "Normal", "Deviate"),
        )
        for ordinal in range(40)
    ])
    assert summary["PS/SUB/F/E"]["coverage"] == 1.0
    assert summary["PS/SUB/F/E"]["mixed_cases"] == 40
    for axis in AXES:
        assert summary["PS/SUB/F/E"]["axis_state_counts"][axis]["normal"] == 10
        assert summary["PS/SUB/F/E"]["axis_state_counts"][axis]["observe"] == 10
        assert summary["PS/SUB/F/E"]["axis_state_counts"][axis]["deviate"] == 10
        assert summary["PS/SUB/F/E"]["axis_state_counts"][axis]["alert"] == 10


def test_generate_corpus_with_real_phase1_data(tmp_path: Path) -> None:
    corpus_path = tmp_path / "rzv-241-corpus.jsonl"
    report_path = tmp_path / "rzv-241-report.json"
    if not (ROOT / "test-data" / "quality" / "phase1").exists():
        pytest.skip("requires populated Phase 1 quality outputs")

    report = generate_corpus(corpus_path, report_path, seed=20260307)

    assert report["validation"]["meets_total_corpus"] is True
    assert report["validation"]["meets_stage_coverage"] is True
    assert report["validation"]["meets_risk_distribution"] is True
    assert corpus_path.exists()
    assert report_path.exists()

    lines = corpus_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1700
    saved_report = json.loads(report_path.read_text(encoding="utf-8"))
    assert saved_report["validation"]["all_case_ids_unique"] is True
