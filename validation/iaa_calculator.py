from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

AXES = ("FR", "CA", "SR", "SA")
RISK_STATUSES = ("Normal", "Observe", "Deviate", "Alert")
RISK_TO_INT = {label: index for index, label in enumerate(RISK_STATUSES)}


@dataclass(frozen=True)
class NormalizedRater:
    axis_scores: dict[str, float]
    risk_status: str
    trigger_rules: tuple[str, ...]
    notes: str


@dataclass(frozen=True)
class NormalizedCase:
    case_id: str
    source_family: str | None
    rater_a: NormalizedRater
    rater_b: NormalizedRater
    adjudicator: dict[str, Any] | None


def read_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: str | Path, payload: Any) -> None:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _normalize_risk_status(value: Any, *, case_id: str, rater_key: str) -> str:
    risk_status = str(value or "").strip()
    if risk_status not in RISK_TO_INT:
        raise ValueError(f"{case_id} {rater_key} has invalid risk_status: {risk_status!r}")
    return risk_status


def _normalize_axis_scores(raw_scores: Any, *, case_id: str, rater_key: str) -> dict[str, float]:
    if not isinstance(raw_scores, dict):
        raise ValueError(f"{case_id} {rater_key} axis_scores must be an object")
    normalized: dict[str, float] = {}
    for axis in AXES:
        value = raw_scores.get(axis, 0)
        numeric = float(value)
        if numeric < 0 or numeric > 100:
            raise ValueError(f"{case_id} {rater_key} axis score {axis} must be within 0-100")
        normalized[axis] = numeric
    return normalized


def _normalize_trigger_rules(raw_rules: Any) -> tuple[str, ...]:
    if raw_rules is None:
        return ()
    if not isinstance(raw_rules, list):
        raise ValueError("trigger_rules must be a list")
    normalized = sorted({str(rule).strip() for rule in raw_rules if str(rule).strip()})
    return tuple(normalized)


def _normalize_rater(raw_rater: Any, *, case_id: str, rater_key: str) -> NormalizedRater:
    if not isinstance(raw_rater, dict):
        raise ValueError(f"{case_id} {rater_key} must be an object")
    return NormalizedRater(
        axis_scores=_normalize_axis_scores(raw_rater.get("axis_scores"), case_id=case_id, rater_key=rater_key),
        risk_status=_normalize_risk_status(raw_rater.get("risk_status"), case_id=case_id, rater_key=rater_key),
        trigger_rules=_normalize_trigger_rules(raw_rater.get("trigger_rules")),
        notes=str(raw_rater.get("notes", "")).strip(),
    )


def normalize_batch(raw_batch: Any) -> tuple[str, list[NormalizedCase]]:
    if not isinstance(raw_batch, dict):
        raise ValueError("IAA batch payload must be a JSON object")
    batch_id = str(raw_batch.get("batch_id", "iaa-batch")).strip() or "iaa-batch"
    raw_cases = raw_batch.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("IAA batch must contain a non-empty `cases` array")

    normalized_cases: list[NormalizedCase] = []
    for raw_case in raw_cases:
        if not isinstance(raw_case, dict):
            raise ValueError("Each case must be an object")
        case_id = str(raw_case.get("case_id") or raw_case.get("conversation_id") or raw_case.get("id") or "").strip()
        if not case_id:
            raise ValueError("Each case must include case_id")
        normalized_cases.append(
            NormalizedCase(
                case_id=case_id,
                source_family=str(raw_case.get("source_family")).strip() if raw_case.get("source_family") is not None else None,
                rater_a=_normalize_rater(raw_case.get("rater_a"), case_id=case_id, rater_key="rater_a"),
                rater_b=_normalize_rater(raw_case.get("rater_b"), case_id=case_id, rater_key="rater_b"),
                adjudicator=raw_case.get("adjudicator") if isinstance(raw_case.get("adjudicator"), dict) else None,
            )
        )

    return batch_id, normalized_cases


def cohens_kappa(labels_a: list[int], labels_b: list[int]) -> float | None:
    if len(labels_a) != len(labels_b) or not labels_a:
        return None

    total = len(labels_a)
    agree = sum(1 for left, right in zip(labels_a, labels_b) if left == right)
    observed = agree / total

    counts_a = Counter(labels_a)
    counts_b = Counter(labels_b)
    expected = 0.0
    for category in range(len(RISK_STATUSES)):
        expected += (counts_a.get(category, 0) / total) * (counts_b.get(category, 0) / total)

    if expected == 1:
        return 1.0 if observed == 1 else 0.0
    return round((observed - expected) / (1 - expected), 6)


def icc_2_1(series_a: list[float], series_b: list[float]) -> float | None:
    if len(series_a) != len(series_b) or len(series_a) < 2:
        return None

    ratings = [[float(left), float(right)] for left, right in zip(series_a, series_b)]
    n = len(ratings)
    k = 2
    grand_mean = sum(sum(row) for row in ratings) / (n * k)

    mean_targets = [sum(row) / k for row in ratings]
    mean_raters = [
        sum(ratings[target_index][rater_index] for target_index in range(n)) / n
        for rater_index in range(k)
    ]

    ssr = k * sum((target_mean - grand_mean) ** 2 for target_mean in mean_targets)
    ssc = n * sum((rater_mean - grand_mean) ** 2 for rater_mean in mean_raters)
    sse = 0.0
    for target_index in range(n):
        for rater_index in range(k):
            value = ratings[target_index][rater_index]
            sse += (value - mean_targets[target_index] - mean_raters[rater_index] + grand_mean) ** 2

    msr = ssr / (n - 1) if n > 1 else 0.0
    msc = ssc / (k - 1) if k > 1 else 0.0
    mse = sse / ((n - 1) * (k - 1)) if n > 1 and k > 1 else 0.0

    denominator = msr + (k - 1) * mse + (k * (msc - mse) / n)
    if denominator == 0:
        return 1.0 if all(left == right for left, right in zip(series_a, series_b)) else 0.0
    return round((msr - mse) / denominator, 6)


def summarize_risk_status(cases: list[NormalizedCase]) -> dict[str, Any]:
    labels_a = [RISK_TO_INT[case.rater_a.risk_status] for case in cases]
    labels_b = [RISK_TO_INT[case.rater_b.risk_status] for case in cases]
    agreement_count = sum(1 for left, right in zip(labels_a, labels_b) if left == right)
    return {
        "cohens_kappa": cohens_kappa(labels_a, labels_b),
        "agreement_rate": round(agreement_count / len(cases), 6),
        "distribution": {
            "rater_a": dict(sorted(Counter(case.rater_a.risk_status for case in cases).items())),
            "rater_b": dict(sorted(Counter(case.rater_b.risk_status for case in cases).items())),
        },
    }


def summarize_axis_scores(cases: list[NormalizedCase]) -> dict[str, Any]:
    by_axis: dict[str, Any] = {}
    icc_values: list[float] = []
    for axis in AXES:
        scores_a = [case.rater_a.axis_scores[axis] for case in cases]
        scores_b = [case.rater_b.axis_scores[axis] for case in cases]
        icc_value = icc_2_1(scores_a, scores_b)
        if icc_value is not None:
            icc_values.append(icc_value)
        by_axis[axis] = {
            "icc_2_1": icc_value,
            "mean_rater_a": round(sum(scores_a) / len(scores_a), 6),
            "mean_rater_b": round(sum(scores_b) / len(scores_b), 6),
            "max_abs_diff": round(max(abs(left - right) for left, right in zip(scores_a, scores_b)), 6),
        }
    by_axis["macro_average_icc"] = round(sum(icc_values) / len(icc_values), 6) if icc_values else None
    return by_axis


def summarize_trigger_rules(cases: list[NormalizedCase]) -> dict[str, Any]:
    exact_match_count = 0
    jaccard_total = 0.0
    disagreement_total = 0
    for case in cases:
        rules_a = set(case.rater_a.trigger_rules)
        rules_b = set(case.rater_b.trigger_rules)
        if rules_a == rules_b:
            exact_match_count += 1
        union = rules_a | rules_b
        intersection = rules_a & rules_b
        jaccard_total += 1.0 if not union else len(intersection) / len(union)
        disagreement_total += len(union - intersection)

    total_cases = len(cases)
    return {
        "exact_match_rate": round(exact_match_count / total_cases, 6),
        "macro_jaccard": round(jaccard_total / total_cases, 6),
        "rule_disagreement_count": disagreement_total,
    }


def build_arbitration_queue(cases: list[NormalizedCase]) -> list[dict[str, Any]]:
    queue: list[dict[str, Any]] = []
    for case in cases:
        axis_deltas = {
            axis: {
                "rater_a": case.rater_a.axis_scores[axis],
                "rater_b": case.rater_b.axis_scores[axis],
            }
            for axis in AXES
            if case.rater_a.axis_scores[axis] != case.rater_b.axis_scores[axis]
        }
        rules_a = list(case.rater_a.trigger_rules)
        rules_b = list(case.rater_b.trigger_rules)
        if (
            case.rater_a.risk_status != case.rater_b.risk_status
            or axis_deltas
            or set(rules_a) != set(rules_b)
        ):
            queue.append(
                {
                    "case_id": case.case_id,
                    "risk_status": {
                        "rater_a": case.rater_a.risk_status,
                        "rater_b": case.rater_b.risk_status,
                    },
                    "axis_score_deltas": axis_deltas,
                    "trigger_rules": {
                        "rater_a": rules_a,
                        "rater_b": rules_b,
                    },
                    "adjudicator": case.adjudicator,
                }
            )
    return queue


def calculate_iaa_metrics(
    raw_batch: Any,
    *,
    min_kappa: float = 0.61,
    min_icc: float = 0.85,
    min_rule_agreement: float = 0.9,
) -> dict[str, Any]:
    batch_id, cases = normalize_batch(raw_batch)
    risk_status = summarize_risk_status(cases)
    axis_scores = summarize_axis_scores(cases)
    trigger_rules = summarize_trigger_rules(cases)
    arbitration_queue = build_arbitration_queue(cases)

    per_axis_thresholds = {
        axis: (axis_scores[axis]["icc_2_1"] is not None and axis_scores[axis]["icc_2_1"] >= min_icc)
        for axis in AXES
    }
    meets_kappa = bool(risk_status["cohens_kappa"] is not None and risk_status["cohens_kappa"] >= min_kappa)
    meets_icc = all(per_axis_thresholds.values())
    meets_trigger_rules = trigger_rules["exact_match_rate"] >= min_rule_agreement

    return {
        "batch_id": batch_id,
        "case_count": len(cases),
        "thresholds": {
            "cohens_kappa": min_kappa,
            "icc_2_1": min_icc,
            "trigger_rule_exact_match_rate": min_rule_agreement,
        },
        "risk_status": risk_status,
        "axis_scores": axis_scores,
        "trigger_rules": trigger_rules,
        "arbitration": {
            "conflict_count": len(arbitration_queue),
            "resolved_count": sum(1 for item in arbitration_queue if item.get("adjudicator")),
            "queue": arbitration_queue,
        },
        "summary": {
            "meets_kappa": meets_kappa,
            "meets_icc": meets_icc,
            "meets_trigger_rule_agreement": meets_trigger_rules,
            "readiness": "ready" if meets_kappa and meets_icc and meets_trigger_rules else "not_ready",
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Calculate IAA metrics for A-CSM annotation batches.")
    parser.add_argument("--input", required=True, help="Path to the IAA batch JSON file.")
    parser.add_argument("--output", help="Optional output JSON path.")
    parser.add_argument("--min-kappa", type=float, default=0.61, help="Minimum Cohen's Kappa threshold.")
    parser.add_argument("--min-icc", type=float, default=0.85, help="Minimum ICC(2,1) threshold per axis.")
    parser.add_argument(
        "--min-rule-agreement",
        type=float,
        default=0.9,
        help="Minimum exact match rate threshold for trigger rules.",
    )
    parser.add_argument("--enforce", action="store_true", help="Exit with code 1 if thresholds are not met.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = calculate_iaa_metrics(
        read_json(args.input),
        min_kappa=args.min_kappa,
        min_icc=args.min_icc,
        min_rule_agreement=args.min_rule_agreement,
    )
    if args.output:
        write_json(args.output, result)
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))

    if args.enforce and result["summary"]["readiness"] != "ready":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
