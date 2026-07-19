# Mortgage Oasis — website & admin dashboard

Static website for Mortgage Oasis with a commission dashboard at `/admin`.

## Structure

| Path | What it is |
|---|---|
| `index.html` | Public landing page (placeholder until the real site is built) |
| `admin/` | Admin dashboard — commission tracker + consolidation statements |
| `data/tracker.json` | Extracted from the **Tracker** Google Sheet (Business Register 2024/2025/2026 tabs) |
| `data/statements.json` | Extracted from the weekly TRM **commission consolidation statements** (Drive: `commision/Statements/<year>/<month>`) |
| `scripts/` | Data extraction / refresh scripts |

## Running locally

The dashboard loads its data with `fetch()`, so serve the folder over HTTP:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/admin/
```

## The dashboard

Three views, all filterable by year (top-right):

- **Overview** — KPI tiles (commission written vs received, outstanding pipeline,
  broker fees, statement income), monthly written-vs-received chart, statement
  income by month, business-type and provider breakdowns.
- **Commission tracker** — every case from the Business Register tabs with
  search and filters (business type, administrator, status). "Written" is the
  predicted commission; "Received" is what has actually come in.
- **Statements** — weekly consolidation statements with monthly totals and
  per-statement line items (click a row to expand).

## Refreshing the data

1. **Tracker**: download the Tracker Google Sheet as `.xlsx`
   (File → Download → Microsoft Excel), then:

   ```bash
   python3 scripts/extract_tracker.py Tracker.xlsx data/tracker.json
   ```

   Requires `pip install openpyxl`. If a new year tab is added (e.g.
   "Business Register 2027"), add its column layout to `LAYOUTS` in the script.

2. **Statements**: parse each year's statement workbooks into
   `statements_<year>.json` (same parsing used to build the current data — each
   workbook has a `Total:` cell, a `Date:` cell and an item table starting at the
   `Adviser` header row), then merge:

   ```bash
   python3 scripts/merge_statements.py statements_2024.json statements_2025.json statements_2026.json -o data/statements.json
   ```

## ⚠️ Before the website goes live

The admin page is **deliberately not password-protected yet** (dashboard-first,
auth later, as agreed). `data/*.json` contains client names, addresses and
commission amounts, so before pointing a public domain at this site:

1. Add hosting-level protection on `/admin/*` **and** `/data/*`
   (Netlify basic auth / Cloudflare Access / nginx `auth_basic` — see the notes
   in `admin/assets/auth.js`). A client-side password alone is not enough,
   because the JSON files would still be directly downloadable.
2. Optionally enable the client-side gate in `admin/assets/auth.js` as a
   convenience second layer.
