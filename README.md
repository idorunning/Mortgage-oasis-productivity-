# Mortgage Oasis — Productivity & BD Tools

Tools for turning the Mortgage Oasis case-log spreadsheet into business-development
insights and a planning dashboard.

## `build_dashboard.py`

Generates a single, self-contained, **offline** `dashboard.html` (no server, no internet
required — just double-click the file) plus a plain-text report body. The dashboard surfaces:

- **KPIs** — cases, clients, protection-attach rate, no-protection clients, MCR cases, source coverage
- **Protection cross-sell** — mortgage clients with no protection on file (warmest leads)
- **Life-only upsell** — clients with Life but missing Critical Illness / Income Protection
- **Remortgage pipeline** — remortgages & product transfers sorted by suggested review date
- **Referral channels** — introducer volumes and the MCR ↔ family-law referral line
- **Data clean-up** — name-variant merges and lender-in-product leakage to fix

It cross-references records into **households** using a union-find over the client name *and*
the property address (postcode + house number), so a joint-name mortgage links to a
single-name protection policy at the same address.

### Calendar / reminders (bulk)

The dashboard works entirely client-side:

- Tick rows and **"Download selected as .ics"** to get one calendar file (with reminders)
  you import into Google Calendar / Outlook / Apple Calendar in a single action.
- Or **"Open selected in Google Calendar"** to launch pre-filled event templates.
- "Done" ticks are remembered in your browser (`localStorage`).

### Usage

```bash
# From a Google Sheets CSV export (File → Download → Comma-separated values):
python3 build_dashboard.py --csv mortgage-oasis-export.csv --out dashboard.html
```

This writes `dashboard.html` (open it locally) and `report.txt` (narrative report body).

### Assumptions

- **Remortgage review dates** = completion date + `TERM_MONTHS` (default **21 months**,
  i.e. a 2-year product reviewed ~3 months before maturity). The sheet does not record the
  fixed term — edit `TERM_MONTHS` at the top of the script to match your typical product.

## Privacy

The generated `dashboard.html` and `report.txt` contain client names and addresses, so they
are **git-ignored** and never committed. Keep them on your own machine. Only the generator
script and docs live in this repo.
