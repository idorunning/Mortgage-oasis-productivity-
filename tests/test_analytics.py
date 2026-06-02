"""Unit tests for the analytics engine (run: pytest)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from mortgage_oasis import analytics


def row(date, client, biz, product, provider="", amount="", addr="", premium="",
        source="", admin="Ange"):
    return {
        "Date": date, "Client Name": client, "Administrator": admin,
        "Introducer/Source": source, "Property": addr, "Type of Business": biz,
        "Type of Product": product, "Provider/lender": provider,
        "Sum Assured/Mortgage Amount": amount, "Monthly Premium": premium,
        "Broker Fee": "376", "Commisison Written": "500",
        "Commission Received": "450",
    }


def test_classify_basic():
    assert analytics.classify("Residential", "Remortgage")[0] is True       # mortgage
    assert analytics.classify("Protection", "Life Insurance")[1] is True    # protection
    assert analytics.classify("Residential", "MCR")[2] is True             # mcr
    # mortgage and protection are mutually exclusive
    is_m, is_p, _, _ = analytics.classify("Protection", "Income Protection")
    assert is_p and not is_m


def test_household_linking_by_address():
    rows = [
        row("08/01/2026", "Jessica Kirk and Kameron Duxbury", "Residential",
            "First Time Buyer", "Skipton", "235000", "7 Quarely Road, PO9 4DU"),
        row("26/02/2026", "Jessica Kirk", "Protection", "Income Protection",
            "Aviva", "235000", "7 Quarely Road, PO9 4DU", premium="22"),
        row("26/02/2026", "Jessica Kirk and Kameron Duxbury", "Protection",
            "Life Insurance", "Legal and General", "235000", "7 Quarely Road, PO9 4DU", premium="17"),
    ]
    recs = analytics.build_records(rows)
    analytics.link_households(recs)
    assert len({r["hh"] for r in recs}) == 1  # one household despite name differences
    gap, life_only, _ = analytics.build_lists(recs)
    names = {g["client"] for g in gap} | {l["client"] for l in life_only}
    assert not names  # well-covered (mortgage + life + IP): in neither list


def test_protection_gap_and_life_only():
    rows = [
        row("15/01/2026", "John Smith", "Residential", "Remortgage", "Halifax",
            "200000", "1 Test Road, PO1 1AA"),
        row("16/01/2026", "Jane Doe", "Residential", "Purchase", "Barclays",
            "300000", "2 Test Road, PO2 2BB"),
        row("20/01/2026", "Jane Doe", "Protection", "Life Insurance", "Aviva",
            "300000", "2 Test Road, PO2 2BB", premium="15"),
    ]
    recs = analytics.build_records(rows)
    analytics.link_households(recs)
    gap, life_only, _ = analytics.build_lists(recs)
    assert "John Smith" in {g["client"] for g in gap}        # no protection -> gap
    assert "Jane Doe" not in {g["client"] for g in gap}
    assert "Jane Doe" in {l["client"] for l in life_only}    # life only -> upsell


def test_pipeline_review_date_offset():
    rows = [row("13/05/2025", "Remo Client", "Residential", "Remortgage",
                "NatWest", "150000", "9 Road, PO9 9ZZ")]
    recs = analytics.build_records(rows)
    analytics.link_households(recs)
    _, _, pipeline = analytics.build_lists(recs)
    assert len(pipeline) == 1
    # completion + TERM_MONTHS (21) -> Feb 2027
    assert pipeline[0]["review_date"].startswith("2027-02")


def test_analyse_shape():
    rows = [row("13/05/2025", "A Client", "Residential", "Remortgage", "NatWest",
                "150000", "9 Road, PO9 9ZZ")]
    data = analytics.analyse(rows)
    for key in ("kpis", "insights", "opportunity", "adviser", "pipeline_buckets",
                "charts", "records", "filters", "quality"):
        assert key in data
    assert data["kpis"]["total_rows"] == 1
    assert isinstance(data["insights"], list) and data["insights"]
