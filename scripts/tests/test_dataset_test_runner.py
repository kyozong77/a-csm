from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.dataset_test_runner import build_pii_case_counts, render_markdown_report, round_robin_sample


def test_build_pii_case_counts_spreads_budget() -> None:
    counts = build_pii_case_counts(12)
    assert sum(counts.values()) == 12
    assert min(counts.values()) >= 2


def test_round_robin_sample_respects_weights() -> None:
    selected, distribution = round_robin_sample(
        {
            "alpha": [{"turns": []}] * 3,
            "beta": [{"turns": []}] * 3,
        },
        {"alpha": 2, "beta": 1},
        4,
    )
    assert len(selected) == 4
    assert distribution == {"alpha": 3, "beta": 1}


def test_render_markdown_report_contains_core_sections() -> None:
    report = {
        "generated_at": "2026-03-08T00:00:00Z",
        "run_id": "phase1-20260308T000000Z",
        "phase": "1",
        "sample_requested": 10,
        "execution_mode": "full",
        "conversion": {
            "datasets": [
                {
                    "name": "alpha",
                    "report": {"records_written": 10},
                    "filter": {"kept_primary": 8, "kept_chinese": 0},
                }
            ]
        },
        "sampling": {"selected_case_count": 10, "selected_distribution": {"alpha": 10}},
        "engine": {
            "pass_rate": 0.7,
            "decision": "NO_GO",
            "failed_cases": [{"id": "alpha-0001", "decision": "NO_GO", "blocking_findings": 1, "vcd_status": "CLEAR", "tag_decision_level": "LOW"}],
        },
        "performance": {"total_seconds": 1.25, "engine_seconds": 0.8, "end_to_end_ms_per_conversation": 125.0},
        "artifacts": {"json_report_path": "a.json", "markdown_report_path": "a.md"},
    }
    markdown = render_markdown_report(report)
    assert "# Dataset Test Report" in markdown
    assert "## Summary" in markdown
    assert "`alpha`" in markdown
    assert "`alpha-0001`" in markdown
