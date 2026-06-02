"""
mortgage_oasis.combined — assemble the full dashboard payload from all sources:
the Google-Sheet case-log (BD/admin layer) plus the Acre CRM reports (CRM truth),
with fuzzy Sheet<->Acre match proposals for the user to confirm.
"""
import os

from . import analytics, acre


def analyse_all(sheet_rows, acre_dir=None):
    data = analytics.analyse(sheet_rows)           # sheet analysis stays at top level
    reports = acre.load_acre_dir(acre_dir) if acre_dir and os.path.isdir(acre_dir) else {}
    if reports:
        ac = acre.analyse(reports)
        cases = ac.pop("_cases", [])               # internal; not serialised
        recs = analytics.build_records(sheet_rows)  # has date_obj for matching
        data["acre"] = ac
        data["matches"] = acre.propose_matches(recs, cases)
    else:
        data["acre"] = None
        data["matches"] = []
    return data
