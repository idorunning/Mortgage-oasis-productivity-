#!/usr/bin/env python3
"""Build the dashboard as ONE self-contained HTML file for local use.

Usage:
    python3 scripts/build_local.py [output.html]

Output defaults to MortgageOasis-Dashboard.html in the repo root.

The file embeds the CSS, the app JavaScript, and both data sets
(data/tracker.json and data/statements.json), so it needs no web server and
no internet: double-click it on any laptop, or keep it in a Google Drive /
OneDrive synced folder and open the synced local copy. (Opening it from
drive.google.com's web preview won't work — Drive's preview doesn't run
JavaScript — so open the file itself via Drive for desktop.)

Chase history and the threshold sliders are remembered per browser via
localStorage, same as the served version.

Run this after refreshing the data (see README) and replace your local copy.
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Offline build: replace the network load inside loadData() with a read of the
# embedded JSON blob. Keep loadData()'s promise signature so the rest is unchanged.
FETCH_TAIL = '''    return Promise.all([
      fetch("../data/tracker.json", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch("../data/statements.json", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
    ]).then(function (payloads) {
      state.tracker = payloads[0];
      state.statements = payloads[1];
      buildMatches();
    });'''

EMBED_TAIL = '''    var embedded = JSON.parse(document.getElementById("mo-data").textContent);
    state.tracker = embedded.tracker;
    state.statements = embedded.statements;
    buildMatches();
    return Promise.resolve();'''


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "MortgageOasis-Dashboard.html")

    with open(os.path.join(REPO, "admin/assets/style.css")) as fh:
        css = fh.read()
    with open(os.path.join(REPO, "admin/assets/app.js")) as fh:
        js = fh.read()
    with open(os.path.join(REPO, "data/tracker.json")) as fh:
        tracker = json.load(fh)
    with open(os.path.join(REPO, "data/statements.json")) as fh:
        statements = json.load(fh)

    if FETCH_TAIL not in js:
        sys.exit("app.js loader block not found — update FETCH_TAIL in this script "
                 "to match the Promise.all block at the end of admin/assets/app.js")
    js = js.replace(FETCH_TAIL, EMBED_TAIL)

    data_blob = json.dumps({"tracker": tracker, "statements": statements},
                           separators=(",", ":")).replace("</script", "<\\/script")
    generated = tracker.get("generatedAt", "")[:10]

    html = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Mortgage Oasis — Dashboard</title>
<style>
""" + css + """
</style>
</head>
<body>
<header class="topbar">
  <div class="brand">
    <span class="brand-name">Mortgage Oasis</span>
    <span class="brand-sub">Dashboard · local copy · data """ + generated + """</span>
  </div>
  <nav class="tabs" id="tabs">
    <button class="tab active" data-view="reconciliation">Commission chasing</button>
    <button class="tab" data-view="overview">Overview</button>
    <button class="tab" data-view="tracker">Commission tracker</button>
    <button class="tab" data-view="recurring">Recurring income</button>
    <button class="tab" data-view="statements">Statements</button>
  </nav>
  <div class="topbar-right">
    <span id="refresh-status" class="refresh-status"></span>
    <button id="backup-btn" class="icon-btn" title="Download a full backup (data + chase history + overrides) as JSON">Backup</button>
    <button id="report-btn" class="icon-btn" title="Open a formatted report to print or save as PDF">PDF report</button>
    <select id="year-filter" class="select" aria-label="Year filter">
      <option value="all">All years</option>
    </select>
    <button id="theme-toggle" class="icon-btn" title="Toggle dark mode" aria-label="Toggle dark mode">&#9681;</button>
  </div>
</header>

<main id="app">
  <section id="view-reconciliation" class="view active"></section>
  <section id="view-overview" class="view"></section>
  <section id="view-tracker" class="view"></section>
  <section id="view-recurring" class="view"></section>
  <section id="view-statements" class="view"></section>
  <p id="load-error" class="load-error" hidden>Couldn&rsquo;t load the embedded dashboard data.</p>
</main>

<footer class="pagefoot">
  <span id="data-meta"></span>
</footer>

<script type="application/json" id="mo-data">""" + data_blob + """</script>
<script>
""" + js + """
</script>
</body>
</html>
"""

    with open(out_path, "w") as fh:
        fh.write(html)
    print(f"wrote {len(html):,} bytes -> {out_path}")


if __name__ == "__main__":
    main()
