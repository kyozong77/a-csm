from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq

if __package__ in {None, ""}:
    import sys

    sys.path.append(str(Path(__file__).resolve().parents[1]))

from pipeline.hf_dataset_utils import download_dataset_file, list_dataset_tree, resolve_token

_DATA_ROOT = Path(os.environ.get("ACSM_DATA_ROOT", "./data"))
DATASET_ID = "lmsys/lmsys-chat-1m"
DEFAULT_OUTPUT_DIR = _DATA_ROOT / "raw" / "lmsys" / "parquet"
DEFAULT_REPORT_PATH = _DATA_ROOT / "reports" / "RZV-231_download_report.json"
REQUIRED_COLUMNS = [
    "conversation_id",
    "model",
    "conversation",
    "turn",
    "language",
    "openai_moderation",
    "redacted",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download LMSYS-Chat-1M parquet shards and generate integrity stats.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for raw parquet shards.")
    parser.add_argument("--report-path", default=str(DEFAULT_REPORT_PATH), help="Path to the JSON report.")
    parser.add_argument("--hf-token", default=None, help="Optional Hugging Face token. Falls back to HF_TOKEN.")
    parser.add_argument("--token-env", default="HF_TOKEN", help="Environment variable used when --hf-token is omitted.")
    return parser.parse_args()


def conversation_has_content(conversation: Any) -> bool:
    if not isinstance(conversation, list) or not conversation:
        return False
    for turn in conversation:
        if isinstance(turn, dict) and str(turn.get("content", "")).strip():
            return True
    return False


def is_english(language: Any) -> bool:
    value = str(language or "").strip().lower()
    return value in {"en", "english"} or value.startswith("english")


def compute_stats(paths: list[Path]) -> dict[str, Any]:
    totals = Counter()
    missing_counts = Counter()
    file_rows: list[dict[str, Any]] = []

    for path in paths:
        parquet_file = pq.ParquetFile(path)
        schema_names = set(parquet_file.schema_arrow.names)
        missing_columns = [column for column in REQUIRED_COLUMNS if column not in schema_names]
        if missing_columns:
            raise ValueError(f"{path} is missing required columns: {missing_columns}")

        file_total_rows = parquet_file.metadata.num_rows
        file_valid_rows = 0
        file_english_rows = 0
        file_empty_rows = 0
        totals["total_rows"] += file_total_rows

        for batch in parquet_file.iter_batches(columns=REQUIRED_COLUMNS, batch_size=2048):
            rows = batch.to_pylist()
            for row in rows:
                for column in REQUIRED_COLUMNS:
                    value = row.get(column)
                    if value is None or (isinstance(value, str) and not value.strip()):
                        missing_counts[column] += 1
                english = is_english(row.get("language"))
                has_content = conversation_has_content(row.get("conversation"))
                if english:
                    totals["english_rows"] += 1
                    file_english_rows += 1
                if not has_content:
                    totals["empty_conversation_rows"] += 1
                    file_empty_rows += 1
                if english and has_content:
                    totals["valid_rows"] += 1
                    file_valid_rows += 1

        file_rows.append(
            {
                "path": str(path),
                "bytes": path.stat().st_size,
                "rows": file_total_rows,
                "english_rows": file_english_rows,
                "valid_rows": file_valid_rows,
                "empty_conversation_rows": file_empty_rows,
            }
        )

    totals["non_english_rows"] = totals["total_rows"] - totals["english_rows"]
    field_integrity = {
        column: {
            "missing_rows": missing_counts[column],
            "completeness_ratio": round(1 - (missing_counts[column] / totals["total_rows"]), 6),
        }
        for column in REQUIRED_COLUMNS
    }
    return {
        "dataset_id": DATASET_ID,
        "total_rows": totals["total_rows"],
        "english_rows": totals["english_rows"],
        "non_english_rows": totals["non_english_rows"],
        "empty_conversation_rows": totals["empty_conversation_rows"],
        "valid_rows": totals["valid_rows"],
        "file_rows": file_rows,
        "field_integrity": field_integrity,
        "acceptance": {
            "download_complete": len(paths) == 6,
            "valid_rows_gte_500k": totals["valid_rows"] >= 500_000,
            "required_columns_present": all(details["missing_rows"] == 0 for details in field_integrity.values()),
        },
    }


def write_json(path: str | Path, payload: dict[str, Any]) -> None:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    token = resolve_token(args.hf_token, args.token_env)
    output_dir = Path(args.output_dir)
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
        target = output_dir / Path(str(node["path"])).name
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

    report = compute_stats(local_paths)
    report["downloaded_files"] = downloaded_files
    report["output_dir"] = str(output_dir)
    report["report_path"] = str(Path(args.report_path))
    write_json(args.report_path, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
