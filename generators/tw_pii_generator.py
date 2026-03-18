from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

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
TW_CITIES = [
    ("臺北市", ["中正區", "大安區", "信義區"]),
    ("新北市", ["板橋區", "中和區", "新店區"]),
    ("臺中市", ["西屯區", "北屯區", "南屯區"]),
    ("臺南市", ["中西區", "東區", "永康區"]),
    ("高雄市", ["前鎮區", "左營區", "三民區"]),
]
TW_ROADS = ["忠孝東路", "中山路", "民生路", "建國路", "和平路", "光復路"]
TW_MOBILE_REGEX = re.compile(r"^09\d{2}-\d{3}-\d{3}$")
TW_ADDRESS_REGEX = re.compile(r"^(臺北市|新北市|臺中市|臺南市|高雄市).+區.+路\d+段\d+號$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Taiwan-localized PII fixtures for RZV-252.")
    parser.add_argument("--count-per-type", type=int, default=100, help="How many records to generate for each PII type.")
    parser.add_argument("--output-path", required=True, help="JSONL path for generated raw cases.")
    parser.add_argument("--report-path", required=True, help="JSON report path.")
    return parser.parse_args()


def luhn_check_digit(base: str) -> int:
    digits = [int(char) for char in base]
    checksum = 0
    parity = (len(digits) + 1) % 2
    for index, digit in enumerate(digits):
        if index % 2 == parity:
            digit *= 2
            if digit > 9:
                digit -= 9
        checksum += digit
    return (10 - (checksum % 10)) % 10


def is_valid_luhn(value: str) -> bool:
    return value.isdigit() and len(value) >= 12 and luhn_check_digit(value[:-1]) == int(value[-1])


def is_valid_tw_national_id(value: str) -> bool:
    if not re.fullmatch(r"[A-Z][12]\d{8}", value):
        return False
    code = TW_ID_LETTER_CODE.get(value[0])
    if code is None:
        return False
    digits = [code // 10, code % 10, *[int(char) for char in value[1:]]]
    weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1]
    checksum = sum(digit * weight for digit, weight in zip(digits, weights))
    return checksum % 10 == 0


def generate_tw_national_id(index: int) -> str:
    letter = list(TW_ID_LETTER_CODE.keys())[index % len(TW_ID_LETTER_CODE)]
    gender = "1" if index % 2 == 0 else "2"
    body = f"{index:07d}"[-7:]
    prefix = f"{letter}{gender}{body}"
    for check_digit in range(10):
        candidate = prefix + str(check_digit)
        if is_valid_tw_national_id(candidate):
            return candidate
    raise ValueError(f"Unable to generate valid Taiwan national ID for index {index}.")


def is_valid_tw_mobile(value: str) -> bool:
    return bool(TW_MOBILE_REGEX.fullmatch(value))


def generate_tw_mobile(index: int) -> str:
    suffix = f"{index:08d}"[-8:]
    return f"09{suffix[:2]}-{suffix[2:5]}-{suffix[5:8]}"


def generate_tw_credit_card(index: int) -> str:
    bins = ["412345", "431298", "455612", "518923", "542301"]
    base = (bins[index % len(bins)] + f"{index:09d}")[:15]
    return base + str(luhn_check_digit(base))


def is_valid_tw_address(value: str) -> bool:
    return bool(TW_ADDRESS_REGEX.fullmatch(value))


def generate_tw_address(index: int) -> str:
    city, districts = TW_CITIES[index % len(TW_CITIES)]
    district = districts[(index // len(TW_CITIES)) % len(districts)]
    road = TW_ROADS[index % len(TW_ROADS)]
    section = (index % 6) + 1
    number = 100 + index
    return f"{city}{district}{road}{section}段{number}號"


def is_valid_tw_uniform_id(value: str) -> bool:
    if not re.fullmatch(r"\d{8}", value):
        return False
    products = [int(digit) * weight for digit, weight in zip(value, [1, 2, 1, 2, 1, 2, 4, 1])]
    total = sum((product // 10) + (product % 10) for product in products)
    return total % 10 == 0 or (value[6] == "7" and (total + 1) % 10 == 0)


def generate_tw_uniform_id(index: int) -> str:
    base = f"{index:07d}"[-7:]
    for check_digit in range(10):
        candidate = base + str(check_digit)
        if is_valid_tw_uniform_id(candidate):
            return candidate
    raise ValueError(f"Unable to generate valid Taiwan uniform ID for index {index}.")


def build_case(entity_type: str, detector_type: str, value: str, text: str, index: int) -> dict[str, Any]:
    return {
        "case_id": f"tw-pii-{entity_type}-{index:04d}",
        "entity_type": entity_type,
        "detector_type": detector_type,
        "value": value,
        "text": text,
    }


def build_cases(count_per_type: int) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for index in range(count_per_type):
        tw_id = generate_tw_national_id(index)
        cases.append(build_case("twNationalId", "tw_national_id", tw_id, f"My Taiwan ID is {tw_id}. Please keep it confidential.", index))
        mobile = generate_tw_mobile(index)
        cases.append(build_case("phone", "tw_phone", mobile, f"My Taiwan mobile number is {mobile}. Please redact it from the ticket.", index))
        card = generate_tw_credit_card(index)
        cases.append(build_case("creditCard", "credit_card", card, f"Use credit card {card} for the test purchase and then mask it.", index))
        address = generate_tw_address(index)
        cases.append(build_case("address", "address", address, f"Ship the package to {address} and remove the address from the export log.", index))
        uniform_id = generate_tw_uniform_id(index)
        cases.append(build_case("twUniformId", "tw_uniform_id", uniform_id, f"Vendor uniform ID is {uniform_id}. Mask it before sharing the procurement sheet.", index))
    return cases


def validate_case(case: dict[str, Any]) -> bool:
    detector = case["detector_type"]
    value = case["value"]
    if detector == "tw_national_id":
        return is_valid_tw_national_id(value)
    if detector == "tw_phone":
        return is_valid_tw_mobile(value)
    if detector == "credit_card":
        return is_valid_luhn(value)
    if detector == "address":
        return is_valid_tw_address(value)
    if detector == "tw_uniform_id":
        return is_valid_tw_uniform_id(value)
    return False


def write_json(path: str | Path, payload: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    cases = build_cases(args.count_per_type)
    output_path = Path(args.output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        for case in cases:
            handle.write(json.dumps(case, ensure_ascii=False) + "\n")

    validation_counts = Counter()
    for case in cases:
        validation_counts[case["detector_type"]] += int(validate_case(case))

    report = {
        "output_path": str(output_path),
        "records_written": len(cases),
        "count_per_type": args.count_per_type,
        "counts_by_detector": {
            "tw_national_id": args.count_per_type,
            "tw_phone": args.count_per_type,
            "credit_card": args.count_per_type,
            "address": args.count_per_type,
            "tw_uniform_id": args.count_per_type,
        },
        "validation_pass_counts": dict(validation_counts),
        "validation_pass_rate": {
            detector: round(validation_counts[detector] / args.count_per_type, 6)
            for detector in ["tw_national_id", "tw_phone", "credit_card", "address", "tw_uniform_id"]
        },
    }
    write_json(args.report_path, report)


if __name__ == "__main__":
    main()
