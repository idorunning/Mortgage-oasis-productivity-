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


def merge(statements):
    """De-duplicate a flat list of statements and return the data/statements.json
    payload. Dedup key is (date, total, item count) so the same statement filed
    twice — or saved under a "(1)"-style copy name — collapses to one; the
    shortest filename wins. Reused by scripts/gdrive_refresh.py."""
    seen = {}
    for s in statements:
        key = (s["date"], round(s["total"], 2), len(s["items"]))
        prev = seen.get(key)
        if prev is None or (len(s["file"]), s["file"]) < (len(prev["file"]), prev["file"]):
            seen[key] = s
    merged = sorted(seen.values(), key=lambda s: (s["date"] or "", s["file"]))
    return {
        "generatedAt": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "TRM weekly commission consolidation statements (Drive: commision/Statements)",
        "statements": merged,
    }


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

    result = merge(statements)
    dropped = len(statements) - len(result["statements"])
    if dropped:
        print(f"note: dropped {dropped} duplicate statement(s)")
    with open(out_path, "w") as fh:
        json.dump(result, fh, indent=1)
    total = sum(s["total"] for s in result["statements"])
    print(f"{len(result['statements'])} statements -> {out_path} (grand total £{total:,.2f})")


if __name__ == "__main__":
    main()
