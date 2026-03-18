from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Iterator

if __package__ in {None, ""}:
    import sys

    sys.path.append(str(Path(__file__).resolve().parents[1]))

from converters._acsm_common import build_record, iter_input_records, to_jsonable, write_json

PLACEHOLDER_RESPONSE = "[placeholder] Expected assistant response unavailable in source artifact."


def classify_attack_family(method: str | None, template_name: str | None = None) -> tuple[str, str]:
    normalized_method = (method or "").strip()
    normalized_template = (template_name or "").strip().upper()
    if normalized_method == "JBC" or normalized_template in {"AIM", "DAN"}:
        return "DAN_or_roleplay_persona", "DAN"
    if normalized_method == "PAIR":
        return "roleplay_scenario_reframing", "roleplay"
    if normalized_method in {"DSN", "GCG"}:
        return "adversarial_suffix_or_encoding_like", "encoding"
    if normalized_method == "prompt_with_random_search":
        return "rule_override_prompt_injection", "system_override"
    return "placeholder_or_unknown", "placeholder"


def iter_jailbreakbench_rows(input_path: str | Path) -> Iterator[dict[str, Any]]:
    path = Path(input_path)
    if path.is_dir():
        for artifact_path in sorted(path.rglob("*.json")):
            if artifact_path.name == "attack-info.json":
                continue
            payload = json.loads(artifact_path.read_text(encoding="utf-8"))
            method = artifact_path.parents[1].name
            attack_type = artifact_path.parent.name
            model_name = artifact_path.stem
            template_name = payload.get("parameters", {}).get("method_parameters", {}).get("template_name")
            heuristic_attack_family, issue_requested_family = classify_attack_family(method, template_name)
            for index, jailbreak in enumerate(payload.get("jailbreaks", []), start=1):
                if not jailbreak.get("prompt"):
                    continue
                yield {
                    "case_id": f"{method}-{attack_type}-{model_name}-{index:03d}",
                    "method": method,
                    "attack_type": attack_type,
                    "model_name": model_name,
                    "official_method_name": payload.get("parameters", {}).get("method"),
                    "template_name": template_name,
                    "heuristic_attack_family": heuristic_attack_family,
                    "issue_requested_family": issue_requested_family,
                    **jailbreak,
                }
        return
    yield from iter_input_records(path)


def convert_jailbreakbench_row(row: dict[str, Any]) -> dict[str, Any]:
    prompt = row.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("JailbreakBench row requires non-empty string `prompt`.")

    response = row.get("response")
    response_text = response.strip() if isinstance(response, str) and response.strip() else PLACEHOLDER_RESPONSE
    method = row.get("method") or row.get("official_method_name")
    template_name = row.get("template_name")
    heuristic_attack_family = row.get("heuristic_attack_family")
    issue_requested_family = row.get("issue_requested_family")
    if not isinstance(heuristic_attack_family, str) or not heuristic_attack_family:
        heuristic_attack_family, issue_requested_family = classify_attack_family(method, template_name)

    turns = [
        {
            "id": "T001",
            "role": "user",
            "sourceTrust": "trusted",
            "boundaryBypass": True,
            "text": prompt.strip(),
        },
        {
            "id": "T002",
            "role": "assistant",
            "sourceTrust": "untrusted",
            "boundaryBypass": False,
            "text": response_text,
        },
    ]
    meta = {
        "source": "jailbreakbench",
        "case_id": row.get("case_id"),
        "method": method,
        "attack_type": row.get("attack_type"),
        "model_name": row.get("model_name"),
        "template_name": template_name,
        "heuristic_attack_family": heuristic_attack_family,
        "issue_requested_family": issue_requested_family,
        "goal": row.get("goal"),
        "behavior": row.get("behavior"),
        "category": row.get("category"),
        "jailbroken": row.get("jailbroken"),
        "expected_flag": "TAG_escalation",
    }
    return build_record(turns, meta)


def convert_input(input_path: str | Path, output_path: str | Path, limit: int | None = None) -> dict[str, Any]:
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "input_path": str(input_path),
        "output_path": str(output_path),
        "records_seen": 0,
        "records_written": 0,
        "error_count": 0,
        "errors": [],
        "limit": limit,
    }
    with output_path.open("w", encoding="utf-8") as handle:
        for row in iter_jailbreakbench_rows(input_path):
            if limit is not None and report["records_written"] >= limit:
                break
            report["records_seen"] += 1
            try:
                converted = convert_jailbreakbench_row(row)
            except Exception as exc:  # noqa: BLE001
                report["error_count"] += 1
                if len(report["errors"]) < 10:
                    report["errors"].append(str(exc))
                continue
            handle.write(json.dumps(to_jsonable(converted), ensure_ascii=False) + "\n")
            report["records_written"] += 1
    report["converter"] = "jailbreakbench_to_acsm"
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert JailbreakBench prompts into A-CSM JSONL.")
    parser.add_argument("--input-path", required=True, help="Path to JailbreakBench mapping JSONL or artifact directory.")
    parser.add_argument("--output-path", required=True, help="Path to converted A-CSM JSONL output.")
    parser.add_argument("--report-path", help="Optional JSON report output path.")
    parser.add_argument("--limit", type=int, default=None, help="Maximum converted records to write.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = convert_input(args.input_path, args.output_path, args.limit)
    if args.report_path:
        write_json(args.report_path, report)


if __name__ == "__main__":
    main()
