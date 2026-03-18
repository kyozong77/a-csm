from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

if __package__ in {None, ""}:
    import sys

    sys.path.append(str(Path(__file__).resolve().parents[1]))

from pipeline.hf_dataset_utils import download_dataset_file, list_dataset_tree, resolve_token

_DATA_ROOT = Path(os.environ.get("ACSM_DATA_ROOT", "./data"))
DATASET_ID = "allenai/wildguardmix"
DEFAULT_OUTPUT_DIR = _DATA_ROOT / "raw" / "wildguardmix" / "original"
DEFAULT_SPLIT_DIR = _DATA_ROOT / "raw" / "wildguardmix" / "splits"
DEFAULT_REPORT_PATH = _DATA_ROOT / "reports" / "RZV-235_download_report.json"
REQUIRED_COLUMNS = [
    "prompt",
    "response",
    "adversarial",
    "prompt_harm_label",
    "response_refusal_label",
    "response_harm_label",
]
SAFE_LABELS = {"safe", "unharmful", "benign", "null", "unknown"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download WildGuardMix and derive vanilla/adversarial parquet subsets.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for raw WildGuardMix parquet files.")
    parser.add_argument("--split-dir", default=str(DEFAULT_SPLIT_DIR), help="Directory for derived subset parquet files.")
    parser.add_argument("--report-path", default=str(DEFAULT_REPORT_PATH), help="Path to the JSON report.")
    parser.add_argument("--hf-token", default=None, help="Optional Hugging Face token. Falls back to HF_TOKEN.")
    parser.add_argument("--token-env", default="HF_TOKEN", help="Environment variable used when --hf-token is omitted.")
    return parser.parse_args()


def label_counter(values: list[Any]) -> dict[str, int]:
    counter = Counter()
    for value in values:
        key = str(value if value is not None else "null")
        counter[key] += 1
    return dict(sorted(counter.items()))


def build_tag_mapping_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    axis_counts = Counter()
    severity_counts = Counter()
    combined = Counter()

    for row in rows:
        prompt_harm = str(row.get("prompt_harm_label") or "unknown").lower()
        response_harm = str(row.get("response_harm_label") or "unknown").lower()
        refusal = str(row.get("response_refusal_label") or "unknown").lower()
        adversarial = bool(row.get("adversarial"))

        mappings: list[tuple[str, str]] = []
        prompt_safe = prompt_harm in SAFE_LABELS
        response_safe = response_harm in SAFE_LABELS

        if not prompt_safe or not response_safe:
            mappings.append(("TAG_SAF", "high"))
        else:
            mappings.append(("TAG_SAF", "low"))
        if adversarial:
            mappings.append(("TAG_CTX", "medium"))
        if refusal not in {"compliance", "non_refusal", "null", "unknown"}:
            mappings.append(("TAG_SYS", "low"))
        elif refusal in {"compliance", "non_refusal"} and (not prompt_safe or not response_safe):
            mappings.append(("TAG_SYS", "high"))

        for axis, severity in mappings:
            axis_counts[axis] += 1
            severity_counts[severity] += 1
            combined[f"{axis}:{severity}"] += 1

    return {
        "axis_counts": dict(sorted(axis_counts.items())),
        "severity_counts": dict(sorted(severity_counts.items())),
        "combined": dict(sorted(combined.items())),
    }


def write_json(path: str | Path, payload: dict[str, Any]) -> None:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    token = resolve_token(args.hf_token, args.token_env)
    output_dir = Path(args.output_dir)
    split_dir = Path(args.split_dir)
    tree = list_dataset_tree(DATASET_ID, token)
    parquet_nodes = sorted(
        (
            node
            for node in tree
            if node.get("type") == "file" and str(node.get("path", "")).endswith(".parquet")
        ),
        key=lambda item: str(item["path"]),
    )

    downloaded_files: list[dict[str, Any]] = []
    local_paths: list[Path] = []
    for node in parquet_nodes:
        target = output_dir / Path(str(node["path"]))
        downloaded_files.append(
            download_dataset_file(
                DATASET_ID,
                str(node["path"]),
                target,
                token,
                expected_size=int(node.get("size")) if node.get("size") is not None else None,
            )
        )
        local_paths.append(target)

    tables = [pq.read_table(path) for path in local_paths]
    table = pa.concat_tables(tables, promote_options="default")
    for column in REQUIRED_COLUMNS:
        if column not in table.column_names:
            raise ValueError(f"WildGuardMix table is missing required column: {column}")

    rows = table.to_pylist()
    total_rows = len(rows)
    vanilla_mask = pc.equal(table["adversarial"], pa.scalar(False))
    adversarial_mask = pc.equal(table["adversarial"], pa.scalar(True))
    vanilla_table = table.filter(vanilla_mask)
    adversarial_table = table.filter(adversarial_mask)

    split_dir.mkdir(parents=True, exist_ok=True)
    vanilla_path = split_dir / "wildguardmix_vanilla.parquet"
    adversarial_path = split_dir / "wildguardmix_adversarial.parquet"
    if not vanilla_path.exists():
        pq.write_table(vanilla_table, vanilla_path)
    else:
        vanilla_table = pq.read_table(vanilla_path)
    if not adversarial_path.exists():
        pq.write_table(adversarial_table, adversarial_path)
    else:
        adversarial_table = pq.read_table(adversarial_path)

    report = {
        "dataset_id": DATASET_ID,
        "total_rows": total_rows,
        "split_counts": {
            "vanilla": vanilla_table.num_rows,
            "adversarial": adversarial_table.num_rows,
        },
        "downloaded_files": downloaded_files,
        "paths": {
            "output_dir": str(output_dir),
            "split_dir": str(split_dir),
            "vanilla_path": str(vanilla_path),
            "adversarial_path": str(adversarial_path),
            "report_path": str(Path(args.report_path)),
        },
        "label_coverage": {
            "prompt_harm_label": label_counter([row.get("prompt_harm_label") for row in rows]),
            "response_harm_label": label_counter([row.get("response_harm_label") for row in rows]),
            "response_refusal_label": label_counter([row.get("response_refusal_label") for row in rows]),
            "subcategory": label_counter([row.get("subcategory") for row in rows]),
        },
        "tag_mapping_candidates": build_tag_mapping_summary(rows),
        "acceptance": {
            "download_complete": len(downloaded_files) == len(parquet_nodes),
            "vanilla_and_adversarial_split": vanilla_table.num_rows > 0 and adversarial_table.num_rows > 0,
            "tag_mapping_ready": True,
        },
    }
    write_json(args.report_path, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
