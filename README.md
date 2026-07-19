# Mortgage Oasis — commission dashboard

Commission dashboard for Mortgage Oasis. **Distributed as a local file, not
hosted** — for data-control reasons the client data must stay on the owner's
own machine (or a private synced folder), so the deliverable is a single
self-contained HTML file:

```bash
python3 scripts/build_local.py       # -> MortgageOasis-Dashboard.html
```

Double-click `MortgageOasis-Dashboard.html` to open it — no server, no
internet needed. Keep it in a Google Drive / OneDrive synced folder if you
want it backed up; open the synced local copy via Drive for desktop (Drive's
web preview doesn't run JavaScript). Rebuild and replace the file after each
data refresh. The repo also contains the same dashboard as a small static
site (below) for development.

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
- **Reconciliation** — matches statement payments to tracker cases
  automatically (by client surname, provider, amount and date) and highlights:
  - **Outstanding** commission (written, nothing paid yet)
  - **Overdue** — outstanding longer than the *time limit* slider
  - **Variance flags** — paid amount differing from predicted by more than the
    *variance* slider
  - Payments on statements with no tracker match, and statement-matched
    payments not yet recorded in the sheet's Commission Received column

  Both thresholds are sliding scales on the Reconciliation view; they apply
  across the dashboard (the tracker table shows the same Overdue/variance
  badges) and are remembered per device.
- **Recurring income** — monthly totals of the drip income on the statements,
  split by class: **NI** (non-indemnity) and **R** (recurring trail). GI-type
  items are hidden by default behind an "Include GI" toggle. (Classes on the
  statements: M = mortgage, I = insurance, NI = non-indemnity, R = recurring.)
- **Statements** — weekly consolidation statements with monthly totals and
  per-statement line items (click a row to expand).

### Chasing overdue commission

Overdue rows on the Reconciliation view have a **Chase** button. It opens Gmail
with a formal chase email to the network pre-filled (client, reference,
provider, amount due, days outstanding — edit before sending) and records the
chase, showing *Chased &lt;date&gt; · follow up &lt;date + 1 week&gt;*. Once the
follow-up date passes with the commission still outstanding, the row is badged
**Follow up due** and the button becomes **Chase again**. Chase history is
stored per device (localStorage), like the threshold sliders. The recipient
address is `CHASE_TO` near the top of the chase section in
`admin/assets/app.js`.

## Monthly routine: dropping in new statements

1. File the new weekly statement workbooks in Drive under
   `commision/Statements/<year>/<month>` as usual.
2. Re-run the extraction for that year and re-merge (step 2 below).
3. Publish the updated `data/statements.json`.

That's it — matching happens in the browser when the page loads, so new
payments automatically flip cases from *Awaiting* to *Paid (stmt)*, clear
overdue flags, and appear in the reconciliation tables.

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

## ⚠️ Data protection — keep it local

`data/*.json` (and the built HTML file) contain client names, addresses and
commission amounts. **Do not deploy this dashboard or its data to any public
website or hosting service.** The intended distribution is the single local
HTML file above, kept on the owner's own machines / private synced storage,
plus this private repository.

If hosting is ever reconsidered, it must come with hosting-level access
control on the whole site (see the notes in `admin/assets/auth.js` — a
client-side password alone is not enough, since the JSON files would still be
directly downloadable).

Note: the Chase button never sends email. It only opens a Gmail **compose**
window with the message pre-filled; nothing goes anywhere until you press
Send yourself.
