from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

import yaml
from langdetect import DetectorFactory, LangDetectException, detect

DetectorFactory.seed = 0


@dataclass
class FilterDecision:
    bucket: str
    reason: str | None
    language: str
    digest: str | None
    record: dict[str, Any] | None
    pruned_turns: int
    pruned_reasons: Counter[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Filter A-CSM datasets for Phase 1 quality gates.")
    parser.add_argument("--config-path", required=True, help="Path to YAML config.")
    parser.add_argument("--report-path", required=True, help="Path to JSON report.")
    return parser.parse_args()


def load_config(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as handle:
        payload = yaml.safe_load(handle)
    if not isinstance(payload, dict):
        raise ValueError("Config must decode to an object.")
    return payload


def iter_jsonl_records(path: str | Path) -> Iterator[dict[str, Any]]:
    with Path(path).open("r", encoding="utf-8", errors="strict") as handle:
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


def normalize_language(label: str | None) -> str:
    if not isinstance(label, str):
        return "unknown"
    normalized = label.strip().lower()
    if normalized.startswith("zh"):
        return "zh"
    if normalized.startswith("en"):
        return "en"
    return normalized or "unknown"


def cjk_ratio(text: str) -> float:
    visible = "".join(char for char in text if not char.isspace())
    if not visible:
        return 0.0
    cjk_chars = sum("\u4e00" <= char <= "\u9fff" for char in visible)
    return cjk_chars / len(visible)


def detect_language(record: dict[str, Any], fallback_meta_fields: list[str], expected_language: str | None = None) -> str:
    turns = record.get("turns") or []
    text = "\n".join(
        turn.get("text", "").strip()
        for turn in turns
        if isinstance(turn, dict) and isinstance(turn.get("text"), str) and turn.get("text", "").strip()
    )[:4000]
    if text:
        try:
            detected = normalize_language(detect(text))
            if detected != "zh" and cjk_ratio(text) >= 0.3:
                return "zh"
            expected = normalize_language(expected_language)
            if expected == "en" and detected not in {"en", "zh"} and cjk_ratio(text) < 0.05 and any(char.isalpha() for char in text):
                return "en"
            if expected == "zh" and cjk_ratio(text) >= 0.2:
                return "zh"
            return detected
        except LangDetectException:
            pass
    meta = record.get("_meta")
    if isinstance(meta, dict):
        for field in fallback_meta_fields:
            value = meta.get(field)
            if isinstance(value, str) and value.strip():
                return normalize_language(value)
    return "unknown"


def conversation_digest(record: dict[str, Any]) -> str:
    turns = record.get("turns") or []
    material = "\n".join(
        f"{turn.get('role', '')}:{turn.get('text', '').strip()}"
        for turn in turns
        if isinstance(turn, dict)
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def text_has_encoding_noise(text: str) -> bool:
    return "\ufffd" in text or "\x00" in text


def looks_like_noise(text: str, config: dict[str, Any]) -> bool:
    stripped = text.strip()
    if not stripped:
        return True
    visible = "".join(char for char in stripped if not char.isspace())
    if not visible:
        return True
    if len(visible) < int(config["min_visible_chars"]):
        return True

    repeated_ratio = Counter(visible).most_common(1)[0][1] / len(visible)
    if repeated_ratio >= float(config["max_repeated_char_ratio"]):
        return True

    alpha_ratio = sum(char.isalnum() for char in visible) / len(visible)
    if alpha_ratio < float(config["min_alnum_ratio"]):
        return True

    tokens = re.findall(r"\w+", stripped.lower())
    if tokens:
        token_counts = Counter(tokens)
        most_common = token_counts.most_common(1)[0][1]
        if most_common >= int(config["spam_repeat_threshold"]) and len(token_counts) <= int(config["max_unique_tokens_when_spam"]):
            return True

    lowered = stripped.lower()
    if any(keyword in lowered for keyword in config["spam_keywords"]):
        url_count = lowered.count("http://") + lowered.count("https://")
        if url_count >= int(config["spam_url_threshold"]):
            return True
    return False


def has_required_roles(record: dict[str, Any], required_roles: list[str]) -> bool:
    turns = record.get("turns")
    if not isinstance(turns, list):
        return False
    roles = {turn.get("role") for turn in turns if isinstance(turn, dict)}
    return all(role in roles for role in required_roles)


def turns_with_content(record: dict[str, Any]) -> list[dict[str, Any]]:
    turns = record.get("turns")
    if not isinstance(turns, list):
        return []
    return [turn for turn in turns if isinstance(turn, dict) and isinstance(turn.get("text"), str)]


def clone_record_with_turns(record: dict[str, Any], turns: list[dict[str, Any]]) -> dict[str, Any]:
    cloned = dict(record)
    cloned["turns"] = [
        {
            **turn,
            "text": turn["text"].strip(),
        }
        for turn in turns
    ]
    return cloned


def clean_turns(record: dict[str, Any], config: dict[str, Any], keep_invalid_encoding: bool) -> tuple[list[dict[str, Any]], Counter[str]]:
    turns = turns_with_content(record)
    min_chars = int(config["min_turn_chars"])
    max_chars = int(config["max_turn_chars"])
    pruned = Counter()
    cleaned: list[dict[str, Any]] = []
    for turn in turns:
        text = turn["text"].strip()
        if len(text) < min_chars or len(text) > max_chars:
            pruned["turn_length_out_of_range"] += 1
            continue
        if text_has_encoding_noise(text) and not keep_invalid_encoding:
            pruned["encoding_noise"] += 1
            continue
        cleaned.append({**turn, "text": text})
    return cleaned, pruned


def evaluate_record(
    record: dict[str, Any],
    config: dict[str, Any],
    seen_digests: set[str],
    *,
    expected_language: str | None = None,
    dedupe: bool = True,
    keep_invalid_encoding: bool = False,
) -> FilterDecision:
    cleaned_turns, pruned_reasons = clean_turns(record, config, keep_invalid_encoding)
    cleaned_record = clone_record_with_turns(record, cleaned_turns)
    if not cleaned_turns or not has_required_roles(cleaned_record, list(config["required_roles"])):
        reason = "missing_required_roles_after_cleaning" if pruned_reasons else "missing_required_roles"
        return FilterDecision(
            bucket="removed",
            reason=reason,
            language="unknown",
            digest=None,
            record=None,
            pruned_turns=sum(pruned_reasons.values()),
            pruned_reasons=pruned_reasons,
        )

    content_turns = [turn for turn in cleaned_turns if turn.get("role") in {"user", "assistant"}]
    if content_turns and all(looks_like_noise(turn["text"], config["noise"]) for turn in content_turns):
        return FilterDecision(
            bucket="removed",
            reason="noise_or_spam",
            language="unknown",
            digest=None,
            record=None,
            pruned_turns=sum(pruned_reasons.values()),
            pruned_reasons=pruned_reasons,
        )

    language = detect_language(cleaned_record, list(config["language"]["fallback_meta_fields"]), expected_language)
    digest = conversation_digest(cleaned_record)
    if dedupe and digest in seen_digests:
        return FilterDecision(
            bucket="removed",
            reason="duplicate_text_hash",
            language=language,
            digest=digest,
            record=None,
            pruned_turns=sum(pruned_reasons.values()),
            pruned_reasons=pruned_reasons,
        )

    allowed_primary = {normalize_language(item) for item in config["language"]["primary"]}
    allowed_chinese = {normalize_language(item) for item in config["language"]["chinese_subset"]}
    if language in allowed_primary:
        return FilterDecision(
            bucket="primary",
            reason=None,
            language=language,
            digest=digest,
            record=cleaned_record,
            pruned_turns=sum(pruned_reasons.values()),
            pruned_reasons=pruned_reasons,
        )
    if language in allowed_chinese:
        return FilterDecision(
            bucket="chinese",
            reason=None,
            language=language,
            digest=digest,
            record=cleaned_record,
            pruned_turns=sum(pruned_reasons.values()),
            pruned_reasons=pruned_reasons,
        )
    return FilterDecision(
        bucket="removed",
        reason="unsupported_language",
        language=language,
        digest=digest,
        record=None,
        pruned_turns=sum(pruned_reasons.values()),
        pruned_reasons=pruned_reasons,
    )


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def filter_dataset(dataset: dict[str, Any], config: dict[str, Any], seen_digests: set[str]) -> dict[str, Any]:
    input_path = Path(dataset["input_path"])
    primary_output_path = Path(dataset["primary_output_path"])
    chinese_output_path = Path(dataset["chinese_output_path"])
    kept_primary: list[dict[str, Any]] = []
    kept_chinese: list[dict[str, Any]] = []
    reasons = Counter()
    languages = Counter()
    pruned_reasons = Counter()
    pruned_turns_total = 0
    total = 0
    dataset_overrides = dataset.get("overrides") or {}

    for record in iter_jsonl_records(input_path):
        total += 1
        decision = evaluate_record(
            record,
            config["filters"],
            seen_digests,
            expected_language=dataset_overrides.get("expected_language"),
            dedupe=bool(dataset_overrides.get("dedupe", True)),
            keep_invalid_encoding=bool(dataset_overrides.get("keep_invalid_encoding", False)),
        )
        languages[decision.language] += 1
        pruned_turns_total += decision.pruned_turns
        pruned_reasons.update(decision.pruned_reasons)
        if decision.bucket == "primary":
            seen_digests.add(decision.digest or "")
            kept_primary.append(decision.record or record)
            continue
        if decision.bucket == "chinese":
            seen_digests.add(decision.digest or "")
            kept_chinese.append(decision.record or record)
            continue
        reasons[decision.reason or "unknown"] += 1

    write_jsonl(primary_output_path, kept_primary)
    write_jsonl(chinese_output_path, kept_chinese)
    retained = len(kept_primary) + len(kept_chinese)
    return {
        "dataset": dataset["name"],
        "input_path": str(input_path),
        "primary_output_path": str(primary_output_path),
        "chinese_output_path": str(chinese_output_path),
        "total_records": total,
        "kept_primary": len(kept_primary),
        "kept_chinese": len(kept_chinese),
        "removed": total - retained,
        "pass_rate": round((retained / total) if total else 0.0, 6),
        "removal_reasons": dict(reasons),
        "pruned_turns": pruned_turns_total,
        "pruned_turn_reasons": dict(pruned_reasons),
        "language_distribution": dict(languages),
    }


def run_filter(config: dict[str, Any]) -> dict[str, Any]:
    seen_digests: set[str] = set()
    dataset_reports = []
    overall = {
        "total_records": 0,
        "kept_primary": 0,
        "kept_chinese": 0,
        "removed": 0,
        "removal_reasons": Counter(),
    }
    for dataset in config["datasets"]:
        report = filter_dataset(dataset, config, seen_digests)
        dataset_reports.append(report)
        overall["total_records"] += report["total_records"]
        overall["kept_primary"] += report["kept_primary"]
        overall["kept_chinese"] += report["kept_chinese"]
        overall["removed"] += report["removed"]
        overall["removal_reasons"].update(report["removal_reasons"])

    retained = overall["kept_primary"] + overall["kept_chinese"]
    pass_rate = (retained / overall["total_records"]) if overall["total_records"] else 0.0
    return {
        "config_version": config.get("version"),
        "filter_config_path": config.get("_config_path"),
        "datasets": dataset_reports,
        "overall": {
            "total_records": overall["total_records"],
            "kept_primary": overall["kept_primary"],
            "kept_chinese": overall["kept_chinese"],
            "removed": overall["removed"],
            "pass_rate": round(pass_rate, 6),
            "target_pass_rate": float(config["filters"]["target_pass_rate"]),
            "meets_target_pass_rate": pass_rate >= float(config["filters"]["target_pass_rate"]),
            "removal_reasons": dict(overall["removal_reasons"]),
            "global_unique_hashes": len(seen_digests),
        },
    }


def main() -> None:
    args = parse_args()
    config = load_config(args.config_path)
    config["_config_path"] = str(Path(args.config_path))
    report = run_filter(config)
    target = Path(args.report_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
