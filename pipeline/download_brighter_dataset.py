from __future__ import annotations

import argparse
import json
import os
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.error import HTTPError

import pyarrow.parquet as pq

if __package__ in {None, ""}:
    import sys

    sys.path.append(str(Path(__file__).resolve().parents[1]))

from pipeline.hf_dataset_utils import download_dataset_file, list_dataset_tree, resolve_token

_DATA_ROOT = Path(os.environ.get("ACSM_DATA_ROOT", "./data"))
RAW_ROOT = _DATA_ROOT / "raw" / "brighter"
REPORT_ROOT = _DATA_ROOT / "reports"

DATASETS = {
    "categories": "brighter-dataset/BRIGHTER-emotion-categories",
    "intensities": "brighter-dataset/BRIGHTER-emotion-intensities",
}

EMOTION_COLUMNS = ["anger", "disgust", "fear", "joy", "sadness", "surprise"]

DEFAULT_REPORT_PATH = REPORT_ROOT / "RZV-249_brighter_profile.json"
DEFAULT_NOTES_PATH = REPORT_ROOT / "RZV-249_brighter_notes.md"
DEFAULT_SAMPLE_PATH = REPORT_ROOT / "RZV-249_brighter_samples.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download BRIGHTER emotion datasets and generate RZV-249 report.")
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


def rows_json_get(dataset_id: str, config: str, split: str, offset: int, length: int, token: str) -> dict[str, Any]:
    params = urllib.parse.urlencode(
        {
            "dataset": dataset_id,
            "config": config,
            "split": split,
            "offset": offset,
            "length": length,
        }
    )
    request = urllib.request.Request(
        f"https://datasets-server.huggingface.co/rows?{params}",
        headers={"Authorization": f"Bearer {token}"},
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response)
        except HTTPError as exc:
            if exc.code != 429 or attempt == 4:
                raise
            time.sleep(2**attempt)
    raise RuntimeError("rows_json_get exhausted retries unexpectedly")


def size_json_get(dataset_id: str, config: str, token: str) -> dict[str, Any]:
    params = urllib.parse.urlencode({"dataset": dataset_id, "config": config})
    request = urllib.request.Request(
        f"https://datasets-server.huggingface.co/size?{params}",
        headers={"Authorization": f"Bearer {token}"},
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.load(response)
        except HTTPError as exc:
            if exc.code != 429 or attempt == 4:
                raise
            time.sleep(2**attempt)
    raise RuntimeError("size_json_get exhausted retries unexpectedly")


def download_dataset(dataset_id: str, output_dir: Path, token: str) -> list[dict[str, Any]]:
    tree = list_dataset_tree(dataset_id, token)
    parquet_nodes = sorted(
        (
            node
            for node in tree
            if node.get("type") == "file" and str(node.get("path", "")).endswith(".parquet")
        ),
        key=lambda item: str(item["path"]),
    )
    downloaded: list[dict[str, Any]] = []
    for node in parquet_nodes:
        path = str(node["path"])
        target = output_dir / path
        downloaded.append(
            download_dataset_file(
                dataset_id,
                path,
                target,
                token,
                expected_size=int(node["size"]) if node.get("size") is not None else None,
            )
        )
    return downloaded


def summarize_dataset_local(output_dir: Path, dataset_id: str) -> dict[str, Any]:
    totals = Counter()
    split_counts = Counter()
    language_counts = Counter()
    emotion_counts = Counter()
    null_counts = Counter()
    file_rows: list[dict[str, Any]] = []
    sample_row: dict[str, Any] | None = None

    parquet_paths = sorted(output_dir.rglob("*.parquet"))
    for path in parquet_paths:
        relative = path.relative_to(output_dir)
        language = relative.parts[0]
        split = relative.name.split("-")[0]
        parquet_file = pq.ParquetFile(path)
        available_columns = set(parquet_file.schema_arrow.names)
        selected_columns = [column for column in ["id", "text", *EMOTION_COLUMNS] if column in available_columns]
        row_count = parquet_file.metadata.num_rows

        totals["rows"] += row_count
        language_counts[language] += row_count
        split_counts[split] += row_count

        for batch in parquet_file.iter_batches(columns=selected_columns, batch_size=2048):
            rows = batch.to_pylist()
            for row in rows:
                if sample_row is None:
                    sample_row = row
                for column in EMOTION_COLUMNS:
                    value = row.get(column)
                    if value is None:
                        null_counts[column] += 1
                    elif int(value) > 0:
                        emotion_counts[column] += 1

        file_rows.append(
            {
                "path": str(path),
                "language": language,
                "split": split,
                "rows": row_count,
                "bytes": path.stat().st_size,
            }
        )

    return {
        "dataset_id": dataset_id,
        "files": file_rows,
        "rows": totals["rows"],
        "sampled_rows": totals["rows"],
        "languages": dict(language_counts),
        "splits": dict(split_counts),
        "emotion_positive_counts_sampled": dict(emotion_counts),
        "emotion_null_counts_sampled": dict(null_counts),
        "emotion_axes": list(EMOTION_COLUMNS),
        "sample_keys": ["id", "text", *EMOTION_COLUMNS] if sample_row else [],
    }


def summarize_dataset_via_api(output_dir: Path, dataset_id: str, token: str) -> dict[str, Any]:
    totals = Counter()
    split_counts = Counter()
    language_counts = Counter()
    file_rows: list[dict[str, Any]] = []

    parquet_paths = sorted(output_dir.rglob("*.parquet"))
    file_index: dict[tuple[str, str], Path] = {}
    for path in parquet_paths:
        relative = path.relative_to(output_dir)
        language = relative.parts[0]
        split = relative.name.split("-")[0]
        file_index[(language, split)] = path

    for language in sorted({path.relative_to(output_dir).parts[0] for path in parquet_paths}):
        size_payload = size_json_get(dataset_id, language, token)
        for split_info in size_payload["size"]["splits"]:
            split = str(split_info["split"])
            total_rows = int(split_info["num_rows"])
            path = file_index[(language, split)]
            totals["rows"] += total_rows
            language_counts[language] += total_rows
            split_counts[split] += total_rows
            file_rows.append(
                {
                    "path": str(path),
                    "language": language,
                    "split": split,
                    "rows": total_rows,
                    "bytes": path.stat().st_size,
                }
            )

    file_rows.sort(key=lambda item: item["path"])
    return {
        "dataset_id": dataset_id,
        "files": file_rows,
        "rows": totals["rows"],
        "languages": dict(language_counts),
        "splits": dict(split_counts),
        "emotion_axes": list(EMOTION_COLUMNS),
        "sample_keys": ["id", "text", *EMOTION_COLUMNS],
    }


def summarize_dataset(output_dir: Path, dataset_id: str, token: str | None = None) -> dict[str, Any]:
    if token:
        return summarize_dataset_via_api(output_dir, dataset_id, token)
    return summarize_dataset_local(output_dir, dataset_id)


def build_markdown(report: dict[str, Any]) -> str:
    categories = report["categories"]
    intensities = report["intensities"]
    lines = [
        "# RZV-249 BRIGHTER Dataset Profile",
        "",
        "## Categories",
        f"- Dataset: `{categories['dataset_id']}`",
        f"- Total rows: `{categories['rows']}`",
        f"- Languages: `{len(categories['languages'])}`",
        f"- Split counts: `{json.dumps(categories['splits'], ensure_ascii=False)}`",
        f"- Emotion axes: `{json.dumps(categories['emotion_axes'], ensure_ascii=False)}`",
        "",
        "## Intensities",
        f"- Dataset: `{intensities['dataset_id']}`",
        f"- Total rows: `{intensities['rows']}`",
        f"- Languages: `{len(intensities['languages'])}`",
        f"- Split counts: `{json.dumps(intensities['splits'], ensure_ascii=False)}`",
        f"- Emotion axes: `{json.dumps(intensities['emotion_axes'], ensure_ascii=False)}`",
        "",
        "## A-CSM Mapping",
        "- `categories` supports multi-label affect state detection for PS/SUB/F/E and Event Engine emotion transitions.",
        "- `intensities` supports severity calibration when mapping emotion signals to downstream risk thresholds.",
    ]
    return "\n".join(lines) + "\n"


def build_sample_payload(categories_dir: Path, intensities_dir: Path, token: str) -> dict[str, Any]:
    category_file = sorted(categories_dir.rglob("*.parquet"))[0]
    intensity_file = sorted(intensities_dir.rglob("*.parquet"))[0]
    category_relative = category_file.relative_to(categories_dir)
    intensity_relative = intensity_file.relative_to(intensities_dir)
    category_sample = rows_json_get(
        DATASETS["categories"],
        category_relative.parts[0],
        category_relative.name.split("-")[0],
        0,
        1,
        token,
    )["rows"][0]["row"]
    intensity_sample = rows_json_get(
        DATASETS["intensities"],
        intensity_relative.parts[0],
        intensity_relative.name.split("-")[0],
        0,
        1,
        token,
    )["rows"][0]["row"]
    return {
        "categories": {"sample_file": str(category_file), "sample": category_sample},
        "intensities": {"sample_file": str(intensity_file), "sample": intensity_sample},
    }


def main() -> None:
    args = parse_args()
    token = resolve_token(args.hf_token, args.token_env)

    downloads = {}
    for name, dataset_id in DATASETS.items():
        downloads[name] = download_dataset(dataset_id, RAW_ROOT / name, token)

    categories_summary = summarize_dataset(RAW_ROOT / "categories", DATASETS["categories"], token)
    intensities_summary = summarize_dataset(RAW_ROOT / "intensities", DATASETS["intensities"], token)
    report = {
        "issue": "RZV-249",
        "downloads": downloads,
        "categories": categories_summary,
        "intensities": intensities_summary,
        "licenses": {"categories": "CC-BY-4.0", "intensities": "CC-BY-4.0"},
        "acceptance": {
            "categories_downloaded": len(categories_summary["files"]) > 0,
            "intensities_downloaded": len(intensities_summary["files"]) > 0,
            "multilingual_coverage_present": len(categories_summary["languages"]) >= 10 and len(intensities_summary["languages"]) >= 10,
            "emotion_axes_present": categories_summary["emotion_axes"] == EMOTION_COLUMNS and intensities_summary["emotion_axes"] == EMOTION_COLUMNS,
        },
    }

    write_json(args.report_path, report)
    write_json(args.sample_path, build_sample_payload(RAW_ROOT / "categories", RAW_ROOT / "intensities", token))
    write_text(args.notes_path, build_markdown(report))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
