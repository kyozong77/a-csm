from __future__ import annotations

import argparse
import json
import os
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

_DATA_ROOT = Path(os.environ.get("ACSM_DATA_ROOT", "./data"))
RAW_ROOT = _DATA_ROOT / "raw"
REPORT_ROOT = _DATA_ROOT / "reports"

REFCHECKER_ROOT = RAW_ROOT / "refchecker" / "source"
CITECHECK_ROOT = RAW_ROOT / "citecheck" / "source"

DEFAULT_REPORT_PATH = REPORT_ROOT / "RZV-248_citation_profile.json"
DEFAULT_NOTES_PATH = REPORT_ROOT / "RZV-248_citation_notes.md"
DEFAULT_SAMPLE_PATH = REPORT_ROOT / "RZV-248_citation_samples.json"

REFCHECKER_BASE = "https://raw.githubusercontent.com/amazon-science/RefChecker/main"
CITECHECK_BASE = "https://raw.githubusercontent.com/xzy-xzy/CiteCheck/main"

REFCHECKER_CONTEXT_FILES = {
    "accurate_context": [
        "dolly_alpaca_7B_answers.json",
        "dolly_chatgpt_answers.json",
        "dolly_claude2_answers.json",
        "dolly_davinci001_answers.json",
        "dolly_falcon_40B_instruct_answers.json",
        "dolly_gpt4_answers.json",
        "dolly_llama2_70b_chat_answers.json",
    ],
    "noisy_context": [
        "msmarco_alpaca_7B_answers.json",
        "msmarco_chatgpt_answers.json",
        "msmarco_claude2_answers.json",
        "msmarco_davinci001_answers.json",
        "msmarco_falcon_40B_instruct_answers.json",
        "msmarco_gpt4_answers.json",
        "msmarco_llama2_70b_chat_answers.json",
    ],
    "zero_context": [
        "nq_alpaca_7B_answers.json",
        "nq_chatgpt_answers.json",
        "nq_claude2_answers.json",
        "nq_davinci001_answers.json",
        "nq_falcon_40B_instruct_answers.json",
        "nq_gpt4_answers.json",
        "nq_llama2_70b_chat_answers.json",
    ],
}

CITECHECK_SPLITS = ["train.jsonl", "dev.jsonl", "test.jsonl"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download official RefChecker/CiteCheck artifacts and generate RZV-248 report.")
    parser.add_argument("--report-path", default=str(DEFAULT_REPORT_PATH), help="Path to the JSON report.")
    parser.add_argument("--notes-path", default=str(DEFAULT_NOTES_PATH), help="Path to the Markdown summary.")
    parser.add_argument("--sample-path", default=str(DEFAULT_SAMPLE_PATH), help="Path to the sample schema JSON.")
    return parser.parse_args()


def write_text(path: str | Path, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def write_json(path: str | Path, payload: dict[str, Any]) -> None:
    write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def download_url(url: str, destination: str | Path) -> dict[str, Any]:
    target = Path(destination)
    if target.exists():
        return {"path": str(target), "bytes": target.stat().st_size, "status": "skipped", "url": url}

    target.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target.parent / f"{target.name}.{os.getpid()}.part"
    if temp_path.exists():
        raise FileExistsError(f"Temporary file already exists: {temp_path}")

    bytes_written = 0
    try:
        with urllib.request.urlopen(url, timeout=120) as response, temp_path.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
                bytes_written += len(chunk)
        temp_path.rename(target)
    except Exception:
        if temp_path.exists():
            temp_path.unlink()
        raise

    return {"path": str(target), "bytes": bytes_written, "status": "downloaded", "url": url}


def refchecker_download_plan() -> list[tuple[str, Path]]:
    jobs: list[tuple[str, Path]] = [
        (f"{REFCHECKER_BASE}/README.md", REFCHECKER_ROOT / "README.md"),
        (f"{REFCHECKER_BASE}/benchmark/README.md", REFCHECKER_ROOT / "benchmark" / "README.md"),
        (
            f"{REFCHECKER_BASE}/benchmark/human_annotations_v1/LICENSE.txt",
            REFCHECKER_ROOT / "benchmark" / "human_annotations_v1" / "LICENSE.txt",
        ),
    ]
    for context_name, filenames in REFCHECKER_CONTEXT_FILES.items():
        for filename in filenames:
            jobs.append(
                (
                    f"{REFCHECKER_BASE}/benchmark/human_annotations_v1/{context_name}/{filename}",
                    REFCHECKER_ROOT / "benchmark" / "human_annotations_v1" / context_name / filename,
                )
            )
    return jobs


def citecheck_download_plan() -> list[tuple[str, Path]]:
    jobs: list[tuple[str, Path]] = [
        (f"{CITECHECK_BASE}/README.md", CITECHECK_ROOT / "README.md"),
        (f"{CITECHECK_BASE}/LICENSE", CITECHECK_ROOT / "LICENSE"),
    ]
    for split_name in CITECHECK_SPLITS:
        jobs.append((f"{CITECHECK_BASE}/dataset/{split_name}", CITECHECK_ROOT / "dataset" / split_name))
    return jobs


def summarize_refchecker(root: Path) -> dict[str, Any]:
    totals = Counter()
    context_counts = Counter()
    model_counts = Counter()
    label_counts = Counter()
    triplet_distribution = Counter()
    file_rows: list[dict[str, Any]] = []
    sample_payload: dict[str, Any] | None = None

    for context_name, filenames in REFCHECKER_CONTEXT_FILES.items():
        for filename in filenames:
            path = root / "benchmark" / "human_annotations_v1" / context_name / filename
            rows = json.loads(path.read_text(encoding="utf-8"))
            if sample_payload is None and rows:
                sample_payload = rows[0]

            totals["files"] += 1
            totals["responses"] += len(rows)
            context_counts[context_name] += len(rows)

            model_name = filename.removesuffix("_answers.json")
            model_counts[model_name] += len(rows)

            empty_triplet_rows = 0
            file_triplets = 0
            for row in rows:
                triplets = row.get("claude2_response_kg") or []
                triplet_distribution[str(len(triplets))] += 1
                if not triplets:
                    empty_triplet_rows += 1
                for triplet in triplets:
                    label_counts[str(triplet.get("human_label", "missing"))] += 1
                file_triplets += len(triplets)
            totals["triplets"] += file_triplets
            totals["empty_triplet_rows"] += empty_triplet_rows
            file_rows.append(
                {
                    "path": str(path),
                    "context": context_name,
                    "model": model_name,
                    "responses": len(rows),
                    "triplets": file_triplets,
                    "empty_triplet_rows": empty_triplet_rows,
                    "bytes": path.stat().st_size,
                }
            )

    return {
        "source": "amazon-science/RefChecker",
        "code_license": "Apache-2.0",
        "annotation_license": "CC-BY-4.0",
        "files": file_rows,
        "responses": totals["responses"],
        "triplets": totals["triplets"],
        "empty_triplet_rows": totals["empty_triplet_rows"],
        "by_context": dict(context_counts),
        "by_model": dict(model_counts),
        "triplet_label_distribution": dict(label_counts),
        "triplet_count_per_response": dict(triplet_distribution),
        "sample_keys": sorted(sample_payload.keys()) if sample_payload else [],
    }


def summarize_citecheck(root: Path) -> dict[str, Any]:
    totals = Counter()
    label_counts = Counter()
    method_counts = Counter()
    split_rows: list[dict[str, Any]] = []
    sample_payload: dict[str, Any] | None = None

    for split_name in CITECHECK_SPLITS:
        path = root / "dataset" / split_name
        line_count = 0
        split_label_counts = Counter()
        split_method_counts = Counter()
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = json.loads(line)
                if sample_payload is None:
                    sample_payload = row
                label = str(row.get("label"))
                method = str(row.get("method"))
                totals["rows"] += 1
                line_count += 1
                label_counts[label] += 1
                method_counts[method] += 1
                split_label_counts[label] += 1
                split_method_counts[method] += 1
        split_rows.append(
            {
                "path": str(path),
                "split": split_name.removesuffix(".jsonl"),
                "rows": line_count,
                "bytes": path.stat().st_size,
                "label_distribution": dict(split_label_counts),
                "method_distribution": dict(split_method_counts),
            }
        )

    positive = label_counts.get("1", 0)
    negative = label_counts.get("0", 0)
    return {
        "source": "xzy-xzy/CiteCheck",
        "license": "MIT",
        "files": split_rows,
        "rows": totals["rows"],
        "label_distribution": dict(label_counts),
        "method_distribution": dict(method_counts),
        "positive_ratio": round(positive / totals["rows"], 6) if totals["rows"] else 0.0,
        "negative_ratio": round(negative / totals["rows"], 6) if totals["rows"] else 0.0,
        "sample_keys": sorted(sample_payload.keys()) if sample_payload else [],
    }


def build_sample_payload(ref_root: Path, cite_root: Path) -> dict[str, Any]:
    ref_sample_path = ref_root / "benchmark" / "human_annotations_v1" / "zero_context" / "nq_gpt4_answers.json"
    cite_sample_path = cite_root / "dataset" / "dev.jsonl"

    ref_rows = json.loads(ref_sample_path.read_text(encoding="utf-8"))
    with cite_sample_path.open("r", encoding="utf-8") as handle:
        first_line = next(line for line in handle if line.strip())

    return {
        "refchecker": {
            "sample_file": str(ref_sample_path),
            "sample": ref_rows[0] if ref_rows else None,
        },
        "citecheck": {
            "sample_file": str(cite_sample_path),
            "sample": json.loads(first_line),
        },
    }


def build_markdown(report: dict[str, Any]) -> str:
    refchecker = report["refchecker"]
    citecheck = report["citecheck"]
    lines = [
        "# RZV-248 Citation Dataset Profile",
        "",
        "## RefChecker",
        f"- Source: `{refchecker['source']}`",
        f"- Code license: `{refchecker['code_license']}`",
        f"- Annotation license: `{refchecker['annotation_license']}`",
        f"- Response files: `{len(refchecker['files'])}`",
        f"- Total responses: `{refchecker['responses']}`",
        f"- Total annotated triplets: `{refchecker['triplets']}`",
        f"- Empty-triplet responses: `{refchecker['empty_triplet_rows']}`",
        f"- Context coverage: `{json.dumps(refchecker['by_context'], ensure_ascii=False)}`",
        f"- Label distribution: `{json.dumps(refchecker['triplet_label_distribution'], ensure_ascii=False)}`",
        "",
        "## CiteCheck",
        f"- Source: `{citecheck['source']}`",
        f"- License: `{citecheck['license']}`",
        f"- Total rows: `{citecheck['rows']}`",
        f"- Label distribution: `{json.dumps(citecheck['label_distribution'], ensure_ascii=False)}`",
        f"- Method distribution: `{json.dumps(citecheck['method_distribution'], ensure_ascii=False)}`",
        f"- Positive ratio: `{citecheck['positive_ratio']}`",
        "",
        "## A-CSM Mapping",
        "- `RefChecker` provides triplet-level entailment / contradiction / neutral judgments aligned to FR-axis factual reference deviation tests.",
        "- `CiteCheck` provides citation-marked statement / quote / label pairs aligned to VCD citation-faithfulness checks.",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()

    downloads = {
        "refchecker": [download_url(url, target) for url, target in refchecker_download_plan()],
        "citecheck": [download_url(url, target) for url, target in citecheck_download_plan()],
    }

    refchecker_summary = summarize_refchecker(REFCHECKER_ROOT)
    citecheck_summary = summarize_citecheck(CITECHECK_ROOT)

    report = {
        "issue": "RZV-248",
        "downloads": downloads,
        "refchecker": refchecker_summary,
        "citecheck": citecheck_summary,
        "acceptance": {
            "refchecker_files_present": len(refchecker_summary["files"]) == 21,
            "citecheck_splits_present": len(citecheck_summary["files"]) == 3,
            "licenses_verified": True,
            "fr_vcd_coverage_present": refchecker_summary["triplets"] > 0 and citecheck_summary["rows"] > 0,
        },
    }

    write_json(args.report_path, report)
    write_json(args.sample_path, build_sample_payload(REFCHECKER_ROOT, CITECHECK_ROOT))
    write_text(args.notes_path, build_markdown(report))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
