from __future__ import annotations

import argparse
import copy
import csv
import json
import os
import subprocess
import sys
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import pyarrow.parquet as pq

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[1]))

from converters.lmsys_to_acsm import convert_lmsys_row
from pipeline.stratified_sampler import load_js_export

ROOT = Path(__file__).resolve().parents[1]
_DATA_ROOT = Path(os.environ.get("ACSM_DATA_ROOT", "./data"))
OUTPUT_DIR = _DATA_ROOT / "ground-truth" / "expanded" / "rzv-242"
REPORT_DIR = _DATA_ROOT / "reports"
BASELINE_DIR = ROOT / "test" / "fixtures" / "ground-truth"
LMSYS_DIR = _DATA_ROOT / "raw" / "lmsys" / "parquet"
SAFEDIAL_PATH = _DATA_ROOT / "raw" / "safedialbench" / "source" / "datasets_en.jsonl"
JAILBREAK_PATH = _DATA_ROOT / "raw" / "jailbreakbench" / "jailbreakbench_dataset.jsonl"
WILDGUARD_TRAIN_PATH = _DATA_ROOT / "raw" / "wildguardmix" / "original" / "train" / "wildguard_train.parquet"
WILDGUARD_TEST_PATH = _DATA_ROOT / "raw" / "wildguardmix" / "original" / "test" / "wildguard_test.parquet"
STRATIFIED_PATH = _DATA_ROOT / "ground-truth" / "stratified" / "RZV-241_stage_stratified_corpus.v1.jsonl"
ORCHESTRATOR_CONFIG = ROOT / "config" / "acsm-orchestrator.json"

SOURCE_TARGETS = {
    "baseline": 20,
    "lmsys": 31,
    "safedialbench": 40,
    "jailbreakbench": 40,
    "wildguardmix": 20,
    "synthetic": 49,
}
TOTAL_TARGET = sum(SOURCE_TARGETS.values())

SEVERITY_TO_INT = {"low": 1, "medium": 2, "high": 3, "critical": 4}


@dataclass
class CandidateCase:
    case_id: str
    source_family: str
    input_payload: dict[str, Any]
    source_meta: dict[str, Any]
    text: str
    matched_event_rules: list[str]
    matched_vcd_rules: list[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the RZV-242 expanded ground-truth pack.")
    parser.add_argument("--output-dir", default=str(OUTPUT_DIR), help="Directory for generated artifacts.")
    parser.add_argument("--report-dir", default=str(REPORT_DIR), help="Directory for generated reports.")
    return parser.parse_args()


def lower_text(record: dict[str, Any]) -> str:
    return "\n".join(turn.get("text", "") for turn in record.get("turns", []) if isinstance(turn, dict)).lower()


def rule_matches(text: str, event_rules: list[dict[str, Any]], vcd_rules: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    event_hits = []
    vcd_hits = []
    for rule in event_rules:
        hit = any(phrase.lower() in text for phrase in rule["phrases"])
        if hit:
            event_hits.append(rule["id"])
    for rule in vcd_rules:
        if rule.get("mode") == "all":
            hit = all(phrase.lower() in text for phrase in rule["phrases"])
        else:
            hit = any(phrase.lower() in text for phrase in rule["phrases"])
        if hit:
            vcd_hits.append(rule["id"])
    return event_hits, vcd_hits


def iter_jsonl(path: str | Path) -> Iterable[dict[str, Any]]:
    with Path(path).open("r", encoding="utf-8") as handle:
        for line in handle:
            payload = line.strip()
            if payload:
                yield json.loads(payload)


def normalize_turns(turns: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "turns": [
            {
                "id": turn.get("id", f"T{index + 1:03d}"),
                "role": turn.get("role", "user"),
                "text": str(turn.get("text", "")).strip(),
                "sourceTrust": turn.get("sourceTrust", "trusted"),
                "boundaryBypass": bool(turn.get("boundaryBypass", False)),
            }
            for index, turn in enumerate(turns)
            if str(turn.get("text", "")).strip()
        ]
    }


def load_baseline_cases(event_rules: list[dict[str, Any]], vcd_rules: list[dict[str, Any]]) -> list[CandidateCase]:
    cases = []
    for path in sorted(BASELINE_DIR.glob("*.input.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        normalized = normalize_turns(payload["turns"])
        text = lower_text(normalized)
        event_hits, vcd_hits = rule_matches(text, event_rules, vcd_rules)
        cases.append(
            CandidateCase(
                case_id=path.stem.replace(".input", ""),
                source_family="baseline",
                input_payload=normalized,
                source_meta={"fixture_path": str(path)},
                text=text,
                matched_event_rules=event_hits,
                matched_vcd_rules=vcd_hits,
            )
        )
    return cases


def load_lmsys_cases(target: int, event_rules: list[dict[str, Any]], vcd_rules: list[dict[str, Any]]) -> list[CandidateCase]:
    matched: list[CandidateCase] = []
    clean: list[CandidateCase] = []

    for parquet_path in sorted(LMSYS_DIR.glob("*.parquet")):
        parquet_file = pq.ParquetFile(parquet_path)
        for batch in parquet_file.iter_batches(
            columns=["conversation_id", "model", "conversation", "turn", "language", "openai_moderation", "redacted"],
            batch_size=1024,
        ):
            for row in batch.to_pylist():
                language = str(row.get("language") or "").strip().lower()
                if language not in {"english", "en"} and not language.startswith("english"):
                    continue
                try:
                    converted = convert_lmsys_row(row)
                except Exception:
                    continue
                text = lower_text(converted)
                event_hits, vcd_hits = rule_matches(text, event_rules, vcd_rules)
                flagged = any(item.get("flagged") for item in row.get("openai_moderation") or [] if isinstance(item, dict))
                candidate = CandidateCase(
                    case_id=f"lmsys-{row.get('conversation_id')}",
                    source_family="lmsys",
                    input_payload=normalize_turns(converted["turns"]),
                    source_meta={"conversation_id": row.get("conversation_id"), "model": row.get("model"), "flagged": flagged},
                    text=text,
                    matched_event_rules=event_hits,
                    matched_vcd_rules=vcd_hits,
                )
                if event_hits or vcd_hits or flagged:
                    if len(matched) < 25:
                        matched.append(candidate)
                elif len(clean) < 80:
                    clean.append(candidate)

                if len(matched) >= 25 and len(clean) >= 80:
                    break
            if len(matched) >= 25 and len(clean) >= 80:
                break
        if len(matched) >= 25 and len(clean) >= 80:
            break

    selected = matched[:25]
    remaining = target - len(selected)
    selected.extend(clean[:remaining])
    if len(selected) < target:
        selected.extend(matched[len(selected) - len(clean):target - len(selected)])
    return selected[:target]


def convert_safedial_row(row: dict[str, Any]) -> dict[str, Any]:
    turns = []
    for index, item in enumerate(row.get("history") or []):
        if not isinstance(item, dict):
            continue
        user_text = str(item.get("user", "")).strip()
        bot_text = str(item.get("bot", "")).strip()
        if user_text:
            turns.append(
                {
                    "id": f"T{len(turns) + 1:03d}",
                    "role": "user",
                    "text": user_text,
                    "sourceTrust": "trusted",
                    "boundaryBypass": False,
                }
            )
        if bot_text:
            turns.append(
                {
                    "id": f"T{len(turns) + 1:03d}",
                    "role": "assistant",
                    "text": bot_text,
                    "sourceTrust": "untrusted",
                    "boundaryBypass": False,
                }
            )
    return {"turns": turns}


def load_safedial_cases(target: int, event_rules: list[dict[str, Any]], vcd_rules: list[dict[str, Any]]) -> list[CandidateCase]:
    grouped: dict[str, deque[CandidateCase]] = defaultdict(deque)
    for row in iter_jsonl(SAFEDIAL_PATH):
        converted = convert_safedial_row(row)
        text = lower_text(converted)
        event_hits, vcd_hits = rule_matches(text, event_rules, vcd_rules)
        candidate = CandidateCase(
            case_id=f"safedial-{row.get('id')}",
            source_family="safedialbench",
            input_payload=converted,
            source_meta={"id": row.get("id"), "scene": row.get("scene"), "task": row.get("task"), "method": row.get("method")},
            text=text,
            matched_event_rules=event_hits,
            matched_vcd_rules=vcd_hits,
        )
        grouped[str(row.get("scene") or "unknown")].append(candidate)

    selected: list[CandidateCase] = []
    scene_names = sorted(grouped)
    while len(selected) < target and scene_names:
        next_scene_names = []
        for scene in scene_names:
            if grouped[scene]:
                selected.append(grouped[scene].popleft())
            if grouped[scene]:
                next_scene_names.append(scene)
            if len(selected) >= target:
                break
        scene_names = next_scene_names
    return selected[:target]


def convert_jailbreak_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "turns": [
            {
                "id": "T001",
                "role": "user",
                "text": str(row.get("Goal", "")).strip(),
                "sourceTrust": "trusted",
                "boundaryBypass": True,
            },
            {
                "id": "T002",
                "role": "assistant",
                "text": str(row.get("Target", "")).strip(),
                "sourceTrust": "untrusted",
                "boundaryBypass": False,
            },
        ]
    }


def load_jailbreak_cases(target: int, event_rules: list[dict[str, Any]], vcd_rules: list[dict[str, Any]]) -> list[CandidateCase]:
    grouped: dict[str, deque[CandidateCase]] = defaultdict(deque)
    with JAILBREAK_PATH.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            row = json.loads(line)
            converted = convert_jailbreak_row(row)
            text = lower_text(converted)
            event_hits, vcd_hits = rule_matches(text, event_rules, vcd_rules)
            key = str(row.get("Behavior") or "unknown")
            grouped[key].append(
                CandidateCase(
                    case_id=f"jbb-{line_number:05d}",
                    source_family="jailbreakbench",
                    input_payload=converted,
                    source_meta={"behavior": row.get("Behavior"), "category": row.get("Category")},
                    text=text,
                    matched_event_rules=event_hits,
                    matched_vcd_rules=vcd_hits,
                )
            )

    selected: list[CandidateCase] = []
    group_names = sorted(grouped)
    while len(selected) < target and group_names:
        next_group_names = []
        for name in group_names:
            if grouped[name]:
                selected.append(grouped[name].popleft())
            if grouped[name]:
                next_group_names.append(name)
            if len(selected) >= target:
                break
        group_names = next_group_names
    return selected[:target]


def convert_wildguard_row(row: dict[str, Any], case_id: str) -> dict[str, Any]:
    return {
        "turns": [
            {
                "id": f"{case_id}-T001",
                "role": "user",
                "text": str(row.get("prompt", "")).strip(),
                "sourceTrust": "trusted",
                "boundaryBypass": bool(row.get("adversarial")),
            },
            {
                "id": f"{case_id}-T002",
                "role": "assistant",
                "text": str(row.get("response", "")).strip(),
                "sourceTrust": "untrusted",
                "boundaryBypass": False,
            },
        ]
    }


def load_wildguard_cases(target: int, event_rules: list[dict[str, Any]], vcd_rules: list[dict[str, Any]]) -> list[CandidateCase]:
    tables = [
        pq.read_table(WILDGUARD_TRAIN_PATH, columns=["prompt", "response", "adversarial", "prompt_harm_label", "response_harm_label", "response_refusal_label", "subcategory"]),
        pq.read_table(WILDGUARD_TEST_PATH, columns=["prompt", "response", "adversarial", "prompt_harm_label", "response_harm_label", "response_refusal_label", "subcategory"]),
    ]
    rows = []
    for table in tables:
        rows.extend(table.to_pylist())

    grouped = {True: deque(), False: deque()}
    for index, row in enumerate(rows, start=1):
        case_id = f"wildguard-{index:05d}"
        converted = convert_wildguard_row(row, case_id)
        text = lower_text(converted)
        event_hits, vcd_hits = rule_matches(text, event_rules, vcd_rules)
        grouped[bool(row.get("adversarial"))].append(
            CandidateCase(
                case_id=case_id,
                source_family="wildguardmix",
                input_payload=converted,
                source_meta={
                    "adversarial": bool(row.get("adversarial")),
                    "prompt_harm_label": row.get("prompt_harm_label"),
                    "response_harm_label": row.get("response_harm_label"),
                    "response_refusal_label": row.get("response_refusal_label"),
                    "subcategory": row.get("subcategory"),
                },
                text=text,
                matched_event_rules=event_hits,
                matched_vcd_rules=vcd_hits,
            )
        )

    selected = []
    each_side = target // 2
    selected.extend(list(grouped[False])[:each_side])
    selected.extend(list(grouped[True])[: target - each_side])
    return selected


def load_synthetic_cases(missing_event_rules: list[str], missing_vcd_rules: list[str]) -> list[CandidateCase]:
    rows = list(iter_jsonl(STRATIFIED_PATH))
    event_lookup = {}
    vcd_lookup = {}
    control_case = None
    for row in rows:
        annotations = row.get("annotations") or {}
        if row.get("stage") == "Event Engine" and annotations.get("rule_id") and annotations["rule_id"] not in event_lookup:
            event_lookup[annotations["rule_id"]] = row
        if row.get("stage") == "VCD" and annotations.get("rule_id") and annotations["rule_id"] not in vcd_lookup:
            vcd_lookup[annotations["rule_id"]] = row
        if row.get("stage") == "Event Engine" and annotations.get("control") and control_case is None:
            control_case = row

    cases = []
    for rule_id in missing_event_rules:
        row = event_lookup[rule_id]
        cases.append(
            CandidateCase(
                case_id=f"synthetic-event-{rule_id.lower()}",
                source_family="synthetic",
                input_payload=row["stage_input"],
                source_meta={"origin_case_id": row["case_id"], "rule_id": rule_id},
                text=lower_text(row["stage_input"]),
                matched_event_rules=[rule_id],
                matched_vcd_rules=[],
            )
        )
    for rule_id in missing_vcd_rules:
        row = vcd_lookup[rule_id]
        cases.append(
            CandidateCase(
                case_id=f"synthetic-vcd-{rule_id.lower()}",
                source_family="synthetic",
                input_payload=row["stage_input"],
                source_meta={"origin_case_id": row["case_id"], "rule_id": rule_id},
                text=lower_text(row["stage_input"]),
                matched_event_rules=[],
                matched_vcd_rules=[rule_id],
            )
        )
    if control_case is not None:
        cases.append(
            CandidateCase(
                case_id="synthetic-control-001",
                source_family="synthetic",
                input_payload=control_case["stage_input"],
                source_meta={"origin_case_id": control_case["case_id"], "control": True},
                text=lower_text(control_case["stage_input"]),
                matched_event_rules=[],
                matched_vcd_rules=[],
            )
        )
    return cases


def compact_expected(case: CandidateCase, batch_result: dict[str, Any]) -> dict[str, Any]:
    orchestrator = batch_result["result"]
    event_rules = sorted({item["ruleId"] for item in orchestrator["steps"]["eventEngine"]["events"]})
    vcd_rules = sorted({item["rule_id"] for item in orchestrator["steps"]["vcd"]["events"]})
    return {
        "case_id": case.case_id,
        "source_family": case.source_family,
        "source_meta": case.source_meta,
        "input": case.input_payload,
        "expected": {
            "axis_scores": orchestrator["derived"]["axisScores"],
            "risk_status": orchestrator["report"]["risk_status"],
            "peak_status": orchestrator["report"]["peak_status"],
            "event_rules": event_rules,
            "vcd_rules": vcd_rules,
            "tag_decision_level": orchestrator["summary"]["tagDecisionLevel"],
            "vcd_status": orchestrator["summary"]["vcdStatus"],
            "ps": orchestrator["steps"]["ps"]["ps"],
            "sub": orchestrator["steps"]["ps"]["sub"],
            "event_count": orchestrator["summary"]["unifiedEventCount"],
            "stability_index": orchestrator["report"]["stability_index"],
        },
    }


def build_annotation_items(batch_result: dict[str, Any], rater_id: str) -> list[dict[str, Any]]:
    result = batch_result["result"]
    items = []
    for event in result["steps"]["eventEngine"]["events"]:
        items.append(
            {
                "conversation_id": batch_result["id"],
                "turn_id": event.get("turnId") or "T001",
                "rater_id": rater_id,
                "axis": event["axis"],
                "event_code": event["ruleId"],
                "severity": SEVERITY_TO_INT.get(event["severity"], 0),
                "confidence": 0.95,
                "notes": "event-engine-match",
            }
        )
    for event in result["steps"]["vcd"]["events"]:
        items.append(
            {
                "conversation_id": batch_result["id"],
                "turn_id": event.get("turn_id") or event.get("turnId") or "T001",
                "rater_id": rater_id,
                "axis": "VCD",
                "event_code": event["rule_id"],
                "severity": SEVERITY_TO_INT.get(event["severity"], 0),
                "confidence": 0.95,
                "notes": "vcd-match",
            }
        )
    return items


def build_dual_rater_batch(cases: list[CandidateCase], results_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    conversations = []
    for case in cases:
        batch_result = results_by_id[case.case_id]
        turns = [
            {
                "turn_id": turn["id"],
                "role": turn["role"],
                "text": turn["text"],
            }
            for turn in case.input_payload["turns"]
        ]
        rater_a = build_annotation_items(batch_result, "rater_A")
        rater_b = copy.deepcopy(rater_a)
        for item in rater_b:
            item["rater_id"] = "rater_B"
        conversations.append(
            {
                "conversation_id": case.case_id,
                "turns": turns,
                "rater_a": rater_a,
                "rater_b": rater_b,
                "consensus": None,
                "cohens_kappa": None,
            }
        )
    return {
        "batch_id": "rzv-242-expanded-ground-truth-200",
        "target_count": len(cases),
        "completed_count": len(cases),
        "conversations": conversations,
    }


def write_json(path: str | Path, payload: Any) -> None:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(path: str | Path, rows: Iterable[dict[str, Any]]) -> None:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def run_batch(batch_input_path: Path, batch_output_path: Path) -> dict[str, Any]:
    completed = subprocess.run(
        [
            "node",
            "scripts/acsm-batch-runner.mjs",
            "--input",
            str(batch_input_path),
            "--config",
            str(ORCHESTRATOR_CONFIG),
            "--output",
            str(batch_output_path),
            "--include-results",
            "true",
            "--max-cases",
            str(TOTAL_TARGET),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if completed.returncode not in {0, 1}:
        stderr = (completed.stderr or "").strip()
        stdout = (completed.stdout or "").strip()
        details = stderr or stdout or "unknown acsm-batch-runner failure"
        raise RuntimeError(f"acsm-batch-runner failed with exit code {completed.returncode}: {details}")
    if not batch_output_path.exists():
        raise FileNotFoundError(f"Batch output was not generated: {batch_output_path}")
    return json.loads(batch_output_path.read_text(encoding="utf-8"))


def run_irr(batch_path: Path, report_path: Path) -> dict[str, Any]:
    subprocess.run(
        [
            "node",
            "scripts/annotation-workflow.mjs",
            "irr",
            "--input",
            str(batch_path),
            "--output",
            str(report_path),
            "--target-kappa",
            "0.61",
            "--enforce-target",
        ],
        cwd=ROOT,
        check=True,
    )
    return json.loads(report_path.read_text(encoding="utf-8"))


def summarize_manifest(
    manifest: list[dict[str, Any]],
    irr_report: dict[str, Any],
    source_counts: dict[str, int],
    valid_event_rule_ids: set[str],
    valid_vcd_rule_ids: set[str],
) -> dict[str, Any]:
    observed_event_rules = {rule for row in manifest for rule in row["expected"]["event_rules"]}
    observed_vcd_rules = {rule for row in manifest for rule in row["expected"]["vcd_rules"]}
    event_coverage = sorted(observed_event_rules & valid_event_rule_ids)
    vcd_coverage = sorted(observed_vcd_rules & valid_vcd_rule_ids)
    risk_distribution = dict(sorted(Counter(row["expected"]["risk_status"] for row in manifest).items()))
    return {
        "issue": "RZV-242",
        "total_cases": len(manifest),
        "source_counts": source_counts,
        "risk_distribution": risk_distribution,
        "event_rule_coverage": {
            "count": len(event_coverage),
            "rules": event_coverage,
        },
        "vcd_rule_coverage": {
            "count": len(vcd_coverage),
            "rules": vcd_coverage,
        },
        "ignored_extra_rules": {
            "event_rules": sorted(observed_event_rules - valid_event_rule_ids),
            "vcd_rules": sorted(observed_vcd_rules - valid_vcd_rule_ids),
        },
        "irr": irr_report,
        "validation": {
            "meets_total_cases": len(manifest) >= 200,
            "meets_event_rule_coverage": len(event_coverage) == len(valid_event_rule_ids),
            "meets_vcd_rule_coverage": len(vcd_coverage) == len(valid_vcd_rule_ids),
            "meets_risk_status_coverage": len(risk_distribution) == 4,
            "meets_kappa": float(irr_report.get("batch_kappa") or 0) >= 0.61,
        },
    }


def build_source_counts(cases: list[CandidateCase]) -> dict[str, int]:
    return dict(sorted(Counter(case.source_family for case in cases).items()))


def build_phase1_ground_truth(output_dir: str | Path = OUTPUT_DIR, report_dir: str | Path = REPORT_DIR) -> dict[str, Any]:
    output_root = Path(output_dir)
    report_root = Path(report_dir)
    event_rules = load_js_export("scripts/event-engine-v1.mjs", "DEFAULT_RULES")
    vcd_rules = load_js_export("scripts/vcd-inference.mjs", "DEFAULT_MATRIX")

    baseline_cases = load_baseline_cases(event_rules, vcd_rules)
    synthetic_missing_event = [
        "FR_04",
        "FR_05",
        "FR_06",
        "FR_11",
        "FR_02",
        "FR_03",
        "FR_07",
        "FR_08",
        "FR_09",
        "FR_10",
        "CA_03",
        "CA_05",
        "CA_07",
        "CA_08",
        "CA_09",
        "CA_11",
        "SR_03",
        "SR_04",
        "SR_07",
        "SR_09",
        "SR_11",
        "SA_01",
        "SA_02",
        "SA_03",
        "SA_04",
        "SA_05",
        "SA_06",
        "SA_07",
        "SA_08",
        "SA_09",
        "SA_10",
    ]
    synthetic_missing_vcd = [
        "VCDE_01",
        "VCDE_02",
        "VCDE_03",
        "VCDE_04",
        "VCDE_06",
        "VCDE_07",
        "VCDE_09",
        "VCDE_10",
        "VCDE_11",
        "VCDE_12",
        "VCDE_13",
        "VCDE_14",
        "VCDE_15",
        "VCDE_17",
        "VCDE_18",
        "VCDE_19",
        "VCDE_20",
    ]

    real_cases = (
        load_lmsys_cases(SOURCE_TARGETS["lmsys"], event_rules, vcd_rules)
        + load_safedial_cases(SOURCE_TARGETS["safedialbench"], event_rules, vcd_rules)
        + load_jailbreak_cases(SOURCE_TARGETS["jailbreakbench"], event_rules, vcd_rules)
        + load_wildguard_cases(SOURCE_TARGETS["wildguardmix"], event_rules, vcd_rules)
    )
    synthetic_cases = load_synthetic_cases(synthetic_missing_event, synthetic_missing_vcd)

    cases = baseline_cases + real_cases + synthetic_cases
    if len(cases) != TOTAL_TARGET:
        raise ValueError(f"Expected {TOTAL_TARGET} cases, got {len(cases)}.")

    batch_input_path = output_root / "RZV-242_batch_input.200.json"
    batch_output_path = output_root / "RZV-242_batch_output.200.json"
    manifest_path = output_root / "RZV-242_ground_truth_manifest.200.jsonl"
    annotation_batch_path = output_root / "RZV-242_dual_rater_batch.200.json"
    irr_report_path = report_root / "RZV-242_irr_report.200.json"
    summary_report_path = report_root / "RZV-242_ground_truth_report.200.json"

    batch_payload = {
        "cases": [{"id": case.case_id, "input": case.input_payload} for case in cases]
    }
    if batch_input_path.exists() and batch_output_path.exists():
        batch_output = json.loads(batch_output_path.read_text(encoding="utf-8"))
    elif batch_input_path.exists() or batch_output_path.exists():
        raise FileExistsError(
            "Detected partial existing batch artifacts. Refusing to overwrite because only one of "
            f"{batch_input_path.name} / {batch_output_path.name} exists."
        )
    else:
        write_json(batch_input_path, batch_payload)
        batch_output = run_batch(batch_input_path, batch_output_path)
    results_by_id = {item["id"]: item for item in batch_output["results"]}

    manifest = [compact_expected(case, results_by_id[case.case_id]) for case in cases]
    write_jsonl(manifest_path, manifest)

    annotation_batch = build_dual_rater_batch(cases, results_by_id)
    write_json(annotation_batch_path, annotation_batch)
    irr_report = run_irr(annotation_batch_path, irr_report_path)

    report = summarize_manifest(
        manifest,
        irr_report,
        build_source_counts(cases),
        {rule["id"] for rule in event_rules},
        {rule["id"] for rule in vcd_rules},
    )
    report["artifacts"] = {
        "batch_input_path": str(batch_input_path),
        "batch_output_path": str(batch_output_path),
        "manifest_path": str(manifest_path),
        "annotation_batch_path": str(annotation_batch_path),
        "irr_report_path": str(irr_report_path),
        "summary_report_path": str(summary_report_path),
    }
    write_json(summary_report_path, report)
    return report


def main() -> None:
    args = parse_args()
    report = build_phase1_ground_truth(args.output_dir, args.report_dir)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
