#!/usr/bin/env python3
"""
Mortgage Oasis — local BD web app.

A localhost Flask server that pulls the case-log (live Google Sheet, CSV or
markdown), runs the analytics engine and serves a visual dashboard. Binds to
127.0.0.1 only — client data never leaves the machine.

Run:
    pip install -r requirements.txt
    cp .env.example .env   # then edit
    python app.py
    open http://127.0.0.1:5000
"""
import os
import time
import datetime

from flask import Flask, jsonify, send_from_directory, request, Response

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:  # dotenv is optional
    pass

from mortgage_oasis import analytics
from mortgage_oasis import datasource

app = Flask(__name__, static_folder="static", static_url_path="")

_CACHE = {"data": None, "ts": 0, "error": None}
CACHE_TTL = int(os.environ.get("CACHE_TTL", "300"))  # seconds


def get_analysis(force=False):
    now = time.time()
    if not force and _CACHE["data"] and now - _CACHE["ts"] < CACHE_TTL:
        return _CACHE["data"]
    rows = datasource.load_rows()
    data = analytics.analyse(rows)
    data["source"] = datasource.describe_source()
    _CACHE.update(data=data, ts=now, error=None)
    return data


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/data")
def api_data():
    try:
        return jsonify(get_analysis())
    except Exception as exc:  # surface config/auth problems to the UI
        return jsonify({"error": str(exc),
                        "hint": "Check DATA_SOURCE and credentials in your .env"}), 500


@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    try:
        return jsonify(get_analysis(force=True))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


def _ics(events, name="reminders"):
    def esc(s):
        return str(s or "").replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")

    def dt(iso):
        return iso.replace("-", "")

    stamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0",
             "PRODID:-//Mortgage Oasis//BD App//EN", "CALSCALE:GREGORIAN"]
    for i, (title, date_iso, desc) in enumerate(events):
        lines += ["BEGIN:VEVENT", f"UID:{i}-{stamp}@mortgageoasis",
                  f"DTSTAMP:{stamp}", f"DTSTART;VALUE=DATE:{dt(date_iso)}",
                  f"DTEND;VALUE=DATE:{dt(date_iso)}",
                  f"SUMMARY:{esc(title)}", f"DESCRIPTION:{esc(desc)}",
                  "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY",
                  f"DESCRIPTION:{esc(title)}", "END:VALARM", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    body = "\r\n".join(lines)
    return Response(body, mimetype="text/calendar",
                    headers={"Content-Disposition": f'attachment; filename="{name}.ics"'})


@app.route("/api/calendar.ics")
def api_calendar():
    """Bulk reminders. ?type=pipeline&days=90  or  ?type=gap"""
    data = get_analysis()
    kind = request.args.get("type", "pipeline")
    if kind == "gap":
        today = datetime.date.today().isoformat()
        events = [("Protection review: " + g["client"], today,
                   f'{g["action"]} — {g["property"]} ({g["lender"]})')
                  for g in data["protection_gap"]]
        return _ics(events, "protection-reviews")
    days = int(request.args.get("days", "90"))
    events = [("Remortgage review: " + p["client"], p["review_date"],
               f'Approaching maturity — {p["property"]} ({p["lender"]}, completed {p["completed"]})')
              for p in data["pipeline"]
              if p["overdue"] or 0 <= p["days_to_review"] <= days]
    return _ics(events, "remortgage-pipeline")


@app.route("/healthz")
def healthz():
    return {"ok": True, "source": datasource.describe_source()}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    # 127.0.0.1 only: local-use app holding client PII, never expose externally.
    app.run(host="127.0.0.1", port=port, debug=bool(os.environ.get("DEBUG")))
