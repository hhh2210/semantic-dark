from __future__ import annotations

import hashlib


def dispersed_indices(total: int, count: int, seed: str) -> list[int]:
    """Pick one deterministic hash-offset item per equal-width stratum."""
    if total < 0 or count < 0:
        raise ValueError("total and count must be non-negative")
    if total == 0 or count == 0:
        return []
    count = min(total, count)
    if count == total:
        return list(range(total))

    selected: list[int] = []
    for stratum in range(count):
        start = stratum * total // count
        end = (stratum + 1) * total // count
        digest = hashlib.sha256(f"{seed}\0{stratum}".encode()).digest()
        selected.append(start + int.from_bytes(digest[:8], "big") % (end - start))
    return sorted(selected)
