# Mortgage Oasis — Productivity & BD Tools

Tools for turning the Mortgage Oasis case-log spreadsheet into business-development
insights. Two ways to use it:

1. **`app.py`** — a **local web app** that connects **live to your Google Sheet**, with
   interactive charts, a pipeline timeline, adviser performance and a ranked, quantified
   **insights** feed. *(Recommended.)*
2. **`build_dashboard.py`** — a single, self-contained **offline** `dashboard.html` you can
   email or archive (no server, no internet — just double-click).

Both share one engine (`mortgage_oasis/`) so the numbers always match. Everything runs on
**your** machine — client data never leaves it, and no third-party cloud is involved.

---

## 1. Local web app (`app.py`)

A localhost Flask server (binds to `127.0.0.1` only) that pulls the case-log, runs the
analytics engine and serves a visual dashboard at `http://127.0.0.1:5000`.

**Pages**

- **Overview** — KPI hero row, a ranked **insights** feed (biggest £ opportunities first),
  and charts: product mix (donut), top lenders, commission-by-month, mortgage-vs-protection trend.
- **Pipeline** — remortgage maturities as a month-by-month **timeline** (overdue in red) plus a
  due-soon table with one-click calendar export.
- **Advisers** — per-adviser cases, commission, protection ratio, completion % and commission retention.
- **Cross-sell** — mortgage clients with no protection (largest loans first) + life-only upsells.
- **Referrals**, **Explorer** (filterable case browser), **Data quality** (0–100 score + fixes).

Global **filters** (year / adviser / business type) and chart **drill-down** update the views live.

### Quick start

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then edit (see below)
python app.py                 # open http://127.0.0.1:5000
```

### Connecting it to your live Google Sheet

The app reads the sheet with a **Google service account** (no browser sign-in pop-ups — ideal
for a single-user local app). One-time setup:

1. In [Google Cloud Console](https://console.cloud.google.com/) create/select a project and
   **enable the Google Sheets API**.
2. **Create a service account** → **Keys** → **Add key → JSON**. Save the file as
   `service_account.json` in this folder (it's git-ignored).
3. Open the JSON, copy the `client_email` (looks like `name@project.iam.gserviceaccount.com`),
   and **share your Google Sheet with that email as a Viewer**.
4. In `.env` set:
   ```ini
   DATA_SOURCE=sheets
   SHEET_ID=<the id from the sheet URL: /spreadsheets/d/THIS/edit>
   SHEET_RANGE=A1:Z5000
   GOOGLE_APPLICATION_CREDENTIALS=./service_account.json
   ```
5. `python app.py`, then click **↻ Refresh data** any time the sheet changes.

> Live mode needs the extra Google libraries: `pip install google-api-python-client google-auth`
> (already in `requirements.txt`).

**No credentials yet?** Start immediately in **CSV mode**: download the sheet
(File → Download → CSV), then set `DATA_SOURCE=csv` and `DATA_CSV=./export.csv`.

---

## 2. Offline single file (`build_dashboard.py`)

```bash
# From a Google Sheets CSV export (File → Download → Comma-separated values):
python3 build_dashboard.py --csv mortgage-oasis-export.csv --out dashboard.html
```

Writes `dashboard.html` (open locally) and `report.txt` (narrative report body). The dashboard
is fully client-side: tick rows and **"Download selected as .ics"** for one calendar file with
reminders, or **"Open selected in Google Calendar"**. "Done" ticks persist in your browser.

---

## How it works

Records are cross-referenced into **households** via union-find over the client name *and* the
property address (postcode + house number), so a joint-name mortgage links to a single-name
protection policy at the same address. Insights are **deterministic local analytics** —
opportunity sizing, concentration risk, attach-rate benchmarking and a data-quality score —
with benchmark bands shown only as guidance. No AI calls, no data egress.

### Assumptions

- **Remortgage review dates** = completion date + `TERM_MONTHS` (default **21 months** — a
  2-year product reviewed ~3 months before maturity). The sheet doesn't record the fixed term;
  edit `TERM_MONTHS` in `mortgage_oasis/analytics.py` to match your typical product.

## Privacy

`dashboard.html`, `report.txt`, `.env`, any CSV export and your `service_account.json` contain
client data or secrets and are **git-ignored** — they never leave your machine. Only the code
and docs live in this repo.

## Tests

```bash
pip install pytest && python -m pytest tests/ -q
```
