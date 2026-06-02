#!/usr/bin/env python3
"""
mortgage_oasis.analytics — parsing, cross-referencing and business analytics for
the Mortgage Oasis case-log.

The parser is name-based: the source sheet stacks several tables with *different*
column schemas per year, so each `Date`-led header row is detected and its columns
mapped to a canonical record by header name (not by position).

`analyse(raw_rows)` is the single entry point: it returns a JSON-serialisable dict
with KPIs, BD lists, chart series, adviser performance, a pipeline timeline,
quantified opportunity sizing and a ranked insights feed.

All analytics are deterministic and local — no external services, no data egress.
"""
import re
import csv
import json
import datetime
from collections import defaultdict, Counter

# Review the client this many months after completion (2yr product, engage ~3mo early)
TERM_MONTHS = 21
# Typical typical UK protection attach band, for benchmarking the insight cards.
ATTACH_BENCHMARK = (0.40, 0.60)
# Months of no activity before an adviser is flagged a likely leaver / dormant.
DORMANT_MONTHS = 6

LENDERS = {
    "nationwide", "halifax", "barclays", "natwest", "hsbc", "leeds", "santander",
    "skipton", "tsb", "virgin", "bm solutions", "west one", "aldermore", "coventry",
    "bank of ireland", "accord", "precise", "fluent", "the mortgage lender",
    "co-op", "co-operative", "kensington", "principality", "nottingham", "metro",
}
NON_SOURCE = {"", "n/a", "na", "n/a.", "-", "none", "nil"}
# Administrator cell values that are not real advisers
NON_ADVISER = {"", "n", "y", "admin", "administrator", "na", "n/a"}


# ---- parsing --------------------------------------------------------------
def load_markdown(src_path):
    with open(src_path, encoding="utf-8") as fh:
        raw = fh.read()
    try:
        return json.loads(raw)["fileContent"]
    except (json.JSONDecodeError, KeyError):
        return raw  # already plain markdown


def split_md_row(line):
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip() for c in line.split("|")]


def parse_markdown(md):
    """Return list of dicts keyed by that section's header names."""
    rows = []
    header = None
    for line in md.split("\n"):
        if not line.strip().startswith("|"):
            continue
        cells = split_md_row(line)
        joined = "".join(cells).replace(" ", "")
        if set(joined) <= set(":-") and joined:  # separator row | :-: | :-: |
            continue
        if cells and cells[0] == "Date":
            header = cells
            continue
        if header is None:
            continue
        rows.append({header[i]: (cells[i] if i < len(cells) else "")
                     for i in range(len(header))})
    return rows


def rows_from_table(table):
    """Turn a 2-D array (CSV / Google Sheets values) into header-keyed dicts,
    handling several stacked tables with different `Date`-led headers."""
    rows, header = [], None
    for cells in table:
        cells = [(c or "").strip() for c in cells]
        if cells and cells[0] == "Date":
            header = cells
            continue
        if header is None or not any(cells):
            continue
        rows.append({header[i]: (cells[i] if i < len(cells) else "")
                     for i in range(len(header))})
    return rows


def parse_csv(csv_path):
    with open(csv_path, encoding="utf-8-sig") as fh:
        return rows_from_table(list(csv.reader(fh)))


# ---- normalization --------------------------------------------------------
def get(rec, *names):
    for n in names:
        for key in rec:
            if key.strip() == n:
                v = rec[key].strip()
                if v:
                    return v
    return ""


def parse_date(s):
    s = s.strip()
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def add_months(d, months):
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    day = min(d.day, [31, 29 if y % 4 == 0 and (y % 100 or not y % 400) else 28,
                      31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
    return datetime.date(y, m, day)


def parse_money(s):
    s = s.replace("£", "").replace(",", "").strip()
    if not s or s in {"-", "\\-"}:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def canonical_source(src):
    s = re.sub(r"\s+", " ", src).strip()
    low = s.lower()
    # treat blanks, header fragments and stray dates (column misalignment) as unrecorded
    if (low in NON_SOURCE or low in {"source", "date completed", "introducer/source"}
            or re.fullmatch(r"[\d/.\-]+", s)):
        return "Not recorded"
    if re.search(r"personal refer", low):
        return "Personal Referral"
    if re.search(r"professional refer", low):
        return "Professional Referral"
    if low in {"o'shea", "o’shea"}:
        return "O'Shea"
    return s


def norm_name_key(name):
    n = name.lower().replace("&", " and ")
    n = re.sub(r"[^a-z\s]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    parts = [p for p in n.split() if p != "and"]  # so "a and b" == "b and a"
    return " ".join(sorted(parts))


def extract_postcode(addr):
    m = re.search(r"\b([A-Z]{1,2}\d[A-Z\d]?)\s*\d[A-Z]{2}\b", addr.upper())
    return m.group(1) if m else ""


def postcode_area(pc):
    m = re.match(r"^([A-Z]{1,2})", pc)
    return m.group(1) if m else ""


PROT_PATTERNS = [
    ("IP", re.compile(r"income protection|\bip\b", re.I)),
    ("CIC", re.compile(r"critical illness|\bcic\b|life and cic", re.I)),
    ("Life", re.compile(r"\blife\b|life cover|life insurance", re.I)),
    ("ASU", re.compile(r"\basu\b|accident|sickness", re.I)),
    ("GI", re.compile(r"home and contents|buildings?|contents|home insurance|\bgi\b", re.I)),
]
MORTGAGE_PATTERNS = re.compile(
    r"remortgage|product transfer|\bpt\b|first time buyer|\bftb\b|home mover|"
    r"\bmover\b|purchase|house move|2nd charge|second charge|btl|buy to let", re.I)
REMO_PATTERNS = re.compile(r"remortgage|product transfer|\bpt\b", re.I)


def classify(biz, product):
    text = f"{biz} {product}".lower()
    is_mcr = "mcr" in text
    prot_types = set()
    for label, pat in PROT_PATTERNS:
        if pat.search(text):
            prot_types.add(label)
    if re.search(r"life and ci", text):  # "life and cic" implies both
        prot_types.update({"Life", "CIC"})
    is_protection = bool(prot_types) or "protection" == biz.strip().lower()
    is_mortgage = bool(MORTGAGE_PATTERNS.search(text)) and not is_protection
    if is_mcr:
        is_mortgage = is_protection = False
    return is_mortgage, is_protection, is_mcr, prot_types


def product_category(rec):
    if rec["is_mcr"]:
        return "MCR (capacity report)"
    text = f"{rec['biz']} {rec['product']}".lower()
    if rec["is_protection"]:
        pt = rec["prot_types"]
        if "IP" in pt:
            return "Income Protection"
        if "CIC" in pt:
            return "Critical Illness"
        if "Life" in pt:
            return "Life cover"
        if "GI" in pt:
            return "Buildings / Contents"
        return "Other protection"
    if re.search(r"remortgage", text):
        return "Remortgage"
    if re.search(r"product transfer|\bpt\b", text):
        return "Product Transfer"
    if re.search(r"first time buyer|\bftb\b", text):
        return "First Time Buyer"
    if re.search(r"purchase|home mover|\bmover\b|house move", text):
        return "Purchase / Mover"
    return "Other"


def build_records(raw_rows):
    recs = []
    for r in raw_rows:
        client = get(r, "Client Name", "Client")
        if not client:
            continue
        biz = get(r, "Type of Business")
        product = get(r, "Type of Product") or biz
        provider = get(r, "Provider/lender", "Protection/Provider/lender")
        addr = get(r, "Property")
        d = parse_date(get(r, "Date"))
        pc = extract_postcode(addr)
        is_m, is_p, is_mcr, ptypes = classify(biz, product)
        src = get(r, "Introducer/Source")
        num = re.search(r"\d+", addr)
        admin = get(r, "Administrator", "Admin")
        rec = {
            "addr_key": f"{pc}/{num.group()}" if pc and num else "",
            "date": d.isoformat() if d else "",
            "date_obj": d,
            "year": d.year if d else None,
            "month": d.strftime("%Y-%m") if d else "",
            "client": client,
            "key": norm_name_key(client),
            "admin": admin.title() if admin.lower() not in NON_ADVISER else "",
            "source": src,
            "source_norm": canonical_source(src),
            "property": addr,
            "postcode": pc,
            "area": postcode_area(pc),
            "biz": biz,
            "product": product,
            "provider": provider.title() if provider else "",
            "amount": parse_money(get(r, "Sum Assured/Mortgage Amount", "Sum Assured//Mortgage Amount")),
            "premium": parse_money(get(r, "Monthly Premium", "Protection and /GI")),
            "fee": parse_money(get(r, "Broker Fee", "Broker /Fee")),
            "comm_written": parse_money(get(r, "Commisison Written", "Commisison/Written")),
            "comm_received": parse_money(get(r, "Commission Received", "Commission /Received")),
            "is_mortgage": is_m,
            "is_protection": is_p,
            "is_mcr": is_mcr,
            "prot_types": sorted(ptypes),
            "lender_leak": product.strip().lower() in LENDERS,
        }
        rec["category"] = product_category(rec)
        recs.append(rec)
    return recs


# ---- cross-reference / BD lists ------------------------------------------
def link_households(recs):
    """Union-find: two records are the same household if they share a name key
    OR a property address (postcode + house number). Address linking catches
    joint-name protection vs single-name mortgage cases."""
    parent = list(range(len(recs)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    sig = defaultdict(list)
    for i, r in enumerate(recs):
        if r["key"]:
            sig["n:" + r["key"]].append(i)
        if r["addr_key"]:
            sig["a:" + r["addr_key"]].append(i)
    for idxs in sig.values():
        for j in idxs[1:]:
            union(idxs[0], j)
    for i, r in enumerate(recs):
        r["hh"] = find(i)
    return recs


def build_lists(recs):
    by_hh = defaultdict(list)
    for r in recs:
        by_hh[r["hh"]].append(r)

    protection_gap, life_only, pipeline = [], [], []
    today = datetime.date.today()

    for items in by_hh.values():
        mortgages = [i for i in items if i["is_mortgage"]]
        prots = [i for i in items if i["is_protection"]]
        ptypes = set()
        for p in prots:
            ptypes.update(p["prot_types"])
        display = max((i["client"] for i in items), key=len)

        if mortgages and not prots:
            latest = max(mortgages, key=lambda x: x["date_obj"] or datetime.date.min)
            protection_gap.append({
                "client": display, "property": latest["property"],
                "lender": latest["provider"], "amount": latest["amount"],
                "date": latest["date"], "admin": latest["admin"],
                "product": latest["product"],
                "action": "Book protection review (no cover on file)",
            })
        if "Life" in ptypes and not ({"CIC", "IP"} & ptypes):
            base = prots[0]
            life_only.append({
                "client": display, "property": base["property"],
                "have": "Life", "missing": "Critical Illness + Income Protection",
                "admin": base["admin"], "action": "Offer CIC / Income Protection top-up",
            })

    for r in recs:
        if r["date_obj"] and REMO_PATTERNS.search(f"{r['biz']} {r['product']}".lower()):
            review = add_months(r["date_obj"], TERM_MONTHS)
            pipeline.append({
                "client": r["client"], "property": r["property"],
                "lender": r["provider"], "amount": r["amount"],
                "completed": r["date"], "review_date": review.isoformat(),
                "overdue": review <= today,
                "days_to_review": (review - today).days,
                "admin": r["admin"], "product": r["product"],
                "action": "Remortgage review approaching maturity",
            })
    pipeline.sort(key=lambda x: x["review_date"])
    protection_gap.sort(key=lambda x: (x["amount"] or 0), reverse=True)
    return protection_gap, life_only, pipeline


def build_referrals(recs):
    agg = defaultdict(lambda: {"count": 0, "comm": 0.0, "clients": set()})
    for r in recs:
        a = agg[r["source_norm"]]
        a["count"] += 1
        a["comm"] += r["comm_written"] or 0
        a["clients"].add(r["client"])
    out = [{"source": s, "count": v["count"], "comm": round(v["comm"]),
            "clients": len(v["clients"])} for s, v in agg.items()]
    out.sort(key=lambda x: x["count"], reverse=True)
    return out


def build_cleanup(recs):
    raw_by_key = defaultdict(set)
    for r in recs:
        raw_by_key[r["key"]].add(r["client"])
    variants = {k: sorted(v) for k, v in raw_by_key.items() if len(v) > 1}
    issues = [{"type": "Name variants (same client)", "detail": " / ".join(names)}
              for names in (variants[k] for k in sorted(variants))]
    for r in recs:
        if r["lender_leak"]:
            issues.append({"type": "Lender in product column",
                           "detail": f'{r["client"]} — product="{r["product"]}"'})
    return issues, len(variants)


# ---- KPIs -----------------------------------------------------------------
def build_kpis(recs, protection_gap):
    by_hh = defaultdict(list)
    for r in recs:
        by_hh[r["hh"]].append(r)
    mort = {k for k, v in by_hh.items() if any(i["is_mortgage"] for i in v)}
    prot = {k for k, v in by_hh.items() if any(i["is_protection"] for i in v)}
    attached = mort & prot
    attach_rate = round(100 * len(attached) / len(mort)) if mort else 0
    recorded = sum(1 for r in recs if r["source_norm"] != "Not recorded")
    return {
        "total_rows": len(recs),
        "clients": len(by_hh),
        "mortgage_clients": len(mort),
        "protection_clients": len(prot),
        "attach_rate": attach_rate,
        "protection_gap": len(protection_gap),
        "mcr_cases": sum(1 for r in recs if r["is_mcr"]),
        "source_coverage": round(100 * recorded / len(recs)) if recs else 0,
        "comm_written": round(sum(r["comm_written"] or 0 for r in recs)),
        "comm_received": round(sum(r["comm_received"] or 0 for r in recs)),
    }


# ---- new analytics --------------------------------------------------------
def _count(recs, key, predicate=None, top=None):
    c = defaultdict(int)
    for r in recs:
        if predicate and not predicate(r):
            continue
        v = r[key]
        if v:
            c[v] += 1
    items = sorted(c.items(), key=lambda kv: kv[1], reverse=True)
    if top:
        items = items[:top]
    return [{"label": k, "value": v} for k, v in items]


def build_charts(recs):
    monthly = defaultdict(lambda: {"cases": 0, "mortgage": 0, "protection": 0,
                                   "comm_written": 0.0, "comm_received": 0.0})
    for r in recs:
        if not r["month"]:
            continue
        m = monthly[r["month"]]
        m["cases"] += 1
        m["mortgage"] += 1 if r["is_mortgage"] else 0
        m["protection"] += 1 if r["is_protection"] else 0
        m["comm_written"] += r["comm_written"] or 0
        m["comm_received"] += r["comm_received"] or 0
    months = [{"month": k, **{kk: round(vv) if "comm" in kk else vv
                              for kk, vv in v.items()}}
              for k, v in sorted(monthly.items())]
    return {
        "product_mix": _count(recs, "category"),
        "lenders": _count(recs, "provider", lambda r: r["is_mortgage"], top=12),
        "providers": _count(recs, "provider", lambda r: r["is_protection"], top=12),
        "areas": _count(recs, "area", top=12),
        "monthly": months,
    }


def build_adviser_performance(recs):
    """Per-adviser core metrics plus a monthly activity series aligned to a shared
    month axis (for sparklines, trends and leaver detection)."""
    advisers = defaultdict(lambda: {
        "cases": 0, "mortgage": 0, "protection": 0, "mcr": 0,
        "comm_written": 0.0, "comm_received": 0.0, "fee_sum": 0.0, "fee_n": 0,
        "completed": 0, "retentions": [], "months": defaultdict(int)})
    for r in recs:
        name = r["admin"]
        if not name:
            continue
        a = advisers[name]
        a["cases"] += 1
        a["mortgage"] += 1 if r["is_mortgage"] else 0
        a["protection"] += 1 if r["is_protection"] else 0
        a["mcr"] += 1 if r["is_mcr"] else 0
        a["comm_written"] += r["comm_written"] or 0
        a["comm_received"] += r["comm_received"] or 0
        if r["fee"]:
            a["fee_sum"] += r["fee"]
            a["fee_n"] += 1
        if r["is_mortgage"] and r["comm_received"]:
            a["completed"] += 1
        if r["comm_written"] and r["comm_received"]:
            a["retentions"].append(r["comm_received"] / r["comm_written"])
        if r["month"]:
            a["months"][r["month"]] += 1
    months_axis = sorted({r["month"] for r in recs if r["month"]})
    out = []
    for name, a in advisers.items():
        if a["cases"] < 3:
            continue
        ret = a["retentions"]
        active = sorted(a["months"])
        out.append({
            "adviser": name,
            "cases": a["cases"],
            "mortgage": a["mortgage"],
            "protection": a["protection"],
            "mcr": a["mcr"],
            "comm_written": round(a["comm_written"]),
            "comm_received": round(a["comm_received"]),
            "avg_comm": round(a["comm_written"] / a["cases"]) if a["cases"] else 0,
            "avg_fee": round(a["fee_sum"] / a["fee_n"]) if a["fee_n"] else 0,
            "protection_ratio": round(100 * a["protection"] / a["mortgage"]) if a["mortgage"] else 0,
            "conversion": round(100 * a["completed"] / a["mortgage"]) if a["mortgage"] else 0,
            "retention": round(100 * sum(ret) / len(ret)) if ret else 0,
            "first_active": active[0] if active else "",
            "last_active": active[-1] if active else "",
            "active_months": len(active),
            "monthly": [a["months"].get(m, 0) for m in months_axis],
        })
    out.sort(key=lambda x: x["comm_written"], reverse=True)
    return out, months_axis


def _median(vals):
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return 0
    n = len(vals)
    return vals[n // 2] if n % 2 else round((vals[n // 2 - 1] + vals[n // 2]) / 2)


def _month_diff(a, b):
    """Whole months from a to b ('YYYY-MM' strings)."""
    if not a or not b:
        return 0
    ya, ma = int(a[:4]), int(a[5:7])
    yb, mb = int(b[:4]), int(b[5:7])
    return (yb - ya) * 12 + (mb - ma)


# metric -> (friendly label, higher_is_better, coaching action when below benchmark)
_DEV_METRICS = {
    "protection_ratio": ("Protection attach", "Protection coaching — make a protection conversation standard on every mortgage case."),
    "conversion": ("Completion rate", "Pipeline review — applications aren't reaching completion; check process & follow-up."),
    "retention": ("Commission retention", "Reconciliation check — written vs received commission is leaking (clawbacks / chasing)."),
    "avg_fee": ("Average broker fee", "Pricing review — fees are below the team norm for the work done."),
    "avg_comm": ("Commission per case", "Case-mix review — steer toward higher-value cases / cross-sell."),
}


def build_team(advisers, months_axis, protection_gap, life_only, pipeline, opportunity):
    """Team benchmarks, per-adviser outstanding 'book' (for handover), status
    (active / new / dormant=likely leaver) and development opportunities."""
    bench = {m: _median([a[m] for a in advisers])
             for m in ("cases", "comm_written", "avg_comm", "avg_fee",
                       "protection_ratio", "conversion", "retention")}
    gap_by = Counter(g["admin"] for g in protection_gap if g["admin"])
    life_by = Counter(l["admin"] for l in life_only if l["admin"])
    pipe_due_by = Counter(p["admin"] for p in pipeline if p["admin"]
                          and (p["overdue"] or 0 <= p["days_to_review"] <= 180))
    avg_prot = opportunity["avg_protection_comm"]
    avg_fee_remo = opportunity["avg_remo_fee"]
    max_month = months_axis[-1] if months_axis else ""

    for a in advisers:
        name = a["adviser"]
        a["gap_clients"] = gap_by.get(name, 0)
        a["life_only_clients"] = life_by.get(name, 0)
        a["pipeline_due"] = pipe_due_by.get(name, 0)
        a["book_value"] = a["gap_clients"] * avg_prot + a["pipeline_due"] * avg_fee_remo
        idle = _month_diff(a["last_active"], max_month)
        a["idle_months"] = idle
        if idle >= DORMANT_MONTHS:
            a["status"] = "dormant"          # likely leaver / inactive
        elif _month_diff(a["first_active"], max_month) < DORMANT_MONTHS:
            a["status"] = "new"
        else:
            a["status"] = "active"
        opps = []
        for metric, (label, action) in _DEV_METRICS.items():
            val, ref = a[metric], bench[metric]
            if ref and val < ref * 0.85:        # meaningfully below the team median
                opps.append({"metric": metric, "label": label, "value": val,
                             "benchmark": ref, "gap": round(ref - val), "action": action})
        opps.sort(key=lambda o: o["benchmark"] - o["value"], reverse=True)
        a["opportunities"] = opps

    dormant = [a["adviser"] for a in advisers if a["status"] == "dormant"]
    return {"benchmarks": bench, "months": months_axis, "max_month": max_month,
            "dormant": dormant, "team_size": len(advisers)}


def build_pipeline_buckets(pipeline):
    buckets = defaultdict(lambda: {"count": 0, "overdue": 0, "amount": 0.0})
    for p in pipeline:
        m = p["review_date"][:7]
        b = buckets[m]
        b["count"] += 1
        b["overdue"] += 1 if p["overdue"] else 0
        b["amount"] += p["amount"] or 0
    return [{"month": k, "count": v["count"], "overdue": v["overdue"],
             "amount": round(v["amount"])} for k, v in sorted(buckets.items())]


def build_concentration(recs):
    mort = [r for r in recs if r["is_mortgage"] and r["provider"]]
    lender = _count(mort, "provider", top=1)
    area = _count(recs, "area", top=1)
    unattributed = sum(1 for r in recs if r["source_norm"] == "Not recorded")
    return {
        "top_lender": lender[0]["label"] if lender else None,
        "top_lender_share": round(100 * lender[0]["value"] / len(mort)) if mort and lender else 0,
        "top_area": area[0]["label"] if area else None,
        "top_area_share": round(100 * area[0]["value"] / len(recs)) if recs and area else 0,
        "unattributed_share": round(100 * unattributed / len(recs)) if recs else 0,
    }


def opportunity_sizing(recs, protection_gap, life_only, pipeline):
    prot_comms = [r["comm_written"] for r in recs if r["is_protection"] and r["comm_written"]]
    avg_prot = round(sum(prot_comms) / len(prot_comms)) if prot_comms else 0
    remo_fees = [r["fee"] for r in recs
                 if REMO_PATTERNS.search(f"{r['biz']} {r['product']}".lower()) and r["fee"]]
    avg_remo_fee = round(sum(remo_fees) / len(remo_fees)) if remo_fees else 0
    due_90 = [p for p in pipeline if 0 <= p["days_to_review"] <= 90 or p["overdue"]]
    return {
        "avg_protection_comm": avg_prot,
        "gap_clients": len(protection_gap),
        "gap_value": avg_prot * len(protection_gap),
        "life_only_clients": len(life_only),
        "life_only_value": avg_prot * len(life_only),
        "avg_remo_fee": avg_remo_fee,
        "due_90_count": len(due_90),
        "due_90_fee_value": avg_remo_fee * len(due_90),
    }


def data_quality_score(recs, variant_count, kpis):
    mort = [r for r in recs if r["is_mortgage"]]
    miss_amount = sum(1 for r in mort if not r["amount"])
    amount_pen = (miss_amount / len(mort) * 30) if mort else 0
    source_pen = (100 - kpis["source_coverage"]) / 100 * 40
    variant_pen = min(variant_count, 20) / 20 * 20
    score = max(0, round(100 - source_pen - amount_pen - variant_pen))
    return {
        "score": score,
        "missing_source_pct": 100 - kpis["source_coverage"],
        "missing_amount_pct": round(100 * miss_amount / len(mort)) if mort else 0,
        "name_variants": variant_count,
    }


def _gbp(n):
    return f"£{round(n):,}"


def build_insights(kpis, opp, conc, referrals, quality, pipeline):
    cards = []
    lo, hi = ATTACH_BENCHMARK

    cards.append({
        "severity": "high", "impact": opp["gap_value"],
        "title": "Protection cross-sell is your biggest opportunity",
        "metric": _gbp(opp["gap_value"]) + " est. commission",
        "detail": f"{opp['gap_clients']} mortgage clients have no protection on file. "
                  f"At your average protection commission of {_gbp(opp['avg_protection_comm'])}, "
                  f"converting them is worth ~{_gbp(opp['gap_value'])} (≈"
                  f"{_gbp(opp['gap_value'] / 2)} at a 50% hit-rate).",
        "action": "Run a protection-review campaign against the cross-sell list, largest loans first.",
    })
    if opp["due_90_count"]:
        cards.append({
            "severity": "high", "impact": opp["due_90_fee_value"],
            "title": "Remortgage revenue is due now",
            "metric": f"{opp['due_90_count']} reviews · {_gbp(opp['due_90_fee_value'])} fees",
            "detail": f"{opp['due_90_count']} remortgage/product-transfer reviews are due or overdue "
                      f"within 90 days, ~{_gbp(opp['due_90_fee_value'])} in broker fees alone.",
            "action": "Bulk-add the due cohort to your calendar from the Pipeline tab and start outreach.",
        })
    attach = kpis["attach_rate"] / 100
    cards.append({
        "severity": "medium" if attach < lo else "low",
        "impact": opp["gap_value"] * 0.5,
        "title": "Protection attach rate below benchmark",
        "metric": f"{kpis['attach_rate']}% vs {int(lo*100)}–{int(hi*100)}% typical",
        "detail": f"Only {kpis['attach_rate']}% of mortgage clients hold protection with you, "
                  f"below the {int(lo*100)}–{int(hi*100)}% range typical for advised mortgage books.",
        "action": "Make a protection conversation a standard step on every mortgage case.",
    })
    cards.append({
        "severity": "medium" if conc["unattributed_share"] >= 50 else "low",
        "impact": 0,  # data-hygiene issue, not a direct £ opportunity — keep below revenue cards
        "title": "Most business has no recorded source",
        "metric": f"{conc['unattributed_share']}% unattributed",
        "detail": f"{conc['unattributed_share']}% of cases have no introducer recorded, so you can't "
                  f"see which partners actually drive revenue.",
        "action": "Make the introducer field mandatory at case setup.",
    })
    if conc["top_lender_share"] >= 25:
        cards.append({
            "severity": "low", "impact": 0,
            "title": "Lender concentration",
            "metric": f"{conc['top_lender']} {conc['top_lender_share']}%",
            "detail": f"{conc['top_lender']} accounts for {conc['top_lender_share']}% of your mortgage "
                      f"placements — worth diversifying for resilience.",
            "action": "Review panel spread; ensure best-advice across a wider lender set.",
        })
    if opp["life_only_clients"]:
        cards.append({
            "severity": "medium", "impact": opp["life_only_value"],
            "title": "Quick wins: life-only clients",
            "metric": f"{opp['life_only_clients']} clients · {_gbp(opp['life_only_value'])}",
            "detail": f"{opp['life_only_clients']} clients hold life cover but no critical-illness or "
                      f"income protection — the easiest top-up conversations.",
            "action": "Call the life-only list to review CIC / income protection.",
        })
    top_intro = next((r for r in referrals if r["source"] != "Not recorded"), None)
    if top_intro:
        cards.append({
            "severity": "low", "impact": top_intro["comm"],
            "title": "Formalise your top introducer",
            "metric": f"{top_intro['source']} · {top_intro['count']} cases",
            "detail": f"{top_intro['source']} is your highest-volume recorded introducer "
                      f"({top_intro['count']} cases). Protect and grow that relationship.",
            "action": "Put a simple referral agreement and regular check-in in place.",
        })
    cards.append({
        "severity": "low" if quality["score"] >= 70 else "medium",
        "impact": 0,
        "title": "Data quality affects every insight",
        "metric": f"{quality['score']}/100",
        "detail": f"{quality['missing_source_pct']}% of rows lack a source, "
                  f"{quality['missing_amount_pct']}% of mortgages lack a loan amount, and "
                  f"{quality['name_variants']} clients appear under multiple spellings.",
        "action": "Tidy names, sources and amounts so cross-referencing and forecasts get sharper.",
    })
    cards.sort(key=lambda c: c["impact"], reverse=True)
    return cards


# ---- export-safe records --------------------------------------------------
_EXPORT_FIELDS = ("date", "year", "month", "client", "admin", "source_norm",
                  "property", "postcode", "area", "biz", "product", "category",
                  "provider", "amount", "premium", "fee", "comm_written",
                  "comm_received", "is_mortgage", "is_protection", "is_mcr",
                  "prot_types", "hh")


def _export_records(recs):
    return [{k: r[k] for k in _EXPORT_FIELDS} for r in recs]


# ---- entry point ----------------------------------------------------------
def analyse(raw_rows):
    """Run the full pipeline and return a JSON-serialisable analysis dict."""
    recs = build_records(raw_rows)
    link_households(recs)
    protection_gap, life_only, pipeline = build_lists(recs)
    referrals = build_referrals(recs)
    cleanup, variant_count = build_cleanup(recs)
    kpis = build_kpis(recs, protection_gap)
    charts = build_charts(recs)
    adviser, adviser_months = build_adviser_performance(recs)
    pipeline_buckets = build_pipeline_buckets(pipeline)
    concentration = build_concentration(recs)
    opportunity = opportunity_sizing(recs, protection_gap, life_only, pipeline)
    team = build_team(adviser, adviser_months, protection_gap, life_only, pipeline, opportunity)
    quality = data_quality_score(recs, variant_count, kpis)
    insights = build_insights(kpis, opportunity, concentration, referrals, quality, pipeline)

    years = sorted({r["year"] for r in recs if r["year"]})
    advisers = sorted({r["admin"] for r in recs if r["admin"]})
    biz_types = sorted({r["biz"] for r in recs if r["biz"]})

    return {
        "generated": datetime.datetime.now().isoformat(timespec="seconds"),
        "term_months": TERM_MONTHS,
        "kpis": kpis,
        "insights": insights,
        "opportunity": opportunity,
        "concentration": concentration,
        "quality": quality,
        "protection_gap": protection_gap,
        "life_only": life_only,
        "pipeline": pipeline,
        "pipeline_buckets": pipeline_buckets,
        "referrals": referrals,
        "cleanup": cleanup,
        "cleanup_variant_count": variant_count,
        "adviser": adviser,
        "team": team,
        "charts": charts,
        "records": _export_records(recs),
        "filters": {"years": years, "advisers": advisers, "biz_types": biz_types},
    }
