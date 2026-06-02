#!/usr/bin/env python3
"""
build_standalone.py — bundle the full web app into ONE self-contained HTML file.

Inlines the CSS/JS from static/ and embeds a snapshot of the analysed data, so the
whole interactive dashboard (charts, pipeline timeline, adviser performance,
insights, filters, drill-down, calendar export) runs offline in any modern browser
— including mobile — with no server. The only feature lost vs `app.py` is live
refresh from the sheet (it's a point-in-time snapshot).

Usage:
  python3 build_standalone.py --csv export.csv --out mortgage_oasis_app.html
  python3 build_standalone.py --src export.md  --out mortgage_oasis_app.html
"""
import argparse
import datetime
import json
import pathlib

from mortgage_oasis import analytics

STATIC = pathlib.Path(__file__).parent / "static"


def build(rows, out_path):
    data = analytics.analyse(rows)
    data["source"] = "Offline snapshot · " + datetime.datetime.now().strftime("%d %b %Y %H:%M")

    css = (STATIC / "styles.css").read_text(encoding="utf-8")
    charts = (STATIC / "charts.js").read_text(encoding="utf-8")
    appjs = (STATIC / "app.js").read_text(encoding="utf-8")
    html = (STATIC / "index.html").read_text(encoding="utf-8")

    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")  # safe inside <script>

    html = html.replace('<link rel="stylesheet" href="styles.css">',
                         f"<style>\n{css}\n</style>")
    html = html.replace('<script src="charts.js"></script>',
                        f"<script>\n{charts}\n</script>")
    html = html.replace('<script src="app.js"></script>',
                        f"<script>window.EMBEDDED_DATA={payload};</script>\n<script>\n{appjs}\n</script>")

    pathlib.Path(out_path).write_text(html, encoding="utf-8")
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="markdown/JSON export")
    ap.add_argument("--csv", help="CSV export from Google Sheets")
    ap.add_argument("--out", default="mortgage_oasis_app.html")
    args = ap.parse_args()

    if args.csv:
        rows = analytics.parse_csv(args.csv)
    elif args.src:
        rows = analytics.parse_markdown(analytics.load_markdown(args.src))
    else:
        ap.error("provide --csv or --src")

    data = build(rows, args.out)
    print(f"wrote {args.out} — {data['kpis']['total_rows']} cases, "
          f"{len(data['insights'])} insights, {len(data['records'])} records embedded")


if __name__ == "__main__":
    main()
