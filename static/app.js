/* app.js — Mortgage Oasis BD dashboard front-end. */
"use strict";
let DATA = null;
const F = { year: "", adviser: "", biz: "" };      // global filters
let EXPLORER = {};                                  // drill-down filter (category/provider/area)

const $ = (s, r = document) => r.querySelector(s);
const gbp = (v) => v == null || v === "" ? "" : "£" + Math.round(v).toLocaleString("en-GB");
const num = (v) => (v || 0).toLocaleString("en-GB");

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in (attrs || {})) {
    if (k === "class") e.className = attrs[k];
    else if (k === "html") e.innerHTML = attrs[k];
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  }
  kids.flat().forEach(c => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return e;
}

/* ---- calendar helpers (client-side, offline) ---- */
const icsDate = (iso) => iso.replace(/-/g, "");
const esc = (s) => String(s || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
function vevent(title, dateIso, desc, i) {
  return ["BEGIN:VEVENT", `UID:${i}-${Date.now()}@mortgageoasis`,
    `DTSTAMP:${icsDate(new Date().toISOString().slice(0, 10))}T090000Z`,
    `DTSTART;VALUE=DATE:${icsDate(dateIso)}`, `DTEND;VALUE=DATE:${icsDate(dateIso)}`,
    `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(desc)}`,
    "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", `DESCRIPTION:${esc(title)}`,
    "END:VALARM", "END:VEVENT"].join("\r\n");
}
function icsDownload(events, name) {
  if (!events.length) { alert("Nothing to add."); return; }
  const cal = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mortgage Oasis//BD App//EN",
    "CALSCALE:GREGORIAN", ...events.map((e, i) => vevent(e[0], e[1], e[2], i)), "END:VCALENDAR"].join("\r\n");
  const url = URL.createObjectURL(new Blob([cal], { type: "text/calendar" }));
  const a = h("a", { href: url, download: name + ".ics" }); a.click(); URL.revokeObjectURL(url);
}
function gcalLink(title, dateIso, desc) {
  const d = icsDate(dateIso);
  const nd = icsDate(new Date(new Date(dateIso).getTime() + 864e5).toISOString().slice(0, 10));
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${d}/${nd}&details=${encodeURIComponent(desc)}`;
}

/* ---- data filtering ---- */
function records() {
  if (!DATA) return [];
  return DATA.records.filter(r =>
    (!F.year || String(r.year) === F.year) &&
    (!F.adviser || r.admin === F.adviser) &&
    (!F.biz || r.biz === F.biz));
}
function countBy(rows, keyFn, top) {
  const m = new Map();
  rows.forEach(r => { const k = keyFn(r); if (k) m.set(k, (m.get(k) || 0) + 1); });
  let a = [...m.entries()].map(([label, value]) => ({ label, value })).sort((x, y) => y.value - x.value);
  return top ? a.slice(0, top) : a;
}

/* ---- generic sortable / searchable table ---- */
function dataTable(rows, cols, opts = {}) {
  opts = Object.assign({ search: true, maxRows: 1000 }, opts);
  let sortKey = opts.sortKey || null, dir = opts.sortDir || 1, q = "";
  const wrap = h("div");
  const tb = h("div", { class: "toolbar" });
  const count = h("span", { class: "count" });
  if (opts.search) {
    const inp = h("input", { type: "search", placeholder: "Search…", oninput: e => { q = e.target.value.toLowerCase(); render(); } });
    tb.appendChild(inp);
  }
  (opts.buttons || []).forEach(b => tb.appendChild(h("button", { class: "btn sec", onclick: () => b.onClick(visible()) }, b.label)));
  tb.appendChild(count);
  wrap.appendChild(tb);
  const tw = h("div", { class: "tablewrap" });
  const table = h("table");
  const thead = h("thead");
  const htr = h("tr");
  cols.forEach(c => htr.appendChild(h("th", { class: c.cls || "", onclick: () => { dir = (sortKey === c.key ? -dir : 1); sortKey = c.key; render(); } }, c.label)));
  thead.appendChild(htr); table.appendChild(thead);
  const tbody = h("tbody"); table.appendChild(tbody);
  tw.appendChild(table); wrap.appendChild(tw);

  function visible() {
    let r = rows.slice();
    if (q) r = r.filter(row => cols.map(c => c.get ? c.get(row) : row[c.key]).join(" ").toLowerCase().includes(q));
    if (sortKey) {
      const col = cols.find(c => c.key === sortKey);
      r.sort((a, b) => { let x = col.get ? col.get(a) : a[sortKey], y = col.get ? col.get(b) : b[sortKey]; x = x == null ? "" : x; y = y == null ? "" : y; return (x > y ? 1 : x < y ? -1 : 0) * dir; });
    }
    return r;
  }
  function render() {
    const r = visible(); tbody.innerHTML = "";
    r.slice(0, opts.maxRows).forEach(row => {
      const tr = h("tr");
      cols.forEach(c => {
        const v = c.get ? c.get(row) : row[c.key];
        const td = h("td", { class: c.cls || "" });
        if (c.html) td.innerHTML = c.fmt ? c.fmt(v, row) : (v == null ? "" : v);
        else td.textContent = c.fmt ? c.fmt(v, row) : (v == null ? "" : v);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    count.textContent = `${r.length} rows`;
  }
  render();
  return wrap;
}

function card(title, hint) {
  const c = h("div", { class: "card" }, h("h3", {}, title));
  if (hint) c.appendChild(h("div", { class: "hint" }, hint));
  return c;
}
function chartCard(title, hint, renderFn) {
  const c = card(title, hint); const box = h("div"); c.appendChild(box);
  setTimeout(() => renderFn(box), 0); return c;
}

/* ---- pages ---- */
function kpiRow() {
  const k = DATA.kpis;
  const defs = [
    ["total_rows", "Cases", null], ["clients", "Households", null],
    ["mortgage_clients", "Mortgage clients", null],
    ["attach_rate", "Protection attach", v => v + "%"],
    ["protection_gap", "No-protection clients", null],
    ["comm_written", "Commission written", gbp],
    ["comm_received", "Commission received", gbp],
    ["mcr_cases", "MCR (divorce) cases", null],
  ];
  const row = h("div", { class: "kpis" });
  defs.forEach(([key, label, fmt]) => row.appendChild(
    h("div", { class: "kpi" }, h("div", { class: "n" }, fmt ? fmt(k[key]) : num(k[key])), h("div", { class: "l" }, label))));
  return row;
}

function pageOverview(v) {
  v.appendChild(kpiRow());
  v.appendChild(h("div", { class: "section-title" }, "💡 Intelligent insights — ranked by £ impact"));
  const feed = h("div", { class: "insights" });
  DATA.insights.forEach(i => feed.appendChild(h("div", { class: "insight " + i.severity },
    h("span", { class: "badge " + i.severity }, i.severity),
    h("div", { class: "t" }, " " + i.title),
    h("div", { class: "m" }, i.metric),
    h("div", { class: "d" }, i.detail),
    h("div", { class: "a" }, i.action))));
  v.appendChild(feed);

  v.appendChild(h("div", { class: "section-title" }, "📈 Portfolio breakdown"));
  const grid = h("div", { class: "grid cols-2" });
  const recs = records();
  grid.appendChild(chartCard("Product mix", "Click a segment to explore those cases", box =>
    Charts.donut(box, countBy(recs, r => r.category), { centerLabel: "cases", onClick: d => { EXPLORER = { key: "category", val: d.label }; go("explorer"); } })));
  grid.appendChild(chartCard("Top mortgage lenders", "Mortgage cases by lender", box =>
    Charts.hbars(box, countBy(recs.filter(r => r.is_mortgage), r => r.provider, 10), { onClick: d => { EXPLORER = { key: "provider", val: d.label }; go("explorer"); } })));
  const months = [...new Set(recs.map(r => r.month).filter(Boolean))].sort();
  grid.appendChild(chartCard("Commission written by month", null, box => {
    const byM = Object.fromEntries(months.map(m => [m, 0]));
    recs.forEach(r => { if (r.month) byM[r.month] += r.comm_written || 0; });
    Charts.line(box, [{ name: "Commission written", points: months.map(m => byM[m]) }], { labels: months, money: true });
  }));
  grid.appendChild(chartCard("Mortgage vs protection cases", "Are protection sales keeping pace?", box => {
    const m = Object.fromEntries(months.map(x => [x, 0])), p = Object.fromEntries(months.map(x => [x, 0]));
    recs.forEach(r => { if (!r.month) return; if (r.is_mortgage) m[r.month]++; if (r.is_protection) p[r.month]++; });
    Charts.line(box, [{ name: "Mortgage", points: months.map(x => m[x]) }, { name: "Protection", points: months.map(x => p[x]), color: "#22d3a6" }], { labels: months });
  }));
  v.appendChild(grid);
}

function pagePipeline(v) {
  let pipe = DATA.pipeline.filter(p => !F.adviser || p.admin === F.adviser);
  const dueSoon = pipe.filter(p => p.overdue || (p.days_to_review >= 0 && p.days_to_review <= 90));
  v.appendChild(h("div", { class: "kpis" },
    kcard(pipe.length, "Pipeline cases"),
    kcard(dueSoon.length, "Due / overdue (90d)"),
    kcard(gbp(DATA.opportunity.due_90_fee_value), "Est. fees due (90d)")));

  v.appendChild(h("div", { class: "section-title" }, "📅 Remortgage maturities by month (review = completion + " + DATA.term_months + "mo)"));
  v.appendChild(chartCard("Pipeline timeline", "Red = overdue reviews", box => {
    const m = new Map();
    pipe.forEach(p => { const k = p.review_date.slice(0, 7); const o = m.get(k) || { c: 0, o: 0 }; o.c++; if (p.overdue) o.o++; m.set(k, o); });
    const buckets = [...m.entries()].sort().map(([month, o]) => ({ label: month, value: o.c, color: o.o ? "#f87171" : "#3da9fc", note: o.o ? o.o + " overdue" : "" }));
    Charts.vbars(box, buckets, { rotate: true, labelEvery: 1 });
  }));

  const cols = [
    { key: "review_date", label: "Review", cls: "nowrap", fmt: (v, r) => v + (r.overdue ? "  ⚠" : "") },
    { key: "client", label: "Client" }, { key: "lender", label: "Lender" },
    { key: "amount", label: "Loan", cls: "amt", fmt: gbp },
    { key: "completed", label: "Completed", cls: "nowrap" }, { key: "admin", label: "Adviser" },
    { key: "cal", label: "Calendar", html: true, get: () => "", fmt: (_, r) => `<a target="_blank" href="${gcalLink("Remortgage review: " + r.client, r.review_date, "Approaching maturity — " + r.property + " (" + r.lender + ")")}">＋ add</a>` },
  ];
  const c = card("Pipeline cases", "Sorted by review date. Bulk-export reminders below.");
  c.appendChild(dataTable(pipe, cols, {
    sortKey: "review_date", sortDir: 1, buttons: [
      { label: "⬇ Download due-soon (.ics)", onClick: () => icsDownload(dueSoon.map(p => ["Remortgage review: " + p.client, p.review_date, "Approaching maturity — " + p.property + " (" + p.lender + ")"]), "remortgage-due") },
      { label: "⬇ Download all shown (.ics)", onClick: rows => icsDownload(rows.map(p => ["Remortgage review: " + p.client, p.review_date, p.property + " (" + p.lender + ")"]), "remortgage-pipeline") },
    ]
  }));
  v.appendChild(c);
}

function pageAdvisers(v) {
  v.appendChild(h("div", { class: "section-title" }, "👥 Adviser / administrator performance (all-time)"));
  const grid = h("div", { class: "grid cols-2" });
  grid.appendChild(chartCard("Commission written by adviser", null, box =>
    Charts.hbars(box, DATA.adviser.map(a => ({ label: a.adviser, value: a.comm_written })), { money: true, color: "#22d3a6" })));
  grid.appendChild(chartCard("Cases by adviser", null, box =>
    Charts.hbars(box, DATA.adviser.map(a => ({ label: a.adviser, value: a.cases })))));
  v.appendChild(grid);
  const cols = [
    { key: "adviser", label: "Adviser" }, { key: "cases", label: "Cases", cls: "amt" },
    { key: "mortgage", label: "Mortgage", cls: "amt" }, { key: "protection", label: "Protection", cls: "amt" },
    { key: "protection_ratio", label: "Prot/Mort %", cls: "amt", fmt: v => v + "%" },
    { key: "conversion", label: "Completion %", cls: "amt", fmt: v => v + "%" },
    { key: "retention", label: "Comm retention %", cls: "amt", fmt: v => v + "%" },
    { key: "comm_written", label: "Comm written", cls: "amt", fmt: gbp },
    { key: "avg_comm", label: "Avg/case", cls: "amt", fmt: gbp },
  ];
  const c = card("Per-adviser detail", "Completion % = mortgage cases with commission received. Retention = received ÷ written.");
  c.appendChild(dataTable(DATA.adviser, cols, { sortKey: "comm_written", sortDir: -1, search: false }));
  v.appendChild(c);
}

function pageCrosssell(v) {
  const o = DATA.opportunity;
  v.appendChild(h("div", { class: "kpis" },
    kcard(o.gap_clients, "No-protection clients"),
    kcard(gbp(o.gap_value), "Est. commission in gap"),
    kcard(o.life_only_clients, "Life-only clients"),
    kcard(gbp(o.avg_protection_comm), "Avg protection comm")));

  const gapCols = [
    { key: "client", label: "Client" }, { key: "property", label: "Property" },
    { key: "lender", label: "Lender" }, { key: "amount", label: "Loan", cls: "amt", fmt: gbp },
    { key: "admin", label: "Adviser" },
    { key: "cal", label: "", html: true, get: () => "", fmt: (_, r) => `<a target="_blank" href="${gcalLink("Protection review: " + r.client, DATA.generated.slice(0, 10), r.action + " — " + r.property)}">＋ add</a>` },
  ];
  const gc = card("Protection cross-sell — mortgage clients with no cover", "Your warmest leads, largest loans first.");
  gc.appendChild(dataTable(DATA.protection_gap, gapCols, {
    sortKey: "amount", sortDir: -1, buttons: [
      { label: "⬇ Download shown (.ics)", onClick: rows => icsDownload(rows.map(r => ["Protection review: " + r.client, DATA.generated.slice(0, 10), r.action + " — " + r.property]), "protection-reviews") },
    ]
  }));
  v.appendChild(gc);

  const loCols = [{ key: "client", label: "Client" }, { key: "property", label: "Property" }, { key: "missing", label: "Missing" }, { key: "admin", label: "Adviser" }];
  const lc = card("Life-only upsell — missing critical illness / income protection", "Quick wins: a policy is already in place.");
  lc.appendChild(dataTable(DATA.life_only, loCols, { search: true }));
  v.appendChild(lc);
}

function pageReferrals(v) {
  v.appendChild(h("div", { class: "section-title" }, "🤝 Referral channels — " + DATA.concentration.unattributed_share + "% of cases have no recorded source"));
  v.appendChild(chartCard("Cases by introducer (top 12)", null, box =>
    Charts.hbars(box, DATA.referrals.slice(0, 12).map(r => ({ label: r.source, value: r.count })))));
  const cols = [
    { key: "source", label: "Source" }, { key: "count", label: "Cases", cls: "amt" },
    { key: "clients", label: "Clients", cls: "amt" }, { key: "comm", label: "Commission written", cls: "amt", fmt: gbp },
  ];
  const c = card("All referral sources", null);
  c.appendChild(dataTable(DATA.referrals, cols, { sortKey: "count", sortDir: -1 }));
  v.appendChild(c);
}

function pageExplorer(v) {
  let recs = records();
  if (EXPLORER.key) recs = recs.filter(r => String(r[EXPLORER.key]) === EXPLORER.val);
  const head = h("div", { class: "section-title" }, "🔎 Case explorer");
  if (EXPLORER.key) head.appendChild(h("button", { class: "btn sec", style: "margin-left:10px", onclick: () => { EXPLORER = {}; go("explorer"); } }, "✕ " + EXPLORER.key + " = " + EXPLORER.val));
  v.appendChild(head);
  const cols = [
    { key: "date", label: "Date", cls: "nowrap" }, { key: "client", label: "Client" },
    { key: "admin", label: "Adviser" }, { key: "biz", label: "Business" },
    { key: "category", label: "Product" }, { key: "provider", label: "Provider" },
    { key: "amount", label: "Amount", cls: "amt", fmt: gbp },
    { key: "source_norm", label: "Source" }, { key: "property", label: "Property" },
  ];
  const c = card(recs.length + " cases", "Respects the filters above. Click column headers to sort.");
  c.appendChild(dataTable(recs, cols, { sortKey: "date", sortDir: -1, maxRows: 2000 }));
  v.appendChild(c);
}

function pageQuality(v) {
  const q = DATA.quality;
  const grid = h("div", { class: "grid cols-3" });
  const sc = card("Data quality score", null);
  sc.appendChild(h("div", { class: "score" }, q.score + " /100"));
  sc.appendChild(h("div", { class: "meter", style: "margin-top:10px" }, h("i", { style: "width:" + q.score + "%" })));
  grid.appendChild(sc);
  grid.appendChild(metricCard("Missing source", q.missing_source_pct + "%", "Cases with no introducer recorded"));
  grid.appendChild(metricCard("Missing loan amount", q.missing_amount_pct + "%", "Mortgage cases with no amount"));
  v.appendChild(grid);
  const cols = [{ key: "type", label: "Issue type" }, { key: "detail", label: "Detail" }];
  const c = card(DATA.cleanup.length + " items to tidy", q.name_variants + " clients appear under multiple spellings.");
  c.appendChild(dataTable(DATA.cleanup, cols, { sortKey: "type", sortDir: 1 }));
  v.appendChild(c);
}

function kcard(n, label) { return h("div", { class: "kpi" }, h("div", { class: "n" }, String(n)), h("div", { class: "l" }, label)); }
function metricCard(label, big, hint) { const c = card(label, hint); c.appendChild(h("div", { class: "score" }, big)); return c; }

/* ---- routing ---- */
const ROUTES = { overview: pageOverview, pipeline: pagePipeline, advisers: pageAdvisers, crosssell: pageCrosssell, referrals: pageReferrals, explorer: pageExplorer, quality: pageQuality };
const TITLES = { overview: "Overview", pipeline: "Pipeline", advisers: "Advisers", crosssell: "Cross-sell", referrals: "Referrals", explorer: "Explorer", quality: "Data quality" };

function go(route) { if (location.hash !== "#" + route) location.hash = route; else renderRoute(); }
function renderRoute() {
  const route = (location.hash.replace("#", "") || "overview");
  const fn = ROUTES[route] || pageOverview;
  $("#pageTitle").textContent = TITLES[route] || "Overview";
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("active", a.dataset.route === route));
  const v = h("div"); fn(v);
  const view = $("#view"); view.innerHTML = ""; view.appendChild(v);
}

/* ---- bootstrap ---- */
function populateFilters() {
  const f = DATA.filters;
  f.years.forEach(y => $("#fYear").appendChild(h("option", { value: y }, String(y))));
  f.advisers.forEach(a => $("#fAdviser").appendChild(h("option", { value: a }, a)));
  f.biz_types.forEach(b => $("#fBiz").appendChild(h("option", { value: b }, b)));
}
function wireControls() {
  $("#fYear").onchange = e => { F.year = e.target.value; renderRoute(); };
  $("#fAdviser").onchange = e => { F.adviser = e.target.value; renderRoute(); };
  $("#fBiz").onchange = e => { F.biz = e.target.value; renderRoute(); };
  $("#btnReset").onclick = () => { F.year = F.adviser = F.biz = ""; EXPLORER = {}; $("#fYear").value = $("#fAdviser").value = $("#fBiz").value = ""; renderRoute(); };
  $("#btnRefresh").onclick = async () => { $("#btnRefresh").textContent = "↻ Refreshing…"; try { await fetch("/api/refresh", { method: "POST" }); await load(); } finally { $("#btnRefresh").textContent = "↻ Refresh data"; } };
  window.addEventListener("hashchange", renderRoute);
}
async function load() {
  const res = await fetch("/api/data");
  const j = await res.json();
  if (j.error) { $("#view").innerHTML = ""; $("#view").appendChild(h("div", { class: "error" }, h("strong", {}, "Could not load data. "), j.error + (j.hint ? " — " + j.hint : ""))); $("#srcLine").textContent = "data error"; return; }
  DATA = j;
  $("#srcLine").textContent = `Source: ${DATA.source} · generated ${DATA.generated.replace("T", " ")} · ${DATA.kpis.total_rows} cases`;
  renderRoute();
}
(function init() {
  fetch("/api/data").then(r => r.json()).then(j => {
    if (!j.error) { DATA = j; populateFilters(); }
    wireControls();
    $("#srcLine").textContent = j.error ? "data error" : `Source: ${DATA.source} · ${DATA.kpis.total_rows} cases`;
    if (j.error) { $("#view").innerHTML = `<div class="error">Could not load data — ${j.error}${j.hint ? " — " + j.hint : ""}</div>`; }
    else renderRoute();
  });
})();
