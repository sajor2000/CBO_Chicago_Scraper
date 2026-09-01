import json
import re
import sys
import time

from scrapling import Fetcher


def compact(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", " ", value)).lower()


def main() -> None:
    cohort = json.load(sys.stdin)
    rows = []
    for gold in cohort:
        started = time.perf_counter()
        try:
            response = Fetcher.get(gold["url"])
            page = response.get_all_text(" ", strip=True).lower()
            rows.append({
                "reached": response.status == 200,
                "name": len(compact(gold["name"])) > 4 and gold["name"].lower() in page,
                "address": bool(gold["address"] and len(compact(gold["address"])) > 6 and gold["address"].lower() in page),
                "phone": bool(gold["phone"] and len(compact(gold["phone"])) > 6 and compact(gold["phone"]) in compact(page)),
                "elapsedMs": round((time.perf_counter() - started) * 1000),
            })
        except Exception:
            rows.append({"reached": False, "name": False, "address": False, "phone": False, "elapsedMs": round((time.perf_counter() - started) * 1000)})
    elapsed = sorted(row["elapsedMs"] for row in rows)
    print(json.dumps({
        "attempted": len(rows),
        "reached": sum(row["reached"] for row in rows),
        "nameMatches": sum(row["name"] for row in rows),
        "addressMatches": sum(row["address"] for row in rows),
        "phoneMatches": sum(row["phone"] for row in rows),
        "medianElapsedMs": elapsed[len(elapsed) // 2],
        "variableProviderCostUsd": 0,
    }))


if __name__ == "__main__":
    main()
