#!/usr/bin/env python3
"""Merge per-year statement extracts into data/statements.json.

Usage:
    python3 scripts/merge_statements.py statements_2024.json statements_2025.json ... [-o data/statements.json]

Each input is produced by parsing the weekly TRM commission consolidation
statement workbooks (see README "Refreshing the data") and has the shape
{"year": 2026, "statements": [{"file", "date", "total", "items": [...]}]}.
"""
import json
import sys
from datetime import datetime


def main():
    args = sys.argv[1:]
    out_path = "data/statements.json"
    if "-o" in args:
        i = args.index("-o")
        out_path = args[i + 1]
        del args[i:i + 2]
    if not args:
        sys.exit(__doc__)

    statements = []
    for path in args:
        with open(path) as fh:
            payload = json.load(fh)
        statements.extend(payload["statements"])

    # De-duplicate: same filename (statement filed twice), or an identical
    # statement saved under a "(1)"-style copy name (same date, total and
    # item count). Prefer the shortest filename of each duplicate group.
    seen = {}
    for s in statements:
        key = (s["date"], round(s["total"], 2), len(s["items"]))
        prev = seen.get(key)
        if prev is None or (len(s["file"]), s["file"]) < (len(prev["file"]), prev["file"]):
            seen[key] = s
    merged = sorted(seen.values(), key=lambda s: (s["date"], s["file"]))
    dropped = len(statements) - len(merged)
    if dropped:
        print(f"note: dropped {dropped} duplicate statement(s)")

    result = {
        "generatedAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "TRM weekly commission consolidation statements (Drive: commision/Statements)",
        "statements": merged,
    }
    with open(out_path, "w") as fh:
        json.dump(result, fh, indent=1)
    total = sum(s["total"] for s in merged)
    print(f"{len(merged)} statements -> {out_path} (grand total £{total:,.2f})")


if __name__ == "__main__":
    main()
