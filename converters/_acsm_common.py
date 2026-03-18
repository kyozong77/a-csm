from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator

import pyarrow.parquet as pq

ROLE_MAP = {
    "assistant": "assistant",
    "ai": "assistant",
    "gpt": "assistant",
    "human": "user",
    "system": "system",
    "user": "user",
}
SOURCE_TRUST_MAP = {
    "assistant": "untrusted",
    "system": "unknown",
    "user": "trusted",
}
ALLOWED_SOURCE_TRUST = {"trusted", "unknown", "untrusted"}
JSONL_SUFFIXES = {".jsonl", ".ndjson"}


def normalize_role(raw_role: Any) -> str:
    if not isinstance(raw_role, str):
        raise ValueError(f"Role must be a string, got {type(raw_role).__name__}.")
    normalized = raw_role.strip().lower()
    if normalized not in ROLE_MAP:
        raise ValueError(f"Unsupported role value: {raw_role!r}.")
    return ROLE_MAP[normalized]


def normalize_text(raw_text: Any) -> str | None:
    if raw_text is None:
        return None
    if not isinstance(raw_text, str):
        raise ValueError(f"Text must be a string, got {type(raw_text).__name__}.")
    text = raw_text.strip()
    return text or None


def build_turns(messages: Iterable[dict[str, Any]], *, boundary_bypass: bool = False) -> list[dict[str, Any]]:
    turns: list[dict[str, Any]] = []
    for message in messages:
        if not isinstance(message, dict):
            raise ValueError(f"Conversation item must be an object, got {type(message).__name__}.")
        role = normalize_role(message.get("role", message.get("from")))
        text = normalize_text(message.get("content", message.get("value", message.get("text"))))
        if text is None:
            continue
        turns.append(
            {
                "id": f"T{len(turns) + 1:03d}",
                "role": role,
                "sourceTrust": SOURCE_TRUST_MAP[role],
                "boundaryBypass": bool(boundary_bypass),
                "text": text,
            }
        )
    if not turns:
        raise ValueError("Conversation does not contain any non-empty turns.")
    return turns


def validate_acsm_record(record: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    turns = record.get("turns")
    if not isinstance(turns, list) or not turns:
        errors.append("`turns` must be a non-empty list.")
        return errors
    for index, turn in enumerate(turns):
        if not isinstance(turn, dict):
            errors.append(f"Turn {index} must be an object.")
            continue
        if not isinstance(turn.get("id"), str) or not turn["id"].strip():
            errors.append(f"Turn {index} requires non-empty string `id`.")
        if turn.get("role") not in {"user", "assistant", "system"}:
            errors.append(f"Turn {index} has invalid `role`.")
        if turn.get("sourceTrust") not in ALLOWED_SOURCE_TRUST:
            errors.append(f"Turn {index} has invalid `sourceTrust`.")
        if not isinstance(turn.get("boundaryBypass"), bool):
            errors.append(f"Turn {index} has non-bool `boundaryBypass`.")
        text = turn.get("text")
        if not isinstance(text, str) or not text.strip():
            errors.append(f"Turn {index} requires non-empty string `text`.")
    validation = record.get("validation")
    if not isinstance(validation, dict) or not isinstance(validation.get("readiness"), bool):
        errors.append("`validation.readiness` must be a boolean.")
    return errors


def build_record(turns: list[dict[str, Any]], meta: dict[str, Any] | None = None) -> dict[str, Any]:
    record: dict[str, Any] = {
        "turns": turns,
        "validation": {"readiness": True},
    }
    if meta:
        record["_meta"] = meta
    errors = validate_acsm_record(record)
    if errors:
        raise ValueError("; ".join(errors))
    return record


def to_jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_jsonable(item) for item in value]
    if isinstance(value, tuple):
        return [to_jsonable(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, "isoformat") and callable(value.isoformat):
        return value.isoformat()
    return value


def iter_input_records(input_path: str | Path, *, batch_size: int = 128) -> Iterator[dict[str, Any]]:
    path = Path(input_path)
    suffix = path.suffix.lower()
    if suffix == ".parquet":
        parquet_file = pq.ParquetFile(path)
        for batch in parquet_file.iter_batches(batch_size=batch_size):
            yield from batch.to_pylist()
        return
    if suffix in JSONL_SUFFIXES:
        with path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                payload = line.strip()
                if not payload:
                    continue
                try:
                    row = json.loads(payload)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"Invalid JSONL at line {line_number}: {exc}") from exc
                if not isinstance(row, dict):
                    raise ValueError(f"JSONL line {line_number} must decode to an object.")
                yield row
        return
    if suffix == ".json":
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if isinstance(payload, list):
            for row in payload:
                if not isinstance(row, dict):
                    raise ValueError("JSON array items must be objects.")
                yield row
            return
        if isinstance(payload, dict):
            for key in ("rows", "data", "items"):
                if isinstance(payload.get(key), list):
                    for row in payload[key]:
                        if not isinstance(row, dict):
                            raise ValueError(f"JSON payload key `{key}` must contain objects.")
                        yield row
                    return
            yield payload
            return
    raise ValueError(f"Unsupported input format for {path}. Expected parquet/json/jsonl.")


def convert_file(
    *,
    input_path: str | Path,
    output_path: str | Path,
    converter: Callable[[dict[str, Any]], dict[str, Any]],
    limit: int | None = None,
    batch_size: int = 128,
) -> dict[str, Any]:
    input_path = Path(input_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    report: dict[str, Any] = {
        "input_path": str(input_path),
        "output_path": str(output_path),
        "records_seen": 0,
        "records_written": 0,
        "error_count": 0,
        "errors": [],
        "limit": limit,
        "batch_size": batch_size,
    }

    with output_path.open("w", encoding="utf-8") as handle:
        for record in iter_input_records(input_path, batch_size=batch_size):
            if limit is not None and report["records_written"] >= limit:
                break
            report["records_seen"] += 1
            try:
                converted = converter(record)
            except Exception as exc:  # noqa: BLE001
                report["error_count"] += 1
                if len(report["errors"]) < 10:
                    report["errors"].append(str(exc))
                continue
            handle.write(json.dumps(to_jsonable(converted), ensure_ascii=False) + "\n")
            report["records_written"] += 1

    return report


def write_json(path: str | Path, payload: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(to_jsonable(payload), ensure_ascii=False, indent=2), encoding="utf-8")
