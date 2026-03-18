from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    import sys

    sys.path.append(str(Path(__file__).resolve().parents[1]))

from pipeline.hf_dataset_utils import download_dataset_file, list_dataset_tree, resolve_token

_DATA_ROOT = Path(os.environ.get("ACSM_DATA_ROOT", "./data"))
DATASET_ID = "AI-Secure/PolyGuard"
RAW_ROOT = _DATA_ROOT / "raw" / "polyguard" / "source"
REPORT_ROOT = _DATA_ROOT / "reports"

DEFAULT_REPORT_PATH = REPORT_ROOT / "RZV-250_polyguard_profile.json"
DEFAULT_NOTES_PATH = REPORT_ROOT / "RZV-250_polyguard_notes.md"
DEFAULT_SAMPLE_PATH = REPORT_ROOT / "RZV-250_polyguard_samples.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download PolyGuard dataset and generate RZV-250 profile.")
    parser.add_argument("--report-path", default=str(DEFAULT_REPORT_PATH), help="Path to the JSON report.")
    parser.add_argument("--notes-path", default=str(DEFAULT_NOTES_PATH), help="Path to the Markdown summary.")
    parser.add_argument("--sample-path", default=str(DEFAULT_SAMPLE_PATH), help="Path to the sample schema JSON.")
    parser.add_argument("--hf-token", default=None, help="Optional Hugging Face token. Falls back to HF_TOKEN.")
    parser.add_argument("--token-env", default="HF_TOKEN", help="Environment variable used when --hf-token is omitted.")
    return parser.parse_args()


def write_text(path: str | Path, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def write_json(path: str | Path, payload: dict[str, Any]) -> None:
    write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def classify_path(path: str) -> dict[str, str]:
    parts = path.split("/")
    top = parts[0]
    if top in {"finance", "law", "regulation"}:
        stage = parts[1].lower()
        source = parts[2]
        label = "safe" if parts[-1].endswith("_safe.jsonl") else "unsafe"
        return {"group": f"{top}_{stage}", "source": source, "label": label}
    if top in {"education", "hr", "social_media"}:
        source = parts[1]
        label = "safe" if parts[-1].endswith("_safe.jsonl") else "unsafe"
        return {"group": top, "source": source, "label": label}
    if top in {"code", "cyber"}:
        source = Path(parts[-1]).stem
        return {"group": top, "source": source, "label": "task"}
    return {"group": top, "source": "/".join(parts[1:-1]), "label": "other"}


def download_dataset(output_dir: Path, token: str) -> list[dict[str, Any]]:
    tree = list_dataset_tree(DATASET_ID, token)
    nodes = sorted(
        (
            node
            for node in tree
            if node.get("type") == "file" and str(node.get("path", "")).endswith(".jsonl")
        ),
        key=lambda item: str(item["path"]),
    )
    downloaded: list[dict[str, Any]] = []
    for node in nodes:
        path = str(node["path"])
        downloaded.append(
            download_dataset_file(
                DATASET_ID,
                path,
                output_dir / path,
                token,
                expected_size=int(node["size"]) if node.get("size") is not None else None,
            )
        )
    return downloaded


def summarize_dataset(output_dir: Path) -> dict[str, Any]:
    totals = Counter()
    group_counts = Counter()
    label_counts = Counter()
    source_counts = Counter()
    sample_keys_by_group: dict[str, list[str]] = {}
    file_rows: list[dict[str, Any]] = []

    for path in sorted(output_dir.rglob("*.jsonl")):
        relative = str(path.relative_to(output_dir))
        classification = classify_path(relative)
        row_count = 0
        sample_row: dict[str, Any] | None = None
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row_count += 1
                if sample_row is None:
                    sample_row = json.loads(line)

        totals["rows"] += row_count
        totals["files"] += 1
        group_counts[classification["group"]] += row_count
        label_counts[classification["label"]] += row_count
        source_counts[f"{classification['group']}::{classification['source']}"] += row_count
        if sample_row is not None and classification["group"] not in sample_keys_by_group:
            sample_keys_by_group[classification["group"]] = sorted(sample_row.keys())

        file_rows.append(
            {
                "path": str(path),
                "group": classification["group"],
                "source": classification["source"],
                "label": classification["label"],
                "rows": row_count,
                "bytes": path.stat().st_size,
            }
        )

    return {
        "dataset_id": DATASET_ID,
        "files": file_rows,
        "rows": totals["rows"],
        "groups": dict(group_counts),
        "labels": dict(label_counts),
        "sources": dict(source_counts),
        "sample_keys_by_group": sample_keys_by_group,
    }


def build_sample_payload(output_dir: Path) -> dict[str, Any]:
    preferred_groups = ["social_media", "finance_output", "code", "cyber", "regulation_output"]
    samples: dict[str, Any] = {}
    grouped_paths: dict[str, Path] = {}
    for path in sorted(output_dir.rglob("*.jsonl")):
        classification = classify_path(str(path.relative_to(output_dir)))
        grouped_paths.setdefault(classification["group"], path)

    for group in preferred_groups:
        path = grouped_paths.get(group)
        if path is None:
            continue
        with path.open("r", encoding="utf-8") as handle:
            first_line = next(line for line in handle if line.strip())
        samples[group] = {
            "sample_file": str(path),
            "sample": json.loads(first_line),
        }
    return samples


def build_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# RZV-250 PolyGuard Dataset Profile",
        "",
        f"- Dataset: `{report['dataset_id']}`",
        f"- Total rows: `{report['rows']}`",
        f"- Total files: `{len(report['files'])}`",
        f"- Group coverage: `{json.dumps(report['groups'], ensure_ascii=False)}`",
        f"- Label coverage: `{json.dumps(report['labels'], ensure_ascii=False)}`",
        "",
        "## A-CSM Mapping",
        "- `social_media / education / hr / finance / law / regulation` groups provide policy-grounded safe/unsafe pairs for Schema and TAG consistency checks.",
        "- `cyber` and `code` groups extend guardrail evaluation into high-risk operational domains relevant to SR/SA and adversarial policy bypass analysis.",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()
    token = resolve_token(args.hf_token, args.token_env)

    downloads = download_dataset(RAW_ROOT, token)
    summary = summarize_dataset(RAW_ROOT)
    report = {
        "issue": "RZV-250",
        **summary,
        "downloads": downloads,
        "license": "CC-BY-4.0",
        "acceptance": {
            "download_complete": len(summary["files"]) >= 100,
            "safe_unsafe_pairs_present": summary["labels"].get("safe", 0) > 0 and summary["labels"].get("unsafe", 0) > 0,
            "domain_groups_present": len(summary["groups"]) >= 6,
        },
    }

    write_json(args.report_path, report)
    write_json(args.sample_path, build_sample_payload(RAW_ROOT))
    write_text(args.notes_path, build_markdown(report))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
