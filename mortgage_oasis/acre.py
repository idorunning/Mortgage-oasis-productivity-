"""
mortgage_oasis.acre — ingest Acre CRM report CSVs and compute the CRM analytics
that power the dashboard's pipeline / protection / rate-review / revenue /
performance / lender / introducer / compliance views.

Reports are detected by filename keyword (the export naming is stable). The
case-level "master" prefers the Extended-Marketing report (it carries client PII
+ all case fields); otherwise Combined Case Details. Everything returned is
JSON-serialisable.

Also provides `propose_matches()` — fuzzy links Google-Sheet case-log records to
Acre cases (name + amount + date) for the user to confirm in the UI.
"""
import os
import csv
import glob
import re
import datetime
from collections import defaultdict, Counter

from .analytics import parse_money, parse_date, norm_name_key, extract_postcode, postcode_area

# filename keyword -> report key  (first match wins; order matters)
REPORT_PATTERNS = [
    ("extended_marketing", ("extended_marketing",)),
    ("marketing", ("combined_case_details_marketing",)),
    ("combined", ("combined_case_details",)),
    ("submissions", ("acr-024", "allsubmissions", "all_submissions")),
    ("hp", ("health_and_protection",)),
    ("high_risk", ("high_risk",)),
    ("introducer_lead", ("introducer_lead",)),
    ("lender_position", ("lender_position",)),
    ("lender_stats", ("lender_statistics",)),
    ("rollbacks", ("rollback",)),
    ("rate_review", ("rate_review", "ratereview")),
    ("pipeline_summary", ("pipeline_summary",)),
    ("processing_times", ("processingtimes", "processing_times", "acr-001")),
]

COMPLETED = {"complete", "imported complete"}
MORTGAGE_TYPES = {"remortgage", "ftb or purchase only", "house move",
                  "buy-to-let remortgage", "buy-to-let", "product transfer"}


def detect_report(filename):
    base = os.path.basename(filename).lower()
    for key, kws in REPORT_PATTERNS:
        if any(kw in base for kw in kws):
            return key
    return None


def _read_csv(path):
    with open(path, encoding="utf-8-sig") as fh:
        return [{(k or "").strip(): (v or "").strip() for k, v in row.items()}
                for row in csv.DictReader(fh)]


def load_acre_dir(path):
    """Return {report_key: [row dicts]} for every recognised CSV in a folder."""
    reports = {}
    for f in sorted(glob.glob(os.path.join(path, "*.csv"))):
        key = detect_report(f)
        if key and key not in reports:        # first file of each type wins
            reports[key] = _read_csv(f)
    return reports


def _g(row, *names):
    for n in names:
        if n in row and row[n] != "":
            return row[n]
    return ""


def _master(reports):
    """Case-level rows (deduped by Case id), preferring the PII-rich report."""
    src = reports.get("extended_marketing") or reports.get("marketing") or reports.get("combined") or []
    seen, out = set(), []
    for r in src:
        cid = _g(r, "Case id")
        if cid and cid in seen:
            continue
        if cid:
            seen.add(cid)
        out.append(r)
    return out


def _case(r):
    first, last = _g(r, "First name"), _g(r, "Last name")
    name = (first + " " + last).strip()
    d = parse_date(_g(r, "Created at")[:10]) or parse_date(_g(r, "Completion date")[:10])
    pc = _g(r, "Postcode") or extract_postcode(" ".join(_g(r, "Address1", "Address2", "Address3")))
    status = _g(r, "Case status")
    ctype = _g(r, "Case type")
    return {
        "case_id": _g(r, "Case id"),
        "adviser": _g(r, "Advisor name"),
        "client": name,
        "name_key": norm_name_key(name) if name else "",
        "postcode": pc, "area": postcode_area(pc),
        "ctype": ctype,
        "status": status,
        "completed": status.lower() in COMPLETED,
        "not_proceeding": status == "Not Proceeding",
        "is_mortgage": ctype.lower() in MORTGAGE_TYPES,
        "amount": parse_money(_g(r, "Mortgage amount")) or 0,
        "proc_fee": parse_money(_g(r, "Gross mortgage proc fee", "Gross proc fee")) or 0,
        "broker_fee": parse_money(_g(r, "Total broker fees", "Case fees")) or 0,
        "protection": _g(r, "Combined protection").lower() == "true",
        "prot_comm": parse_money(_g(r, "Total protection initial monthly commission")) or 0,
        "gi_comm": parse_money(_g(r, "Total gi commission")) or 0,
        "introducer": _g(r, "Introducer name"),
        "created_month": (_g(r, "Created at")[:7] or (d.strftime("%Y-%m") if d else "")),
        "completion_date": _g(r, "Completion date")[:10],
        "completion_month": _g(r, "Completion date")[:7],
        "np_reason": _g(r, "Not proceeding reason"),
        "date_obj": d,
    }


# ---- analytics ------------------------------------------------------------
FUNNEL = ["Lead", "Pre-recommendation", "Pre-application", "Application Submitted",
          "Application Offer", "Offer Received", "Exchange", "Complete"]


def _series(counter, top=None):
    items = sorted(counter.items(), key=lambda kv: kv[1], reverse=True)
    if top:
        items = items[:top]
    return [{"label": k or "—", "value": v} for k, v in items]


def analyse(reports):
    if not reports:
        return None
    cases = [_case(r) for r in _master(reports)]
    mort = [c for c in cases if c["is_mortgage"]]
    completed = [c for c in cases if c["completed"]]
    np = [c for c in cases if c["not_proceeding"]]
    prot_true = sum(1 for c in cases if c["protection"])
    gi = sum(1 for c in cases if c["gi_comm"] > 0)
    total = len(cases) or 1

    kpis = {
        "cases": len(cases),
        "advisers": len(set(c["adviser"] for c in cases if c["adviser"])),
        "completed": len(completed),
        "not_proceeding": len(np),
        "in_progress": len(cases) - len(completed) - len(np),
        "completion_rate": round(100 * len(completed) / (len(completed) + len(np))) if (len(completed) + len(np)) else 0,
        "attach_rate": round(100 * prot_true / total),
        "gi_rate": round(100 * gi / total, 1),
        "proc_fees": round(sum(c["proc_fee"] for c in cases)),
        "broker_fees": round(sum(c["broker_fee"] for c in cases)),
    }

    # pipeline / funnel
    status_counts = Counter(c["status"] for c in cases)
    funnel = [{"label": s, "value": status_counts.get(s, 0)} for s in FUNNEL if status_counts.get(s, 0)]
    funnel.insert(0, {"label": "All cases", "value": len(cases)})
    pipeline = {
        "status": _series(status_counts),
        "funnel": funnel,
        "not_proceeding_reasons": _series(Counter(c["np_reason"] for c in np if c["np_reason"])),
        "rollbacks": len(reports.get("rollbacks", [])),
        "by_type": _series(Counter(c["ctype"] for c in cases)),
    }

    # protection & cross-sell — Acre's "Combined protection" flag is true on most
    # mortgage cases, so the real gap is completed mortgage clients with NO policy
    # in the Health & Protection report.
    protected = set()
    for r in reports.get("hp", []):
        k = norm_name_key((_g(r, "First name") + " " + _g(r, "Last name")).strip())
        if k:
            protected.add(k)
    if protected:
        gap = [c for c in mort if c["completed"] and c["name_key"] and c["name_key"] not in protected]
    else:  # no H&P report loaded -> fall back to the combined-protection flag
        gap = [c for c in mort if c["completed"] and not c["protection"]]
    cross = [{"client": c["client"] or "(name in PII report)", "adviser": c["adviser"],
              "ctype": c["ctype"], "amount": c["amount"], "status": c["status"],
              "completion": c["completion_date"], "postcode": c["postcode"]}
             for c in gap]
    cross.sort(key=lambda x: x["amount"], reverse=True)
    protection = {
        "attach_rate": kpis["attach_rate"], "gi_rate": kpis["gi_rate"],
        "with_protection": prot_true, "without_protection": total - prot_true,
        "hp_policies": len(reports.get("hp", [])),
        "cross_sell": cross,
        "prot_comm_monthly": round(sum(c["prot_comm"] for c in cases)),
    }

    # rate reviews (real maturities)
    rr = reports.get("rate_review", [])
    today = datetime.date.today()
    rrows = []
    for r in rr:
        end = parse_date(_g(r, "Initial rate end date")[:10])
        rrows.append({
            "adviser": _g(r, "Advisor name"), "lender": _g(r, "Lender name"),
            "end_date": end.isoformat() if end else "", "status": _g(r, "Status"),
            "reminder": _g(r, "Reminder status") or "None",
            "days": (end - today).days if end else None,
        })
    rrows = [x for x in rrows if x["end_date"]]
    rrows.sort(key=lambda x: x["end_date"])
    rr_buckets = Counter(x["end_date"][:7] for x in rrows)
    rate_reviews = {
        "rows": rrows,
        "buckets": [{"label": k, "value": v} for k, v in sorted(rr_buckets.items())],
        "reminder_status": _series(Counter(x["reminder"] for x in rrows)),
        "upcoming_6m": sum(1 for x in rrows if x["days"] is not None and 0 <= x["days"] <= 180),
        "overdue": sum(1 for x in rrows if x["days"] is not None and x["days"] < 0),
    }

    # revenue & performance
    ps = reports.get("pipeline_summary", [])
    adv = defaultdict(lambda: defaultdict(float))
    for r in ps:
        a = adv[_g(r, "Advisor name")]
        for k, col in [("mortgages", "Mortgages"), ("completed_mortgages", "Completed mortgages"),
                       ("proc_fees", "Mortgage proc fees"), ("completed_proc_fees", "Completed proc fees"),
                       ("protection_cases", "Protection cases"), ("protection_fees", "Protection proc fees"),
                       ("gi_fees", "Gi proc fees"), ("clawbacks", "Clawbacks"),
                       ("case_fees", "Case fees"),
                       ("conveyancing", "Conveyancing referral fees"), ("will", "Will referral fees"),
                       ("valuation", "Valuation referral fees")]:
            adv[_g(r, "Advisor name")][k] += parse_money(_g(r, col)) or 0
    advisers = [{"adviser": name, **{k: round(v) for k, v in d.items()}} for name, d in adv.items() if name]
    advisers.sort(key=lambda x: x.get("proc_fees", 0), reverse=True)

    monthly = defaultdict(lambda: {"proc": 0.0, "cases": 0})
    for c in completed:
        if c["completion_month"]:
            monthly[c["completion_month"]]["proc"] += c["proc_fee"]
            monthly[c["completion_month"]]["cases"] += 1
    revenue = {
        "advisers": advisers,
        "monthly": [{"month": k, "proc": round(v["proc"]), "cases": v["cases"]} for k, v in sorted(monthly.items())],
        "referral_total": round(sum(a.get("conveyancing", 0) + a.get("will", 0) + a.get("valuation", 0) for a in advisers)),
        "clawbacks_total": round(sum(a.get("clawbacks", 0) for a in advisers)),
    }

    # processing times (ACR-001)
    pt = defaultdict(lambda: defaultdict(list))
    for r in reports.get("processing_times", []):
        for k, col in [("rec", "Days taken to recommendation"), ("app", "Days taken to application"),
                       ("offer", "Days taken to offer"), ("complete", "Days taken to complete")]:
            v = parse_money(_g(r, col))
            if v is not None:
                pt[_g(r, "Advisor name")][k].append(v)
    processing = [{"adviser": name, **{k: round(sum(vs) / len(vs)) for k, vs in d.items() if vs}}
                  for name, d in pt.items() if name]

    # lenders
    lp = defaultdict(lambda: {"cases": 0, "amount": 0.0, "proc": 0.0})
    for r in reports.get("lender_position", []):
        l = lp[_g(r, "Lender name")]
        l["cases"] += int(parse_money(_g(r, "Cases")) or 0)
        l["amount"] += parse_money(_g(r, "Mortgage amount")) or 0
        l["proc"] += parse_money(_g(r, "Gross proc fee")) or 0
    lenders = [{"lender": k, "cases": v["cases"], "amount": round(v["amount"]), "proc": round(v["proc"])}
               for k, v in lp.items() if k]
    lenders.sort(key=lambda x: x["cases"], reverse=True)

    # introducers
    intro = Counter()
    for r in reports.get("introducer_lead", []):
        nm = _g(r, "Introducer")
        if nm:
            intro[nm] += int(parse_money(_g(r, "Count")) or 0)
    introducers = _series(intro, top=15)

    # compliance (high risk)
    hr = reports.get("high_risk", [])
    reviewed = sum(1 for r in hr if _g(r, "Is reviewed").lower() == "true")
    passed = sum(1 for r in hr if _g(r, "Review passed").lower() == "true")
    needs = sum(1 for r in hr if _g(r, "Review required").lower() == "true" and _g(r, "Is reviewed").lower() != "true")
    compliance = {
        "flagged": len(hr), "reviewed": reviewed, "passed": passed, "outstanding": needs,
        "flag_types": _series(Counter(_g(r, "Flag type") for r in hr if _g(r, "Flag type")), top=12),
    }

    return {
        "kpis": kpis, "pipeline": pipeline, "protection": protection,
        "rate_reviews": rate_reviews, "revenue": revenue, "processing": processing,
        "lenders": lenders, "introducers": introducers, "compliance": compliance,
        "reports_loaded": sorted(reports.keys()),
        "_cases": cases,  # internal, stripped before serialising
    }


# ---- fuzzy matching: Sheet case-log <-> Acre cases -----------------------
def _surnames(name_key):
    return set(name_key.split())


def propose_matches(sheet_recs, acre_cases, limit=200):
    """Suggest Sheet<->Acre links by surname overlap + amount + date proximity."""
    acre = [c for c in acre_cases if c["name_key"] and c["amount"]]
    out = []
    for s in sheet_recs:
        skey = s.get("key", "")
        if not skey:
            continue
        ssur = _surnames(skey)
        samt = s.get("amount") or 0
        sdate = s.get("date_obj")
        best, best_score = None, 0
        for c in acre:
            shared = ssur & _surnames(c["name_key"])
            if not shared:
                continue
            name_score = len(shared) / max(len(ssur | _surnames(c["name_key"])), 1)
            amt_score = 0
            if samt and c["amount"]:
                amt_score = max(0, 1 - abs(samt - c["amount"]) / max(samt, c["amount"]))
            date_score = 0
            if sdate and c["date_obj"]:
                dd = abs((sdate - c["date_obj"]).days)
                date_score = max(0, 1 - dd / 365)
            score = name_score * 0.6 + amt_score * 0.25 + date_score * 0.15
            if score > best_score:
                best, best_score = c, score
        if best and best_score >= 0.5:
            out.append({
                "score": round(best_score, 2),
                "sheet": {"client": s["client"], "amount": s.get("amount"), "date": s.get("date"),
                          "admin": s.get("admin"), "postcode": s.get("postcode")},
                "acre": {"case_id": best["case_id"], "client": best["client"], "amount": best["amount"],
                         "adviser": best["adviser"], "completion": best["completion_date"],
                         "ctype": best["ctype"], "postcode": best["postcode"]},
            })
    out.sort(key=lambda x: x["score"], reverse=True)
    return out[:limit]
