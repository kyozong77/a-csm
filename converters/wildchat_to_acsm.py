from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    import sys

    sys.path.append(str(Path(__file__).resolve().parents[1]))

from converters._acsm_common import build_record, build_turns, convert_file, write_json


def _extract_client_context(conversation: list[dict[str, Any]]) -> dict[str, Any]:
    for message in conversation:
        if not isinstance(message, dict):
            continue
        if message.get("role") != "user":
            continue
        context = {
            "country": message.get("country"),
            "state": message.get("state"),
            "hashed_ip": message.get("hashed_ip"),
            "header": message.get("header"),
            "language": message.get("language"),
            "redacted": message.get("redacted"),
            "toxic": message.get("toxic"),
            "timestamp": message.get("timestamp"),
            "turn_identifier": message.get("turn_identifier"),
        }
        return {key: value for key, value in context.items() if value is not None}
    return {}


def convert_wildchat_row(row: dict[str, Any]) -> dict[str, Any]:
    conversation = row.get("conversation")
    if not isinstance(conversation, list):
        raise ValueError("WildChat row requires list `conversation`.")
    turns = build_turns(conversation)
    meta = {
        "source": "wildchat",
        "conversation_hash": row.get("conversation_hash"),
        "model": row.get("model"),
        "timestamp": row.get("timestamp"),
        "turn": row.get("turn"),
        "language": row.get("language"),
        "toxic": row.get("toxic"),
        "redacted": row.get("redacted"),
        "country": row.get("country"),
        "state": row.get("state"),
        "openai_moderation": row.get("openai_moderation"),
        "detoxify_moderation": row.get("detoxify_moderation"),
        "client_context": _extract_client_context(conversation),
    }
    return build_record(turns, meta)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert WildChat conversations into A-CSM JSONL.")
    parser.add_argument("--input-path", required=True, help="Path to WildChat parquet/json/jsonl input.")
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
        converter=convert_wildchat_row,
        limit=args.limit,
        batch_size=args.batch_size,
    )
    report["converter"] = "wildchat_to_acsm"
    if args.report_path:
        write_json(args.report_path, report)


if __name__ == "__main__":
    main()
