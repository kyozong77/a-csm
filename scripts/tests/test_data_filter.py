from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.data_filter import evaluate_record, load_config, run_filter


def _record(case_id: str, user_text: str, assistant_text: str) -> dict[str, object]:
    return {
        "turns": [
            {
                "id": "T001",
                "role": "user",
                "sourceTrust": "trusted",
                "boundaryBypass": False,
                "text": user_text,
            },
            {
                "id": "T002",
                "role": "assistant",
                "sourceTrust": "untrusted",
                "boundaryBypass": False,
                "text": assistant_text,
            },
        ],
        "validation": {"readiness": True},
        "_meta": {"case_id": case_id},
    }


def _config(tmp_path: Path, input_path: Path) -> Path:
    payload = {
        "version": "test",
        "filters": {
            "min_turn_chars": 10,
            "max_turn_chars": 10000,
            "required_roles": ["user", "assistant"],
            "target_pass_rate": 0.95,
            "language": {
                "primary": ["en"],
                "chinese_subset": ["zh", "zh-cn", "zh-tw"],
                "fallback_meta_fields": ["language"],
            },
            "noise": {
                "min_visible_chars": 24,
                "max_repeated_char_ratio": 0.65,
                "min_alnum_ratio": 0.25,
                "spam_repeat_threshold": 8,
                "max_unique_tokens_when_spam": 2,
                "spam_url_threshold": 3,
                "spam_keywords": ["buy now", "click here"],
            },
        },
        "datasets": [
            {
                "name": "sample",
                "input_path": str(input_path),
                "primary_output_path": str(tmp_path / "sample.primary.jsonl"),
                "chinese_output_path": str(tmp_path / "sample.zh.jsonl"),
            }
        ],
    }
    config_path = tmp_path / "data-filter.yaml"
    config_path.write_text(yaml.safe_dump(payload, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return config_path


def test_evaluate_record_routes_primary_chinese_and_duplicate() -> None:
    config = {
        "required_roles": ["user", "assistant"],
        "min_turn_chars": 10,
        "max_turn_chars": 10000,
        "language": {
            "primary": ["en"],
            "chinese_subset": ["zh", "zh-cn", "zh-tw"],
            "fallback_meta_fields": ["language"],
        },
        "noise": {
            "min_visible_chars": 24,
            "max_repeated_char_ratio": 0.65,
            "min_alnum_ratio": 0.25,
            "spam_repeat_threshold": 8,
            "max_unique_tokens_when_spam": 2,
            "spam_url_threshold": 3,
            "spam_keywords": ["buy now"],
        },
    }
    seen: set[str] = set()
    english = _record("en-1", "Please summarize this report clearly.", "Here is a concise summary of the report.")
    chinese = _record("zh-1", "請協助整理這份研究摘要的重點內容。", "以下是這份研究摘要的重點整理。")

    en_decision = evaluate_record(english, config, seen)
    seen.add(en_decision.digest or "")
    zh_decision = evaluate_record(chinese, config, seen)
    dup_decision = evaluate_record(english, config, seen)

    assert en_decision.bucket == "primary"
    assert zh_decision.bucket == "chinese"
    assert dup_decision.reason == "duplicate_text_hash"


def test_evaluate_record_rejects_noise_and_missing_roles() -> None:
    config = {
        "required_roles": ["user", "assistant"],
        "min_turn_chars": 10,
        "max_turn_chars": 10000,
        "language": {
            "primary": ["en"],
            "chinese_subset": ["zh"],
            "fallback_meta_fields": ["language"],
        },
        "noise": {
            "min_visible_chars": 24,
            "max_repeated_char_ratio": 0.65,
            "min_alnum_ratio": 0.25,
            "spam_repeat_threshold": 8,
            "max_unique_tokens_when_spam": 2,
            "spam_url_threshold": 3,
            "spam_keywords": ["buy now"],
        },
    }
    noise_record = _record("noise", "aaaaaaaaaaaaaaaaaaaaaaaaaaaa", "!!!!!!!!!!!!!!!!!????????????")
    missing_role = {
        "turns": [
            {"id": "T001", "role": "user", "sourceTrust": "trusted", "boundaryBypass": False, "text": "Only one role is present here."}
        ],
        "validation": {"readiness": True},
    }

    assert evaluate_record(noise_record, config, set()).reason == "noise_or_spam"
    assert evaluate_record(missing_role, config, set()).reason == "missing_required_roles"


def test_run_filter_generates_outputs_and_report(tmp_path: Path) -> None:
    input_path = tmp_path / "sample.jsonl"
    rows = [
        _record("en-1", "Please summarize this report clearly.", "Here is a concise summary of the report."),
        _record("zh-1", "請協助整理這份研究摘要的重點內容。", "以下是這份研究摘要的重點整理。"),
        _record("dup-1", "Please summarize this report clearly.", "Here is a concise summary of the report."),
        _record("noise", "aaaaaaaaaaaaaaaaaaaaaaaaaaaa", "!!!!!!!!!!!!!!!!!????????????"),
    ]
    input_path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")
    config_path = _config(tmp_path, input_path)
    config = load_config(config_path)
    report = run_filter(config)

    assert report["datasets"][0]["kept_primary"] == 1
    assert report["datasets"][0]["kept_chinese"] == 1
    assert report["datasets"][0]["removed"] == 2
    assert report["overall"]["removal_reasons"]["duplicate_text_hash"] == 1
    assert report["overall"]["removal_reasons"]["noise_or_spam"] == 1
    assert report["datasets"][0]["pruned_turns"] == 0


def test_cli_writes_report_file(tmp_path: Path) -> None:
    input_path = tmp_path / "sample.jsonl"
    rows = [_record("en-1", "Please summarize this report clearly.", "Here is a concise summary of the report.")]
    input_path.write_text("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n", encoding="utf-8")
    config_path = _config(tmp_path, input_path)
    report_path = tmp_path / "report.json"

    subprocess.run(
        [
            sys.executable,
            "pipeline/data_filter.py",
            "--config-path",
            str(config_path),
            "--report-path",
            str(report_path),
        ],
        check=True,
        cwd=str(ROOT),
    )

    saved = json.loads(report_path.read_text(encoding="utf-8"))
    assert saved["overall"]["kept_primary"] == 1
    assert saved["overall"]["meets_target_pass_rate"] is True


def test_evaluate_record_prunes_short_turns_and_keeps_valid_dialogue() -> None:
    config = {
        "required_roles": ["user", "assistant"],
        "min_turn_chars": 10,
        "max_turn_chars": 10000,
        "language": {
            "primary": ["en"],
            "chinese_subset": ["zh"],
            "fallback_meta_fields": ["language"],
        },
        "noise": {
            "min_visible_chars": 24,
            "max_repeated_char_ratio": 0.65,
            "min_alnum_ratio": 0.25,
            "spam_repeat_threshold": 8,
            "max_unique_tokens_when_spam": 2,
            "spam_url_threshold": 3,
            "spam_keywords": ["buy now"],
        },
    }
    record = {
        "turns": [
            {"id": "T001", "role": "user", "sourceTrust": "trusted", "boundaryBypass": False, "text": "Please summarize the attached research findings for me."},
            {"id": "T002", "role": "assistant", "sourceTrust": "untrusted", "boundaryBypass": False, "text": "Sure."},
            {"id": "T003", "role": "assistant", "sourceTrust": "untrusted", "boundaryBypass": False, "text": "Here is a more detailed and compliant summary of the attached research findings."},
        ],
        "validation": {"readiness": True},
    }

    decision = evaluate_record(record, config, set(), expected_language="en")
    assert decision.bucket == "primary"
    assert decision.pruned_turns == 1
    assert len((decision.record or {})["turns"]) == 2
