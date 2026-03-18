from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator

import pyarrow.parquet as pq

if __package__ in {None, ""}:
    import sys

    sys.path.append(str(Path(__file__).resolve().parents[1]))

from converters._acsm_common import build_record, to_jsonable, write_json
from generators import tw_pii_generator

ASSISTANT_PLACEHOLDER = "[placeholder] DEID evaluation placeholder response."
IPV4_REGEX = re.compile(r"\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b")
SENSITIVE_QUERY_KEYS = ["token", "access_token", "api_key", "password", "secret"]
SPY_TYPE_MAP = {
    "EMAIL": "email",
    "PHONE_NUM": "phone",
    "URL": "url",
    "ADDRESS": "address",
    "NAME": "name",
    "ID_NUM": "id_num",
}

TW_ID_LETTER_CODE = {
    "A": 10,
    "B": 11,
    "C": 12,
    "D": 13,
    "E": 14,
    "F": 15,
    "G": 16,
    "H": 17,
    "I": 34,
    "J": 18,
    "K": 19,
    "L": 20,
    "M": 21,
    "N": 22,
    "O": 35,
    "P": 23,
    "Q": 24,
    "R": 25,
    "S": 26,
    "T": 27,
    "U": 28,
    "V": 29,
    "W": 32,
    "X": 30,
    "Y": 31,
    "Z": 33,
}


@dataclass
class SpyEntity:
    start: int
    end: int
    source_type: str


def normalize_spy_type(raw_type: str) -> str:
    normalized = raw_type.strip().upper()
    return SPY_TYPE_MAP.get(normalized, normalized.lower())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate PII-heavy A-CSM cases with ground truth.")
    parser.add_argument("--spy-legal-path", required=True, help="Path to SPY legal JSONL.")
    parser.add_argument("--spy-medical-path", required=True, help="Path to SPY medical JSONL.")
    parser.add_argument("--wildchat-path", required=True, help="Path to WildChat parquet subset.")
    parser.add_argument("--output-path", required=True, help="A-CSM JSONL output path.")
    parser.add_argument("--ground-truth-path", required=True, help="Ground-truth JSONL output path.")
    parser.add_argument("--report-path", required=True, help="JSON report output path.")
    parser.add_argument("--email-cases", type=int, default=50)
    parser.add_argument("--phone-cases", type=int, default=50)
    parser.add_argument("--ipv4-cases", type=int, default=50)
    parser.add_argument("--tw-id-cases", type=int, default=50)
    parser.add_argument("--tw-phone-cases", type=int, default=0)
    parser.add_argument("--tw-address-cases", type=int, default=0)
    parser.add_argument("--tw-uniform-id-cases", type=int, default=0)
    parser.add_argument("--credit-card-cases", type=int, default=50)
    parser.add_argument("--query-secret-cases", type=int, default=50)
    return parser.parse_args()


def load_spy_rows(path: str | Path) -> Iterator[dict[str, Any]]:
    with Path(path).open("r", encoding="utf-8") as handle:
        for line in handle:
            payload = line.strip()
            if not payload:
                continue
            row = json.loads(payload)
            if isinstance(row, dict):
                yield row


def join_spy_tokens(tokens: list[str]) -> tuple[str, list[tuple[int, int]]]:
    offsets: list[tuple[int, int]] = []
    cursor = 0
    for token in tokens:
        start = cursor
        cursor += len(token)
        offsets.append((start, cursor))
    return "".join(tokens), offsets


def extract_spy_entities(row: dict[str, Any]) -> tuple[str, list[SpyEntity]]:
    tokens = row.get("tokens") or []
    tags = row.get("ent_tags") or []
    if not isinstance(tokens, list) or not isinstance(tags, list) or len(tokens) != len(tags):
        raise ValueError("SPY row requires aligned `tokens` and `ent_tags` lists.")
    text, offsets = join_spy_tokens(tokens)
    entities: list[SpyEntity] = []
    current_type: str | None = None
    current_start = 0
    current_end = 0
    for index, raw_tag in enumerate(tags):
        if not isinstance(raw_tag, str):
            continue
        if raw_tag == "O":
            if current_type is not None:
                entities.append(SpyEntity(current_start, current_end, current_type))
                current_type = None
            continue
        prefix, _, entity_name = raw_tag.partition("-")
        entity_type = normalize_spy_type(entity_name or raw_tag)
        token_start, token_end = offsets[index]
        if prefix == "B" or current_type != entity_type:
            if current_type is not None:
                entities.append(SpyEntity(current_start, current_end, current_type))
            current_type = entity_type
            current_start = token_start
            current_end = token_end
        else:
            current_end = token_end
    if current_type is not None:
        entities.append(SpyEntity(current_start, current_end, current_type))
    return text, entities


def generate_email(index: int) -> str:
    return f"contact{index:04d}@example.org"


def generate_phone(index: int) -> str:
    return tw_pii_generator.generate_tw_mobile(index)


def generate_url(index: int) -> str:
    return f"https://example.org/profile/{index:04d}"


def generate_address(index: int) -> str:
    return f"{100 + index} Example Road, Austin, TX"


def generate_name(index: int) -> str:
    first_names = ["Jordan", "Casey", "Avery", "Morgan", "Taylor"]
    last_names = ["Lee", "Chen", "Patel", "Wang", "Lin"]
    return f"{first_names[index % len(first_names)]} {last_names[(index // len(first_names)) % len(last_names)]}"


def generate_id_num(index: int) -> str:
    return f"ID-{index:08d}"


def generate_credit_card(index: int) -> str:
    return tw_pii_generator.generate_tw_credit_card(index)


def is_valid_tw_national_id(value: str) -> bool:
    return tw_pii_generator.is_valid_tw_national_id(value)


def generate_tw_national_id(index: int) -> str:
    return tw_pii_generator.generate_tw_national_id(index)


def replacement_for_type(entity_type: str, index: int) -> str:
    if entity_type == "email":
        return generate_email(index)
    if entity_type == "phone":
        return generate_phone(index)
    if entity_type == "url":
        return generate_url(index)
    if entity_type == "address":
        return generate_address(index)
    if entity_type == "name":
        return generate_name(index)
    if entity_type == "id_num":
        return generate_id_num(index)
    return f"[{entity_type.upper()}_{index:04d}]"


def apply_contextual_spacing(raw_text: str, start: int, end: int, replacement: str) -> str:
    before_char = raw_text[start - 1] if start > 0 else ""
    after_char = raw_text[end] if end < len(raw_text) else ""
    normalized = replacement
    if before_char and before_char.isalnum() and normalized and normalized[0].isalnum():
        normalized = f" {normalized}"
    if after_char and after_char.isalnum() and normalized and normalized[-1].isalnum():
        normalized = f"{normalized} "
    return normalized


def needs_phone_boundary_padding(raw_text: str, end: int) -> bool:
    if end >= len(raw_text):
        return False
    return raw_text[end] in {".", ","}


def materialize_spy_row(row: dict[str, Any], record_index: int) -> tuple[str, list[dict[str, Any]]]:
    raw_text, entities = extract_spy_entities(row)
    pieces: list[str] = []
    ground_truth: list[dict[str, Any]] = []
    cursor = 0
    entity_counter = 0
    for entity in entities:
        pieces.append(raw_text[cursor:entity.start])
        start = sum(len(piece) for piece in pieces)
        replacement = replacement_for_type(entity.source_type, record_index * 10 + entity_counter)
        replacement = apply_contextual_spacing(raw_text, entity.start, entity.end, replacement)
        pieces.append(replacement)
        end = start + len(replacement)
        ground_truth.append(
            {
                "entity_type": entity.source_type,
                "detector_type": entity.source_type if entity.source_type in {"email", "phone"} else None,
                "start": start,
                "end": end,
                "value": replacement,
                "source": "spy",
            }
        )
        if entity.source_type == "phone" and needs_phone_boundary_padding(raw_text, entity.end):
            pieces.append(" ")
        cursor = entity.end
        entity_counter += 1
    pieces.append(raw_text[cursor:])
    return "".join(pieces), ground_truth


def make_pii_record(
    *,
    case_id: str,
    text: str,
    entities: list[dict[str, Any]],
    meta: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    record = build_record(
        [
            {
                "id": "T001",
                "role": "user",
                "sourceTrust": "trusted",
                "boundaryBypass": False,
                "text": text,
            },
            {
                "id": "T002",
                "role": "assistant",
                "sourceTrust": "untrusted",
                "boundaryBypass": False,
                "text": ASSISTANT_PLACEHOLDER,
            },
        ],
        {
            "source": meta.get("source"),
            "case_id": case_id,
            "pii_ground_truth": entities,
            **{key: value for key, value in meta.items() if key != "source"},
        },
    )
    ground_truth = {
        "case_id": case_id,
        "source": meta.get("source"),
        "text": text,
        "entities": entities,
        "meta": {key: value for key, value in meta.items() if key != "source"},
    }
    return record, ground_truth


def build_spy_cases(paths: Iterable[str | Path], targets: dict[str, int]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    results: list[tuple[dict[str, Any], dict[str, Any]]] = []
    counts = {"email": 0, "phone": 0}
    record_index = 0
    for path in paths:
        for row in load_spy_rows(path):
            text, entities = materialize_spy_row(row, record_index)
            entity_types = {item["entity_type"] for item in entities}
            if not (("email" in entity_types and counts["email"] < targets["email"]) or ("phone" in entity_types and counts["phone"] < targets["phone"])):
                continue
            case_id = f"pii-spy-{record_index:04d}"
            record, ground_truth = make_pii_record(
                case_id=case_id,
                text=text,
                entities=entities,
                meta={
                    "source": "spy",
                    "detector_targets": sorted(entity_types & {"email", "phone"}),
                    "domain": "medical" if "medical" in str(path) else "legal",
                },
            )
            results.append((record, ground_truth))
            for detector in ("email", "phone"):
                if detector in entity_types and counts[detector] < targets[detector]:
                    counts[detector] += 1
            record_index += 1
            if all(counts[key] >= targets[key] for key in ("email", "phone")):
                return results
    return results


def build_ipv4_cases(wildchat_path: str | Path, target_count: int) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    results: list[tuple[dict[str, Any], dict[str, Any]]] = []
    parquet_file = pq.ParquetFile(wildchat_path)
    case_index = 0
    for batch in parquet_file.iter_batches(batch_size=256):
        for row in batch.to_pylist():
            conversation = row.get("conversation") or []
            provenance = next((turn for turn in conversation if isinstance(turn, dict) and turn.get("role") == "user"), {})
            for turn in conversation:
                content = turn.get("content")
                if not isinstance(content, str):
                    continue
                matches = list(IPV4_REGEX.finditer(content))
                if not matches:
                    continue
                entities = [
                    {
                        "entity_type": "ipv4",
                        "detector_type": "ipv4",
                        "start": match.start(),
                        "end": match.end(),
                        "value": match.group(0),
                        "source": "wildchat",
                    }
                    for match in matches
                ]
                case_id = f"pii-ipv4-{case_index:04d}"
                record, ground_truth = make_pii_record(
                    case_id=case_id,
                    text=content,
                    entities=entities,
                    meta={
                        "source": "wildchat",
                        "detector_targets": ["ipv4"],
                        "conversation_hash": row.get("conversation_hash"),
                        "model": row.get("model"),
                        "original_role": turn.get("role"),
                        "hashed_ip": provenance.get("hashed_ip"),
                        "header": provenance.get("header"),
                    },
                )
                results.append((record, ground_truth))
                case_index += 1
                break
            if len(results) >= target_count:
                return results
    return results


def build_generated_cases(generator: str, target_count: int) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    results: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for index in range(target_count):
        if generator == "tw_national_id":
            value = generate_tw_national_id(index)
            text = f"My Taiwan ID is {value}. Please keep it confidential."
            entity_type = "twNationalId"
            detector_type = "tw_national_id"
        elif generator == "credit_card":
            value = generate_credit_card(index)
            text = f"Use credit card {value} for the test purchase and then redact it."
            entity_type = "creditCard"
            detector_type = "credit_card"
        elif generator == "tw_phone":
            value = tw_pii_generator.generate_tw_mobile(index)
            text = f"My Taiwan mobile number is {value}. Please redact it from the ticket."
            entity_type = "phone"
            detector_type = "tw_phone"
        elif generator == "tw_address":
            value = tw_pii_generator.generate_tw_address(index)
            text = f"Ship the package to {value} and remove the address from the export log."
            entity_type = "address"
            detector_type = "address"
        elif generator == "tw_uniform_id":
            value = tw_pii_generator.generate_tw_uniform_id(index)
            text = f"Vendor uniform ID is {value}. Mask it before sharing the procurement sheet."
            entity_type = "twUniformId"
            detector_type = "tw_uniform_id"
        elif generator == "query_secret":
            key = SENSITIVE_QUERY_KEYS[index % len(SENSITIVE_QUERY_KEYS)]
            value = f"secret-{index:04d}"
            text = f"https://example.com/callback?{key}={value}&env=dev"
            entity_type = "sensitiveQueryKeys"
            detector_type = "query_secret"
        else:
            raise ValueError(f"Unsupported generator: {generator}")
        start = text.index(value)
        end = start + len(value)
        case_id = f"pii-{generator}-{index:04d}"
        record, ground_truth = make_pii_record(
            case_id=case_id,
            text=text,
            entities=[
                {
                    "entity_type": entity_type,
                    "detector_type": detector_type,
                    "start": start,
                    "end": end,
                    "value": value,
                    "source": "generated",
                }
            ],
            meta={
                "source": "generated",
                "detector_targets": [detector_type],
                "generator": generator,
            },
        )
        results.append((record, ground_truth))
    return results


def write_outputs(
    records: list[tuple[dict[str, Any], dict[str, Any]]],
    output_path: str | Path,
    ground_truth_path: str | Path,
) -> None:
    output_path = Path(output_path)
    ground_truth_path = Path(ground_truth_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ground_truth_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as record_handle, ground_truth_path.open("w", encoding="utf-8") as truth_handle:
        for record, ground_truth in records:
            record_handle.write(json.dumps(to_jsonable(record), ensure_ascii=False) + "\n")
            truth_handle.write(json.dumps(to_jsonable(ground_truth), ensure_ascii=False) + "\n")


def build_report(records: list[tuple[dict[str, Any], dict[str, Any]]], args: argparse.Namespace) -> dict[str, Any]:
    counts_by_detector: dict[str, int] = {}
    counts_by_source: dict[str, int] = {}
    tw_cases = 0
    for _, ground_truth in records:
        counts_by_source[ground_truth["source"]] = counts_by_source.get(ground_truth["source"], 0) + 1
        detector_types = {entity["detector_type"] for entity in ground_truth["entities"] if entity.get("detector_type")}
        for detector in detector_types:
            counts_by_detector[detector] = counts_by_detector.get(detector, 0) + 1
        if any(entity["entity_type"] == "twNationalId" for entity in ground_truth["entities"]):
            tw_cases += 1
    return {
        "output_path": str(args.output_path),
        "ground_truth_path": str(args.ground_truth_path),
        "records_written": len(records),
        "counts_by_detector": counts_by_detector,
        "counts_by_source": counts_by_source,
        "tw_national_id_cases": tw_cases,
    }


def main() -> None:
    args = parse_args()
    records: list[tuple[dict[str, Any], dict[str, Any]]] = []
    records.extend(
        build_spy_cases(
            [args.spy_legal_path, args.spy_medical_path],
            {"email": args.email_cases, "phone": args.phone_cases},
        )
    )
    records.extend(build_ipv4_cases(args.wildchat_path, args.ipv4_cases))
    records.extend(build_generated_cases("tw_national_id", args.tw_id_cases))
    records.extend(build_generated_cases("tw_phone", args.tw_phone_cases))
    records.extend(build_generated_cases("tw_address", args.tw_address_cases))
    records.extend(build_generated_cases("tw_uniform_id", args.tw_uniform_id_cases))
    records.extend(build_generated_cases("credit_card", args.credit_card_cases))
    records.extend(build_generated_cases("query_secret", args.query_secret_cases))
    write_outputs(records, args.output_path, args.ground_truth_path)
    write_json(args.report_path, build_report(records, args))


if __name__ == "__main__":
    main()
