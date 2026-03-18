from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import yaml

if __package__ in {None, ""}:
    sys.path.append(str(Path(__file__).resolve().parents[1]))

from pipeline.data_filter import load_config as load_filter_base_config
from pipeline.data_filter import run_filter

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = ROOT / "test" / "config" / "dataset_test.yaml"
DEFAULT_BATCH_CONFIG_PATH = ROOT / "config" / "acsm-orchestrator.json"
PHASE_CHOICES = {"1", "2", "3"}
PII_DETECTORS = (
    "email_cases",
    "phone_cases",
    "ipv4_cases",
    "tw_id_cases",
    "credit_card_cases",
    "query_secret_cases",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the dataset testing pipeline for A-CSM.")
    parser.add_argument("--phase", required=True, choices=sorted(PHASE_CHOICES), help="Phase number to execute.")
    parser.add_argument("--sample", type=int, default=100, help="Target sample size for the generated test set.")
    parser.add_argument("--config-path", default=str(DEFAULT_CONFIG_PATH), help="Dataset test YAML config.")
    parser.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 1), help="Parallel converter workers.")
    return parser.parse_args()


def resolve_path(path_value: str | Path) -> Path:
    path = Path(path_value)
    return path if path.is_absolute() else ROOT / path


def read_yaml(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle)
    if not isinstance(payload, dict):
        raise ValueError("Dataset test config must decode to an object.")
    return payload


def write_json(path: str | Path, payload: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(to_jsonable(payload), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_markdown(path: str | Path, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def iter_jsonl(path: str | Path) -> Iterable[dict[str, Any]]:
    with Path(path).open("r", encoding="utf-8") as handle:
        for line in handle:
            payload = line.strip()
            if payload:
                yield json.loads(payload)


def to_jsonable(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_jsonable(item) for item in value]
    if isinstance(value, tuple):
        return [to_jsonable(item) for item in value]
    return value


def build_run_id(phase: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"phase{phase}-{stamp}"


def build_artifact_paths(phase: str, run_id: str) -> dict[str, Path]:
    return {
        "converted_dir": ROOT / "test-data" / "converted" / "dataset-tests" / f"phase{phase}" / run_id,
        "quality_dir": ROOT / "test-data" / "quality" / "dataset-tests" / f"phase{phase}" / run_id,
        "ground_truth_dir": ROOT / "test-data" / "ground-truth" / "dataset-tests" / f"phase{phase}" / run_id,
        "test_set_dir": ROOT / "test-data" / "test-sets" / "dataset-tests" / f"phase{phase}" / run_id,
        "report_dir": ROOT / "test-data" / "reports" / "dataset-tests" / f"phase{phase}" / run_id,
    }


def build_pii_case_counts(sample_size: int) -> dict[str, int]:
    target_total = max(sample_size, len(PII_DETECTORS))
    base = target_total // len(PII_DETECTORS)
    remainder = target_total % len(PII_DETECTORS)
    counts = {name: base for name in PII_DETECTORS}
    for detector in PII_DETECTORS[:remainder]:
        counts[detector] += 1
    return counts


def build_conversion_command(dataset: dict[str, Any], sample_size: int, paths: dict[str, Path]) -> dict[str, Any]:
    name = str(dataset["name"])
    converter = str(dataset["converter"])
    converted_path = paths["converted_dir"] / f"{name}.acsm.jsonl"
    report_path = paths["report_dir"] / "converters" / f"{name}.convert.report.json"
    command = [sys.executable]
    limit = max(sample_size, int(dataset.get("convert_limit_min", sample_size)))

    if converter == "lmsys_to_acsm":
        command.extend(
            [
                "converters/lmsys_to_acsm.py",
                "--input-path",
                str(resolve_path(dataset["input_path"])),
                "--output-path",
                str(converted_path),
                "--report-path",
                str(report_path),
                "--limit",
                str(limit),
            ]
        )
    elif converter == "wildchat_to_acsm":
        command.extend(
            [
                "converters/wildchat_to_acsm.py",
                "--input-path",
                str(resolve_path(dataset["input_path"])),
                "--output-path",
                str(converted_path),
                "--report-path",
                str(report_path),
                "--limit",
                str(limit),
            ]
        )
    elif converter == "sharegpt_to_acsm":
        command.extend(
            [
                "converters/sharegpt_to_acsm.py",
                "--input-path",
                str(resolve_path(dataset["input_path"])),
                "--output-path",
                str(converted_path),
                "--report-path",
                str(report_path),
                "--input-format",
                str(dataset.get("input_format", "auto")),
                "--limit",
                str(limit),
            ]
        )
    elif converter == "jailbreakbench_to_acsm":
        command.extend(
            [
                "converters/jailbreakbench_to_acsm.py",
                "--input-path",
                str(resolve_path(dataset["input_path"])),
                "--output-path",
                str(converted_path),
                "--report-path",
                str(report_path),
                "--limit",
                str(limit),
            ]
        )
    elif converter == "pii_to_acsm":
        pii_counts = build_pii_case_counts(sample_size)
        ground_truth_path = paths["ground_truth_dir"] / f"{name}.ground-truth.jsonl"
        command.extend(
            [
                "converters/pii_to_acsm.py",
                "--spy-legal-path",
                str(resolve_path(dataset["spy_legal_path"])),
                "--spy-medical-path",
                str(resolve_path(dataset["spy_medical_path"])),
                "--wildchat-path",
                str(resolve_path(dataset["wildchat_path"])),
                "--output-path",
                str(converted_path),
                "--ground-truth-path",
                str(ground_truth_path),
                "--report-path",
                str(report_path),
                "--email-cases",
                str(pii_counts["email_cases"]),
                "--phone-cases",
                str(pii_counts["phone_cases"]),
                "--ipv4-cases",
                str(pii_counts["ipv4_cases"]),
                "--tw-id-cases",
                str(pii_counts["tw_id_cases"]),
                "--credit-card-cases",
                str(pii_counts["credit_card_cases"]),
                "--query-secret-cases",
                str(pii_counts["query_secret_cases"]),
            ]
        )
    else:
        raise ValueError(f"Unsupported converter type: {converter}")

    return {
        "name": name,
        "converter": converter,
        "expected_language": dataset.get("expected_language"),
        "sample_weight": int(dataset.get("sample_weight", 1)),
        "dedupe": bool(dataset.get("dedupe", True)),
        "keep_invalid_encoding": bool(dataset.get("keep_invalid_encoding", False)),
        "converted_path": converted_path,
        "report_path": report_path,
        "ground_truth_path": locals().get("ground_truth_path"),
        "command": command,
    }


def run_converter_job(job: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    completed = subprocess.run(job["command"], cwd=ROOT, capture_output=True, text=True)
    duration = time.perf_counter() - started
    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        stdout = (completed.stdout or "").strip()
        details = stderr or stdout or "converter failed without output"
        raise RuntimeError(f"{job['name']} conversion failed: {details}")
    report = json.loads(job["report_path"].read_text(encoding="utf-8"))
    return {
        **job,
        "duration_seconds": round(duration, 6),
        "report": report,
    }


def build_filter_config(
    base_config_path: str | Path,
    phase: str,
    conversion_results: list[dict[str, Any]],
    paths: dict[str, Path],
) -> tuple[dict[str, Any], Path]:
    base_config = load_filter_base_config(resolve_path(base_config_path))
    filter_config_path = paths["report_dir"] / f"phase{phase}.filter.config.yaml"
    datasets = []
    for result in conversion_results:
        datasets.append(
            {
                "name": result["name"],
                "input_path": str(result["converted_path"]),
                "primary_output_path": str(paths["quality_dir"] / f"{result['name']}.primary.acsm.jsonl"),
                "chinese_output_path": str(paths["quality_dir"] / f"{result['name']}.zh.acsm.jsonl"),
                "overrides": {
                    "expected_language": result["expected_language"],
                    "dedupe": result["dedupe"],
                    "keep_invalid_encoding": result["keep_invalid_encoding"],
                },
            }
        )
    filter_config = {
        "version": f"dataset-test-phase-{phase}",
        "filters": base_config["filters"],
        "datasets": datasets,
        "_config_path": str(filter_config_path),
    }
    filter_config_path.parent.mkdir(parents=True, exist_ok=True)
    filter_config_path.write_text(
        yaml.safe_dump({key: value for key, value in filter_config.items() if not key.startswith("_")}, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    return filter_config, filter_config_path


def round_robin_sample(
    buckets: dict[str, list[dict[str, Any]]],
    sample_weights: dict[str, int],
    sample_size: int,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    ordered_slots: list[str] = []
    for dataset_name in sorted(sample_weights):
        ordered_slots.extend([dataset_name] * max(1, int(sample_weights[dataset_name])))

    pointers = Counter()
    distribution = Counter()
    selected: list[dict[str, Any]] = []

    while len(selected) < sample_size:
        appended = False
        for dataset_name in ordered_slots:
            rows = buckets.get(dataset_name, [])
            index = pointers[dataset_name]
            if index >= len(rows):
                continue
            record = rows[index]
            pointers[dataset_name] += 1
            distribution[dataset_name] += 1
            selected.append(
                {
                    "id": f"{dataset_name}-{distribution[dataset_name]:04d}",
                    "input": record,
                }
            )
            appended = True
            if len(selected) >= sample_size:
                break
        if not appended:
            break
    return selected, dict(sorted(distribution.items()))


def build_batch_input(
    filter_report: dict[str, Any],
    conversion_results: list[dict[str, Any]],
    sample_size: int,
    paths: dict[str, Path],
) -> dict[str, Any]:
    buckets: dict[str, list[dict[str, Any]]] = {}
    sample_weights = {item["name"]: item["sample_weight"] for item in conversion_results}
    available_counts = {}
    for dataset_report in filter_report["datasets"]:
        dataset_name = dataset_report["dataset"]
        primary_path = Path(dataset_report["primary_output_path"])
        chinese_path = Path(dataset_report["chinese_output_path"])
        rows = list(iter_jsonl(primary_path))
        if chinese_path.exists():
            rows.extend(iter_jsonl(chinese_path))
        buckets[dataset_name] = rows
        available_counts[dataset_name] = len(rows)

    selected_cases, distribution = round_robin_sample(buckets, sample_weights, sample_size)
    batch_input = {"cases": selected_cases}
    batch_input_path = paths["test_set_dir"] / f"phase{filter_report['config_version'].split('-')[-1]}.batch-input.json"
    sampler_report_path = paths["report_dir"] / "sampling.report.json"
    write_json(batch_input_path, batch_input)
    sampler_report = {
        "generated_at": utc_now(),
        "available_primary_records": dict(sorted(available_counts.items())),
        "selected_case_count": len(selected_cases),
        "selected_distribution": distribution,
        "requested_sample_size": sample_size,
        "batch_input_path": str(batch_input_path),
    }
    write_json(sampler_report_path, sampler_report)
    return {
        "batch_input": batch_input,
        "batch_input_path": batch_input_path,
        "sampler_report": sampler_report,
        "sampler_report_path": sampler_report_path,
    }


def run_batch_runner(batch_input_path: Path, sample_size: int, paths: dict[str, Path]) -> tuple[dict[str, Any], Path, float]:
    batch_output_path = paths["report_dir"] / "acsm-batch.report.json"
    started = time.perf_counter()
    completed = subprocess.run(
        [
            "node",
            "scripts/acsm-batch-runner.mjs",
            "--input",
            str(batch_input_path),
            "--config",
            str(DEFAULT_BATCH_CONFIG_PATH),
            "--output",
            str(batch_output_path),
            "--include-results",
            "true",
            "--max-cases",
            str(sample_size),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    duration = time.perf_counter() - started
    if completed.returncode not in {0, 1}:
        stderr = (completed.stderr or "").strip()
        stdout = (completed.stdout or "").strip()
        details = stderr or stdout or "batch runner failed without output"
        raise RuntimeError(f"Batch runner failed: {details}")
    if not batch_output_path.exists():
        raise FileNotFoundError(f"Batch report was not generated: {batch_output_path}")
    return json.loads(batch_output_path.read_text(encoding="utf-8")), batch_output_path, duration


def collect_failed_cases(batch_output: dict[str, Any], limit: int = 20) -> list[dict[str, Any]]:
    failures = []
    for item in batch_output.get("cases", []):
        if item.get("decision") == "GO":
            continue
        failures.append(
            {
                "id": item.get("id"),
                "decision": item.get("decision"),
                "blocking_findings": item.get("blockingFindings"),
                "unified_event_count": item.get("unifiedEventCount"),
                "vcd_status": item.get("vcdStatus"),
                "tag_decision_level": item.get("tagDecisionLevel"),
                "schema_decision": item.get("schemaDecision"),
                "release_gate_decision": item.get("releaseGateDecision"),
            }
        )
    return failures[:limit]


def build_scaffold_report(phase: str, sample_size: int, run_id: str, paths: dict[str, Path]) -> dict[str, Any]:
    return {
        "generated_at": utc_now(),
        "run_id": run_id,
        "phase": phase,
        "sample_requested": sample_size,
        "execution_mode": "scaffold",
        "summary": {
            "status": "pending_dataset_ingestion",
            "message": f"Phase {phase} is structurally supported but no datasets are configured yet.",
        },
        "artifacts": {
            "report_dir": str(paths["report_dir"]),
        },
    }


def render_markdown_report(report: dict[str, Any]) -> str:
    lines = ["# Dataset Test Report", ""]
    lines.append(f"- Run ID: `{report['run_id']}`")
    lines.append(f"- Phase: `{report['phase']}`")
    lines.append(f"- Sample requested: `{report['sample_requested']}`")
    lines.append(f"- Generated at: `{report['generated_at']}`")
    lines.append("")

    if report.get("execution_mode") == "scaffold":
        lines.append("## Status")
        lines.append("")
        lines.append(f"- {report['summary']['status']}: {report['summary']['message']}")
        return "\n".join(lines)

    lines.append("## Summary")
    lines.append("")
    lines.append(f"- Selected cases: `{report['sampling']['selected_case_count']}`")
    lines.append(f"- GO pass rate: `{report['engine']['pass_rate']:.4f}`")
    lines.append(f"- Batch decision: `{report['engine']['decision']}`")
    lines.append(f"- Total runtime: `{report['performance']['total_seconds']:.3f}s`")
    lines.append(f"- Engine runtime: `{report['performance']['engine_seconds']:.3f}s`")
    lines.append(f"- End-to-end ms / conversation: `{report['performance']['end_to_end_ms_per_conversation']:.2f}`")
    lines.append("")

    lines.append("## Datasets")
    lines.append("")
    for item in report["conversion"]["datasets"]:
        records_seen = item["report"].get("records_seen", item["report"].get("records_written", 0))
        lines.append(
            f"- `{item['name']}`: converted `{item['report']['records_written']}` / seen `{records_seen}`, "
            f"filter primary `{item['filter']['kept_primary']}`, chinese `{item['filter']['kept_chinese']}`"
        )
    lines.append("")

    lines.append("## Failed Cases")
    lines.append("")
    if report["engine"]["failed_cases"]:
        for item in report["engine"]["failed_cases"]:
            lines.append(
                f"- `{item['id']}`: decision `{item['decision']}`, blocking `{item['blocking_findings']}`, "
                f"VCD `{item['vcd_status']}`, TAG `{item['tag_decision_level']}`"
            )
    else:
        lines.append("- None")
    lines.append("")

    lines.append("## Artifacts")
    lines.append("")
    for key, value in sorted(report["artifacts"].items()):
        lines.append(f"- `{key}`: `{value}`")
    return "\n".join(lines)


def run_phase_pipeline(args: argparse.Namespace) -> dict[str, Any]:
    config = read_yaml(args.config_path)
    phase_config = (config.get("phases") or {}).get(str(args.phase), {})
    run_id = build_run_id(str(args.phase))
    paths = build_artifact_paths(str(args.phase), run_id)

    datasets = list(phase_config.get("datasets") or [])
    if not datasets:
        report = build_scaffold_report(str(args.phase), args.sample, run_id, paths)
        report_json_path = paths["report_dir"] / "dataset-test.report.json"
        report_md_path = paths["report_dir"] / "dataset-test.report.md"
        report["artifacts"]["json_report_path"] = str(report_json_path)
        report["artifacts"]["markdown_report_path"] = str(report_md_path)
        write_json(report_json_path, report)
        write_markdown(report_md_path, render_markdown_report(report))
        return report

    overall_started = time.perf_counter()
    conversion_started = time.perf_counter()
    conversion_jobs = [build_conversion_command(dataset, args.sample, paths) for dataset in datasets]
    conversion_results: list[dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        future_map = {executor.submit(run_converter_job, job): job["name"] for job in conversion_jobs}
        for future in as_completed(future_map):
            conversion_results.append(future.result())
    conversion_results.sort(key=lambda item: item["name"])
    conversion_duration = round(time.perf_counter() - conversion_started, 6)

    filter_started = time.perf_counter()
    filter_config, filter_config_path = build_filter_config(
        phase_config.get("filter_config_path", "config/data-filter.phase1.yaml"),
        str(args.phase),
        conversion_results,
        paths,
    )
    filter_report = run_filter(filter_config)
    filter_duration = time.perf_counter() - filter_started
    filter_report_path = paths["report_dir"] / "filter.report.json"
    write_json(filter_report_path, filter_report)

    filter_lookup = {item["dataset"]: item for item in filter_report["datasets"]}
    for result in conversion_results:
        result["filter"] = filter_lookup[result["name"]]

    sampling_started = time.perf_counter()
    sampling = build_batch_input(filter_report, conversion_results, args.sample, paths)
    sampling_duration = time.perf_counter() - sampling_started

    batch_output, batch_output_path, engine_duration = run_batch_runner(
        sampling["batch_input_path"],
        max(1, sampling["sampler_report"]["selected_case_count"]),
        paths,
    )
    total_duration = time.perf_counter() - overall_started

    processed_cases = int(batch_output["summary"]["processedCases"] or 0)
    go_cases = int(batch_output["summary"]["goCases"] or 0)
    pass_rate = (go_cases / processed_cases) if processed_cases else 0.0

    report = {
        "generated_at": utc_now(),
        "run_id": run_id,
        "phase": str(args.phase),
        "sample_requested": args.sample,
        "execution_mode": "full",
        "conversion": {
            "duration_seconds": round(conversion_duration, 6),
            "datasets": conversion_results,
        },
        "filter": {
            "duration_seconds": round(filter_duration, 6),
            "report": filter_report,
        },
        "sampling": {
            "duration_seconds": round(sampling_duration, 6),
            "selected_case_count": sampling["sampler_report"]["selected_case_count"],
            "selected_distribution": sampling["sampler_report"]["selected_distribution"],
            "report": sampling["sampler_report"],
        },
        "engine": {
            "duration_seconds": round(engine_duration, 6),
            "decision": batch_output["decision"],
            "summary": batch_output["summary"],
            "pass_rate": round(pass_rate, 6),
            "failed_cases": collect_failed_cases(batch_output),
        },
        "performance": {
            "total_seconds": round(total_duration, 6),
            "conversion_seconds": round(conversion_duration, 6),
            "filter_seconds": round(filter_duration, 6),
            "sampling_seconds": round(sampling_duration, 6),
            "engine_seconds": round(engine_duration, 6),
            "engine_ms_per_conversation": round((engine_duration * 1000 / processed_cases) if processed_cases else 0.0, 3),
            "end_to_end_ms_per_conversation": round((total_duration * 1000 / processed_cases) if processed_cases else 0.0, 3),
        },
        "artifacts": {
            "filter_config_path": str(filter_config_path),
            "filter_report_path": str(filter_report_path),
            "sampler_report_path": str(sampling["sampler_report_path"]),
            "batch_input_path": str(sampling["batch_input_path"]),
            "batch_output_path": str(batch_output_path),
            "report_dir": str(paths["report_dir"]),
        },
    }
    report_json_path = paths["report_dir"] / "dataset-test.report.json"
    report_md_path = paths["report_dir"] / "dataset-test.report.md"
    report["artifacts"]["json_report_path"] = str(report_json_path)
    report["artifacts"]["markdown_report_path"] = str(report_md_path)
    write_json(report_json_path, report)
    write_markdown(report_md_path, render_markdown_report(report))
    return report


def main() -> None:
    args = parse_args()
    report = run_phase_pipeline(args)
    print(json.dumps(to_jsonable(report), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
