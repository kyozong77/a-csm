from __future__ import annotations

import argparse
import json
from json import JSONDecodeError, JSONDecoder
from pathlib import Path
from typing import Any, Iterator

import pyarrow.parquet as pq

if __package__ in {None, ""}:
    import sys

    sys.path.append(str(Path(__file__).resolve().parents[1]))

from converters._acsm_common import JSONL_SUFFIXES, build_record, build_turns, to_jsonable, write_json

SUPPORTED_INPUT_FORMATS = {"auto", "sharegpt", "safedialbench", "wildguardmix"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert ShareGPT-family datasets into A-CSM JSONL.")
    parser.add_argument("--input-path", required=True, help="Path to ShareGPT-family json/jsonl input.")
    parser.add_argument("--output-path", required=True, help="Path to converted A-CSM JSONL output.")
    parser.add_argument("--report-path", required=True, help="Path to JSON report output.")
    parser.add_argument(
        "--input-format",
        default="auto",
        choices=sorted(SUPPORTED_INPUT_FORMATS),
        help="Override auto detection for known dataset shapes.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Maximum converted records to write.")
    parser.add_argument("--chunk-size", type=int, default=65536, help="Streaming chunk size for JSON array input.")
    return parser.parse_args()


def iter_jsonl_rows(path: Path) -> Iterator[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            payload = line.strip()
            if not payload:
                continue
            try:
                row = json.loads(payload)
            except JSONDecodeError as exc:
                raise ValueError(f"Invalid JSONL at line {line_number}: {exc}") from exc
            if not isinstance(row, dict):
                raise ValueError(f"JSONL line {line_number} must decode to an object.")
            yield row


def iter_json_array_rows(path: Path, chunk_size: int) -> Iterator[dict[str, Any]]:
    decoder = JSONDecoder()
    buffer = ""
    started = False
    with path.open("r", encoding="utf-8") as handle:
        while True:
            chunk = handle.read(chunk_size)
            eof = chunk == ""
            buffer += chunk
            if not started:
                buffer = buffer.lstrip()
                if not buffer and not eof:
                    continue
                if not buffer.startswith("["):
                    raise ValueError("JSON input must be a top-level array for streaming mode.")
                buffer = buffer[1:]
                started = True
            while True:
                buffer = buffer.lstrip()
                if buffer.startswith("]"):
                    return
                if not buffer:
                    break
                try:
                    row, index = decoder.raw_decode(buffer)
                except JSONDecodeError as exc:
                    if eof:
                        raise ValueError(f"Incomplete JSON array payload: {exc}") from exc
                    break
                if not isinstance(row, dict):
                    raise ValueError("JSON array items must be objects.")
                yield row
                buffer = buffer[index:].lstrip()
                if buffer.startswith(","):
                    buffer = buffer[1:]
                    continue
                if buffer.startswith("]"):
                    return
                if not buffer:
                    break
                raise ValueError("Malformed JSON array: expected ',' or ']'.")
            if eof:
                break
    raise ValueError("JSON array input terminated unexpectedly.")


def iter_input_rows(input_path: str | Path, *, chunk_size: int) -> Iterator[dict[str, Any]]:
    path = Path(input_path)
    suffix = path.suffix.lower()
    if suffix == ".parquet":
        parquet_file = pq.ParquetFile(path)
        for batch in parquet_file.iter_batches(batch_size=chunk_size):
            yield from batch.to_pylist()
        return
    if suffix in JSONL_SUFFIXES:
        yield from iter_jsonl_rows(path)
        return
    if suffix == ".json":
        yield from iter_json_array_rows(path, chunk_size)
        return
    raise ValueError(f"Unsupported input format for {path}. Expected parquet/json/jsonl.")


def detect_input_format(row: dict[str, Any], override: str) -> str:
    if override != "auto":
        return override
    if isinstance(row.get("conversations"), list):
        return "sharegpt"
    if isinstance(row.get("history"), list):
        return "safedialbench"
    if isinstance(row.get("prompt"), str):
        return "wildguardmix"
    raise ValueError("Unable to detect ShareGPT-family input format.")


def messages_from_sharegpt(row: dict[str, Any]) -> list[dict[str, Any]]:
    conversations = row.get("conversations")
    if not isinstance(conversations, list):
        raise ValueError("ShareGPT row requires list `conversations`.")
    return conversations


def messages_from_safedialbench(row: dict[str, Any]) -> list[dict[str, Any]]:
    history = row.get("history")
    if not isinstance(history, list):
        raise ValueError("SafeDialBench row requires list `history`.")
    messages: list[dict[str, Any]] = []
    for turn in history:
        if not isinstance(turn, dict):
            raise ValueError("SafeDialBench `history` items must be objects.")
        if turn.get("user") is not None:
            messages.append({"role": "user", "content": turn.get("user")})
        if turn.get("bot") is not None:
            messages.append({"role": "assistant", "content": turn.get("bot")})
    return messages


def messages_from_wildguardmix(row: dict[str, Any]) -> list[dict[str, Any]]:
    prompt = row.get("prompt")
    if not isinstance(prompt, str):
        raise ValueError("WildGuardMix row requires string `prompt`.")
    response = row.get("response")
    messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
    if response is not None:
        messages.append({"role": "assistant", "content": response})
    return messages


def extract_messages(row: dict[str, Any], input_format: str) -> list[dict[str, Any]]:
    if input_format == "sharegpt":
        return messages_from_sharegpt(row)
    if input_format == "safedialbench":
        return messages_from_safedialbench(row)
    if input_format == "wildguardmix":
        return messages_from_wildguardmix(row)
    raise ValueError(f"Unsupported input format: {input_format}.")


def build_meta(row: dict[str, Any], input_format: str) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "source": input_format,
        "input_format": input_format,
    }
    for key in (
        "id",
        "task",
        "method",
        "model_type",
        "scene",
        "language",
        "adversarial",
        "source_label",
        "prompt_harm_label",
        "response_harm_label",
        "prompt_harm_category",
        "response_harm_category",
    ):
        if row.get(key) is not None:
            meta[key] = row.get(key)
    return meta


def convert_sharegpt_row(row: dict[str, Any], *, input_format: str = "auto") -> dict[str, Any]:
    detected_format = detect_input_format(row, input_format)
    turns = build_turns(extract_messages(row, detected_format))
    return build_record(turns, build_meta(row, detected_format))


def convert_file(
    *,
    input_path: str | Path,
    output_path: str | Path,
    report_path: str | Path,
    input_format: str,
    limit: int | None,
    chunk_size: int,
) -> dict[str, Any]:
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    counts_by_format: dict[str, int] = {}
    max_turns = 0
    report: dict[str, Any] = {
        "input_path": str(input_path),
        "output_path": str(output_path),
        "records_seen": 0,
        "records_written": 0,
        "error_count": 0,
        "errors": [],
        "counts_by_format": counts_by_format,
        "max_turns": 0,
        "limit": limit,
        "chunk_size": chunk_size,
        "converter": "sharegpt_to_acsm",
    }

    with output_path.open("w", encoding="utf-8") as handle:
        for row in iter_input_rows(input_path, chunk_size=chunk_size):
            if limit is not None and report["records_written"] >= limit:
                break
            report["records_seen"] += 1
            try:
                converted = convert_sharegpt_row(row, input_format=input_format)
            except Exception as exc:  # noqa: BLE001
                report["error_count"] += 1
                if len(report["errors"]) < 10:
                    report["errors"].append(str(exc))
                continue
            detected_format = converted["_meta"]["input_format"]
            counts_by_format[detected_format] = counts_by_format.get(detected_format, 0) + 1
            max_turns = max(max_turns, len(converted["turns"]))
            handle.write(json.dumps(to_jsonable(converted), ensure_ascii=False) + "\n")
            report["records_written"] += 1

    report["max_turns"] = max_turns
    write_json(report_path, report)
    return report


def main() -> None:
    args = parse_args()
    convert_file(
        input_path=args.input_path,
        output_path=args.output_path,
        report_path=args.report_path,
        input_format=args.input_format,
        limit=args.limit,
        chunk_size=args.chunk_size,
    )


if __name__ == "__main__":
    main()
