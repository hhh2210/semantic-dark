from __future__ import annotations

from typing import Any

from .ontology import KNOWN_LABELS


def rejection_metrics(rows: list[dict[str, Any]]) -> dict[str, float | int | None]:
    known = [row for row in rows if row["label"] in KNOWN_LABELS]
    unknown = [row for row in rows if row["label"] == "unknown"]
    accepted_known = [row for row in known if not row["abstained"]]
    correct_known = [row for row in accepted_known if row["predicted"] == row["label"]]
    false_accepts = sum(not row["abstained"] for row in unknown)
    return {
        "known_total": len(known),
        "known_accepted": len(accepted_known),
        "known_coverage": _ratio(len(accepted_known), len(known)),
        "known_selective_accuracy": _ratio(len(correct_known), len(accepted_known)),
        "unknown_total": len(unknown),
        "unknown_false_accepts": false_accepts,
        "unknown_false_accept_rate": _ratio(false_accepts, len(unknown)),
        "overall_abstain_rate": _ratio(sum(row["abstained"] for row in rows), len(rows)),
    }


def _ratio(numerator: int, denominator: int) -> float | None:
    return None if denominator == 0 else numerator / denominator
