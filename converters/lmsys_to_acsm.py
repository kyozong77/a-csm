from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    import sys

    sys.path.append(str(Path(__file__).resolve().parents[1]))

from converters._acsm_common import build_record, build_turns, convert_file, write_json


def convert_lmsys_row(row: dict[str, Any]) -> dict[str, Any]:
    conversation = row.get("conversation")
    if not isinstance(conversation, list):
        raise ValueError("LMSYS row requires list `conversation`.")
    turns = build_turns(conversation)
    meta = {
        "source": "lmsys",
        "conversation_id": row.get("conversation_id"),
        "model": row.get("model"),
        "turn": row.get("turn"),
        "language": row.get("language"),
        "redacted": row.get("redacted"),
        "openai_moderation": row.get("openai_moderation"),
    }
    return build_record(turns, meta)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert LMSYS conversations into A-CSM JSONL.")
    parser.add_argument("--input-path", required=True, help="Path to LMSYS parquet/json/jsonl input.")
    parser.add_argument("--output-path", required=True, help="Path to converted A-CSM JSONL output.")
    parser.add_argument("--report-path", help="Optional JSON report output path.")
    parser.add_argument("--limit", type=int, default=None, help="Maximum converted records to write.")
    parser.add_argument("--batch-size", type=int, default=128, help="Parquet batch size.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = convert_file(
        input_path=args.input_path,
        output_path=args.output_path,
        converter=convert_lmsys_row,
        limit=args.limit,
        batch_size=args.batch_size,
    )
    report["converter"] = "lmsys_to_acsm"
    if args.report_path:
        write_json(args.report_path, report)


if __name__ == "__main__":
    main()
