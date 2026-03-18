from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from validation.iaa_calculator import calculate_iaa_metrics


def build_case(case_id: str, *, risk_status: str = "Observe", fr: int = 25, ca: int = 40, sr: int = 10, sa: int = 5):
    return {
        "case_id": case_id,
        "source_family": "test",
        "rater_a": {
            "axis_scores": {"FR": fr, "CA": ca, "SR": sr, "SA": sa},
            "risk_status": risk_status,
            "trigger_rules": ["CA_06", "VCDE_05"],
        },
        "rater_b": {
            "axis_scores": {"FR": fr, "CA": ca, "SR": sr, "SA": sa},
            "risk_status": risk_status,
            "trigger_rules": ["CA_06", "VCDE_05"],
        },
    }


def test_calculate_iaa_metrics_perfect_agreement() -> None:
    batch = {
        "batch_id": "qa-batch",
        "cases": [
            build_case("case-1", risk_status="Normal", fr=0, ca=0, sr=0, sa=0),
            build_case("case-2", risk_status="Observe", fr=25, ca=35, sr=10, sa=5),
            build_case("case-3", risk_status="Deviate", fr=70, ca=65, sr=30, sa=15),
            build_case("case-4", risk_status="Alert", fr=90, ca=80, sr=95, sa=40),
        ],
    }

    result = calculate_iaa_metrics(batch)

    assert result["risk_status"]["cohens_kappa"] == 1.0
    assert result["risk_status"]["agreement_rate"] == 1.0
    assert result["trigger_rules"]["exact_match_rate"] == 1.0
    assert result["axis_scores"]["FR"]["icc_2_1"] == 1.0
    assert result["axis_scores"]["CA"]["icc_2_1"] == 1.0
    assert result["summary"]["readiness"] == "ready"
    assert result["arbitration"]["conflict_count"] == 0


def test_calculate_iaa_metrics_collects_conflicts() -> None:
    batch = {
        "batch_id": "qa-batch",
        "cases": [
            build_case("case-1", risk_status="Normal", fr=0, ca=0, sr=0, sa=0),
            {
                "case_id": "case-2",
                "source_family": "test",
                "rater_a": {
                    "axis_scores": {"FR": 30, "CA": 20, "SR": 10, "SA": 0},
                    "risk_status": "Observe",
                    "trigger_rules": ["CA_06"],
                },
                "rater_b": {
                    "axis_scores": {"FR": 65, "CA": 20, "SR": 10, "SA": 0},
                    "risk_status": "Deviate",
                    "trigger_rules": ["CA_06", "VCDE_08"],
                },
            },
        ],
    }

    result = calculate_iaa_metrics(batch)

    assert result["summary"]["readiness"] == "not_ready"
    assert result["arbitration"]["conflict_count"] == 1
    assert result["arbitration"]["queue"][0]["case_id"] == "case-2"
    assert result["trigger_rules"]["exact_match_rate"] == 0.5
