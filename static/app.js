/* app.js — Mortgage Oasis BD dashboard front-end. */
"use strict";
let DATA = null;
const F = { year: "", adviser: "", biz: "" };      // global filters
let EXPLORER = {};                                  // drill-down filter (category/provider/area)
const PEOPLE = { tab: "team", selected: new Set(), leaver: "", roleFilter: "all" };  // People state
// brand pastels (keys kept generic; values are the pink/purple scheme)
const C = { teal: "#B79AD8", sage: "#E79BC9", blue: "#9DB8E6", sand: "#E6C173", coral: "#E27B96" };

const $ = (s, r = document) => r.querySelector(s);
// Server mode fetches /api/data; offline snapshot reads window.EMBEDDED_DATA.
const OFFLINE = typeof window !== "undefined" && window.EMBEDDED_DATA;
async function fetchData() { return OFFLINE ? window.EMBEDDED_DATA : (await fetch("/api/data")).json(); }
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

/* ---- staff settings (on-device, localStorage) — roles, leavers, pipeline reassignment ---- */
const Settings = (() => {
  const KEY = "mo_settings_v1";
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { s = {}; }
  function ensure() { s.staff = s.staff || {}; s.reassign = s.reassign || {}; }
  function save() { ensure(); try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  ensure();
  return {
    seed(advisers) { ensure(); let ch = false; advisers.forEach(a => { if (!s.staff[a.adviser]) { s.staff[a.adviser] = { role: a.adviser === "Mel" ? "advisor" : "admin", leaver: false, leaveDate: "" }; ch = true; } }); if (ch) save(); },
    staff(n) { ensure(); return s.staff[n] || { role: "admin", leaver: false, leaveDate: "" }; },
    setStaff(n, patch) { ensure(); s.staff[n] = Object.assign(this.staff(n), patch); save(); },
    reassignOf(id) { ensure(); return s.reassign[id]; },
    setReassign(id, to) { ensure(); if (to) s.reassign[id] = to; else delete s.reassign[id]; save(); },
    exportJSON() { ensure(); return JSON.stringify(s, null, 2); },
    importJSON(obj) { s = obj || {}; ensure(); save(); },
  };
})();
const pipeId = p => `${p.client}|${p.completed}|${p.lender}`;
const effectiveOwner = p => Settings.reassignOf(pipeId(p)) || p.admin;
const staffNames = () => DATA.adviser.map(a => a.adviser);

/* ---- People overlay: apply roles/leavers/reassignment over the read-only analytics ---- */
const DEV_METRICS = {
  protection_ratio: ["Protection attach", "Protection coaching — make a protection conversation standard on every mortgage case."],
  conversion: ["Completion rate", "Pipeline review — applications aren't reaching completion; check process & follow-up."],
  retention: ["Commission retention", "Reconciliation check — written vs received commission is leaking (clawbacks / chasing)."],
  avg_fee: ["Average broker fee", "Pricing review — fees are below the team norm for the work done."],
  avg_comm: ["Commission per case", "Case-mix review — steer toward higher-value cases / cross-sell."],
};
function median(vals) {
  vals = vals.filter(v => v != null).sort((a, b) => a - b);
  if (!vals.length) return 0;
  const n = vals.length;
  return n % 2 ? vals[(n - 1) / 2] : Math.round((vals[n / 2 - 1] + vals[n / 2]) / 2);
}
function benchmarksFor(group) {
  const m = {};
  ["cases", "comm_written", "avg_comm", "avg_fee", "protection_ratio", "conversion", "retention"]
    .forEach(k => m[k] = median(group.map(a => a[k])));
  return m;
}
function opportunitiesFor(a, bench) {
  const out = [];
  for (const k in DEV_METRICS) if (bench[k] && a[k] < bench[k] * 0.85)
    out.push({ metric: k, label: DEV_METRICS[k][0], action: DEV_METRICS[k][1], value: a[k], benchmark: bench[k] });
  out.sort((x, y) => (y.benchmark - y.value) - (x.benchmark - x.value));
  return out;
}
function teamView() {
  const base = DATA.adviser.map(a => {
    const st = Settings.staff(a.adviser);
    return Object.assign({}, a, { role: st.role, leaver: !!st.leaver, leaveDate: st.leaveDate || "",
      status: st.leaver ? "leaver" : a.status });
  });
  // open book recomputed by *effective* owner so pipeline reassignment is reflected
  const due = {}, gap = {}, life = {};
  DATA.pipeline.forEach(p => { if (p.overdue || (p.days_to_review >= 0 && p.days_to_review <= 180)) { const o = effectiveOwner(p); due[o] = (due[o] || 0) + 1; } });
  DATA.protection_gap.forEach(g => { if (g.admin) gap[g.admin] = (gap[g.admin] || 0) + 1; });
  DATA.life_only.forEach(l => { if (l.admin) life[l.admin] = (life[l.admin] || 0) + 1; });
  const avgProt = DATA.opportunity.avg_protection_comm, avgFee = DATA.opportunity.avg_remo_fee;
  base.forEach(a => {
    a.pipeline_due = due[a.adviser] || 0;
    a.gap_clients = gap[a.adviser] || 0;
    a.life_only_clients = life[a.adviser] || 0;
    a.book_value = a.gap_clients * avgProt + a.pipeline_due * avgFee;
  });
  const live = base.filter(a => !a.leaver);
  const bench = benchmarksFor(live);
  base.forEach(a => {
    if (a.leaver) { a.opportunities = []; return; }
    let peers = live.filter(x => x.role === a.role);
    if (peers.length < 3) peers = live;          // role group too small -> benchmark vs whole team
    a.opportunities = opportunitiesFor(a, benchmarksFor(peers));
  });
  return { advisers: base, live, bench };
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
  cols.forEach(c => htr.appendChild(h("th", { class: c.cls || "", onclick: () => { if (!c.key) return; dir = (sortKey === c.key ? -dir : 1); sortKey = c.key; render(); } }, c.label)));
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
        if (c.node) td.appendChild(c.node(row));
        else if (c.html) td.innerHTML = c.fmt ? c.fmt(v, row) : (v == null ? "" : v);
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
  const top = DATA.insights[0];
  if (top) v.appendChild(h("div", { class: "hero" },
    h("div", {}, h("div", { class: "lab" }, "Biggest opportunity"), h("div", { class: "big" }, top.metric)),
    h("div", { class: "detail" }, h("strong", {}, top.title), h("div", { class: "muted" }, top.detail), h("div", { class: "act" }, "➜ " + top.action))));
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
    Charts.line(box, [{ name: "Mortgage", points: months.map(x => m[x]) }, { name: "Protection", points: months.map(x => p[x]), color: C.sage }], { labels: months });
  }));
  grid.appendChild(chartCard("Geographic spread", "Cases by postcode area — click to explore", box =>
    Charts.hbars(box, countBy(recs, r => r.area, 10), { onClick: d => { EXPLORER = { key: "area", val: d.label }; go("explorer"); } })));
  v.appendChild(grid);
}

function ownerSelect(p) {
  const cur = effectiveOwner(p);
  const sel = h("select", { class: "mini", onchange: e => { Settings.setReassign(pipeId(p), e.target.value === p.admin ? "" : e.target.value); renderRoute(); } });
  staffNames().forEach(n => { const o = h("option", { value: n }, n); if (n === cur) o.setAttribute("selected", ""); sel.appendChild(o); });
  const wrap = h("div", {}, sel);
  if (cur !== p.admin) wrap.appendChild(h("span", { class: "from" }, "from " + p.admin));
  return wrap;
}

function pagePipeline(v) {
  let pipe = DATA.pipeline.filter(p => !F.adviser || effectiveOwner(p) === F.adviser);
  const dueSoon = pipe.filter(p => p.overdue || (p.days_to_review >= 0 && p.days_to_review <= 90));
  v.appendChild(h("div", { class: "kpis" },
    kcard(pipe.length, "Pipeline cases"),
    kcard(dueSoon.length, "Due / overdue (90d)"),
    kcard(gbp(DATA.opportunity.due_90_fee_value), "Est. fees due (90d)")));

  v.appendChild(h("div", { class: "section-title" }, "📅 Remortgage maturities by month (review = completion + " + DATA.term_months + "mo)"));
  v.appendChild(chartCard("Pipeline timeline", "Coral = overdue reviews", box => {
    const m = new Map();
    pipe.forEach(p => { const k = p.review_date.slice(0, 7); const o = m.get(k) || { c: 0, o: 0 }; o.c++; if (p.overdue) o.o++; m.set(k, o); });
    const buckets = [...m.entries()].sort().map(([month, o]) => ({ label: month, value: o.c, color: o.o ? C.coral : C.teal, note: o.o ? o.o + " overdue" : "" }));
    Charts.vbars(box, buckets, { rotate: true, labelEvery: 1 });
  }));

  const cols = [
    { key: "review_date", label: "Review", cls: "nowrap", fmt: (v, r) => v + (r.overdue ? "  ⚠" : "") },
    { key: "client", label: "Client" }, { key: "lender", label: "Lender" },
    { key: "amount", label: "Loan", cls: "amt", fmt: gbp },
    { key: "completed", label: "Completed", cls: "nowrap" },
    { key: "owner", label: "Owner", get: r => effectiveOwner(r), node: r => ownerSelect(r) },
    { key: "cal", label: "Calendar", html: true, get: () => "", fmt: (_, r) => `<a target="_blank" href="${gcalLink("Remortgage review: " + r.client, r.review_date, "Approaching maturity — " + r.property + " (" + r.lender + ")")}">＋ add</a>` },
  ];
  const c = card("Pipeline cases", "Sorted by review date. Change “Owner” to reassign a case to another staff member. Bulk-export reminders below.");
  c.appendChild(dataTable(pipe, cols, {
    sortKey: "review_date", sortDir: 1, buttons: [
      { label: "⬇ Download due-soon (.ics)", onClick: () => icsDownload(dueSoon.map(p => ["Remortgage review: " + p.client, p.review_date, "Approaching maturity — " + p.property + " (" + p.lender + ")"]), "remortgage-due") },
      { label: "⬇ Download all shown (.ics)", onClick: rows => icsDownload(rows.map(p => ["Remortgage review: " + p.client, p.review_date, p.property + " (" + p.lender + ")"]), "remortgage-pipeline") },
    ]
  }));
  v.appendChild(c);
}

/* ===== People (admin staff management) ===== */
let TEAM = null;  // teamView() result for the current render
const STATUS = { active: ["Active", "active"], "new": ["New", "new"], dormant: ["Inactive 6m+", "due"], leaver: ["Left", "left"] };
const adviserBy = name => (TEAM ? TEAM.advisers : DATA.adviser).find(a => a.adviser === name);
const statusColor = s => (s === "leaver" || s === "dormant") ? C.coral : (s === "new" ? C.sand : C.teal);

function statusBadge(a) {
  const [t, cls] = STATUS[a.status] || ["—", ""];
  const label = a.status === "leaver" && a.leaveDate ? t + " " + a.leaveDate : t;
  return h("span", { class: "tag " + cls, title: a.status === "dormant" ? "No logged cases for 6+ months" : "" }, label);
}
function roleBadge(role) { return h("span", { class: "tag " + role }, role === "advisor" ? "Advisor" : "Admin"); }

function exportSettings() {
  const url = URL.createObjectURL(new Blob([Settings.exportJSON()], { type: "application/json" }));
  const a = h("a", { href: url, download: "mo-staff-settings.json" }); a.click(); URL.revokeObjectURL(url);
}
function importSettings() {
  const inp = h("input", { type: "file", accept: "application/json" });
  inp.onchange = () => { const f = inp.files[0]; if (!f) return; const rd = new FileReader();
    rd.onload = () => { try { Settings.importJSON(JSON.parse(rd.result)); renderRoute(); } catch (e) { alert("Could not read that settings file."); } };
    rd.readAsText(f); };
  inp.click();
}

function pagePeople(v) {
  TEAM = teamView();
  const tabs = [["team", "Team"], ["compare", "Compare"], ["develop", "Develop"], ["handover", "Leaver handover"]];
  const seg = h("div", { class: "seg" });
  tabs.forEach(([k, label]) => seg.appendChild(h("button", {
    class: PEOPLE.tab === k ? "active" : "", onclick: () => { PEOPLE.tab = k; renderRoute(); }
  }, label)));
  v.appendChild(h("div", { class: "section-title" }, "👥 People — staff performance & development", h("span", { class: "spacer" }), seg));
  ({ team: peopleTeam, compare: peopleCompare, develop: peopleDevelop, handover: peopleHandover }[PEOPLE.tab] || peopleTeam)(v);
}

function peopleTeam(v) {
  const all = TEAM.advisers, b = TEAM.bench, live = TEAM.live;
  const rf = PEOPLE.roleFilter;
  const shown = all.filter(a => rf === "all" ? true : rf === "live" ? !a.leaver : a.role === rf);

  v.appendChild(h("div", { class: "kpis" },
    kcard(live.length, "Current team"),
    kcard(all.filter(a => a.leaver).length, "Marked as leavers"),
    kcard(all.filter(a => !a.leaver && a.status === "dormant").length, "Inactive 6m+ (unmarked)"),
    kcard(b.conversion + "%", "Median completion")));

  const ctrl = h("div", { class: "toolbar" });
  const rsel = h("select", { onchange: e => { PEOPLE.roleFilter = e.target.value; renderRoute(); } });
  [["all", "Everyone"], ["live", "Current only"], ["admin", "Admins"], ["advisor", "Advisors"]].forEach(([val, lab]) => {
    const o = h("option", { value: val }, lab); if (rf === val) o.setAttribute("selected", ""); rsel.appendChild(o);
  });
  ctrl.append(h("span", { class: "muted" }, "Show:"), rsel,
    h("button", { class: "btn sec", onclick: () => { if (PEOPLE.selected.size < 2) return alert("Tick at least two people to compare."); PEOPLE.tab = "compare"; renderRoute(); } }, "⇄ Compare selected"),
    h("span", { class: "spacer" }),
    h("button", { class: "btn sec", onclick: exportSettings }, "⬇ Export settings"),
    h("button", { class: "btn sec", onclick: importSettings }, "⬆ Import settings"));
  v.appendChild(ctrl);

  const live_shown = shown.filter(a => !a.leaver);
  v.appendChild(chartCard("Volume vs completion — bubble size = commission written",
    "Top-left = high quality / lower volume (capacity to grow); bottom-right = high volume / low completion (coaching). Dashed lines = team median. Click a bubble to review that person.", box =>
    Charts.scatter(box, live_shown.map(a => ({ x: a.cases, y: a.conversion, size: a.comm_written, label: a.adviser, color: statusColor(a.status) })),
      { xlabel: "Cases", ylabel: "Completion %", xMid: b.cases, yMid: b.conversion, onClick: p => { PEOPLE.leaver = p.label; PEOPLE.tab = "handover"; renderRoute(); } })));

  const cols = [
    { key: "sel", label: "⇄", node: a => { const cb = h("input", { type: "checkbox" }); cb.checked = PEOPLE.selected.has(a.adviser); cb.onchange = () => { cb.checked ? PEOPLE.selected.add(a.adviser) : PEOPLE.selected.delete(a.adviser); }; return cb; } },
    { key: "adviser", label: "Name" },
    { key: "role", label: "Role", node: a => { const s = h("select", { class: "mini", onchange: e => { Settings.setStaff(a.adviser, { role: e.target.value }); renderRoute(); } }); ["admin", "advisor"].forEach(rv => { const o = h("option", { value: rv }, rv[0].toUpperCase() + rv.slice(1)); if (a.role === rv) o.setAttribute("selected", ""); s.appendChild(o); }); return s; } },
    { key: "status", label: "Status", node: a => statusBadge(a) },
    { key: "leaver", label: "Leaver?", node: a => { const w = h("div", { class: "nowrap" }); const cb = h("input", { type: "checkbox" }); cb.checked = a.leaver; cb.onchange = () => { Settings.setStaff(a.adviser, { leaver: cb.checked }); renderRoute(); }; w.appendChild(cb); if (a.leaver) { const mi = h("input", { type: "month", class: "mini", value: a.leaveDate || "" }); mi.onchange = () => Settings.setStaff(a.adviser, { leaveDate: mi.value }); w.appendChild(mi); } return w; } },
    { key: "trend", label: "Activity", node: a => Charts.sparkline(a.monthly, { color: statusColor(a.status) }) },
    { key: "cases", label: "Cases", cls: "amt" },
    { key: "comm_written", label: "Comm", cls: "amt", fmt: gbp },
    { key: "protection_ratio", label: "Prot:Mort", cls: "amt", fmt: v => v + "%" },
    { key: "conversion", label: "Complete", cls: "amt", fmt: v => v + "%" },
    { key: "avg_fee", label: "Avg fee", cls: "amt", fmt: gbp },
    { key: "book_value", label: "Open book", cls: "amt", fmt: gbp },
  ];
  const c = card("Team roster", "Set each person’s Role and tick Leaver when they go. Completion % = mortgage cases with commission received; Open book = £ of unworked protection-gap + due remortgages they hold. Settings save on this device — use Export for a backup.");
  c.appendChild(dataTable(shown, cols, { sortKey: "comm_written", sortDir: -1, search: false }));
  v.appendChild(c);
}

const RADAR_AXES = [["cases", "Volume"], ["comm_written", "Commission"], ["protection_ratio", "Protection"], ["conversion", "Completion"], ["retention", "Retention"], ["avg_fee", "Avg fee"]];

function peopleCompare(v) {
  const advisers = TEAM.advisers;
  const chips = h("div", { class: "chips" });
  advisers.forEach(a => chips.appendChild(h("button", {
    class: "chip" + (PEOPLE.selected.has(a.adviser) ? " on" : ""),
    onclick: () => { PEOPLE.selected.has(a.adviser) ? PEOPLE.selected.delete(a.adviser) : (PEOPLE.selected.size < 4 && PEOPLE.selected.add(a.adviser)); renderRoute(); }
  }, a.adviser + (a.leaver ? " (left)" : ""))));
  const cc = card("Choose up to 4 to compare", "Selection carries over from the Team roster.");
  cc.appendChild(chips); v.appendChild(cc);

  const sel = advisers.filter(a => PEOPLE.selected.has(a.adviser));
  if (sel.length < 2) { v.appendChild(h("div", { class: "note muted" }, "Pick at least two people above to see the comparison.")); return; }

  const maxes = {}; RADAR_AXES.forEach(([k]) => maxes[k] = Math.max(1, ...advisers.map(a => a[k])));
  const grid = h("div", { class: "grid cols-2" });
  grid.appendChild(chartCard("Performance shape (each axis scaled to team best)", null, box =>
    Charts.radar(box, RADAR_AXES.map(x => x[1]), sel.map(a => ({ name: a.adviser, values: RADAR_AXES.map(([k]) => a[k] / maxes[k]) })))));
  grid.appendChild(chartCard("Commission written", null, box =>
    Charts.hbars(box, sel.map(a => ({ label: a.adviser, value: a.comm_written })), { money: true, color: C.sage })));
  v.appendChild(grid);

  const metrics = [["cases", "Cases", false], ["comm_written", "Commission", true], ["avg_comm", "Avg / case", true], ["avg_fee", "Avg fee", true], ["protection_ratio", "Protection:mortgage %", false], ["conversion", "Completion %", false], ["retention", "Retention %", false], ["book_value", "Open book £", true]];
  const c = card("Side-by-side", "Best in each row is highlighted. Use it for 1:1s and workload balancing.");
  const t = h("table"); const thr = h("tr", {}, h("th", {}, "Metric"));
  sel.forEach(a => thr.appendChild(h("th", { class: "amt" }, a.adviser)));
  t.appendChild(h("thead", {}, thr));
  const tb = h("tbody");
  // role row
  const rr = h("tr", {}, h("td", {}, "Role")); sel.forEach(a => rr.appendChild(h("td", { class: "amt" }, roleBadge(a.role)))); tb.appendChild(rr);
  metrics.forEach(([k, label, money]) => {
    const best = Math.max(...sel.map(a => a[k]));
    const tr = h("tr", {}, h("td", {}, label));
    sel.forEach(a => tr.appendChild(h("td", { class: "amt" + (a[k] === best ? " best" : "") }, money ? gbp(a[k]) : (k.includes("ratio") || k === "conversion" || k === "retention" ? a[k] + "%" : String(a[k])))));
    tb.appendChild(tr);
  });
  t.appendChild(tb); c.appendChild(t); v.appendChild(c);
}

function peopleDevelop(v) {
  const withOpps = TEAM.advisers.filter(a => !a.leaver && a.opportunities.length).sort((x, y) => y.opportunities.length - x.opportunities.length);
  v.appendChild(h("div", { class: "section-title" }, "🎓 Development opportunities — vs the median for their role"));
  if (!withOpps.length) v.appendChild(h("div", { class: "note muted" }, "No current staff are materially below their role benchmarks. 🎉"));
  const grid = h("div", { class: "grid cols-2" });
  withOpps.forEach(a => {
    const c = h("div", { class: "card dev" }, h("h3", {}, a.adviser, " ", roleBadge(a.role), " ", statusBadge(a)));
    a.opportunities.forEach(o => c.appendChild(h("div", { class: "opp" },
      h("div", { class: "opp-h" }, o.label, h("span", { class: "spacer" }), h("span", { class: "vs" }, (o.metric.startsWith("avg") ? gbp(o.value) : o.value + "%") + " vs " + (o.metric.startsWith("avg") ? gbp(o.benchmark) : o.benchmark + "%"))),
      h("div", { class: "meter" }, h("i", { class: "warn", style: "width:" + Math.min(100, Math.round(100 * o.value / (o.benchmark || 1))) + "%" })),
      h("div", { class: "opp-a" }, o.action))));
    grid.appendChild(c);
  });
  v.appendChild(grid);

  const stars = TEAM.advisers.filter(a => !a.leaver && !a.opportunities.length && a.status !== "new");
  if (stars.length) {
    const c = card("Doing well — potential mentors", "At or above their role median across the board.");
    c.appendChild(h("div", { class: "chips" }, stars.map(a => h("span", { class: "chip on" }, a.adviser))));
    v.appendChild(c);
  }
}

function peopleHandover(v) {
  const advisers = TEAM.advisers;
  const leavers = advisers.filter(a => a.leaver).map(a => a.adviser);
  const dormant = advisers.filter(a => a.status === "dormant").map(a => a.adviser);
  if (!PEOPLE.leaver || !adviserBy(PEOPLE.leaver)) PEOPLE.leaver = leavers[0] || dormant[0] || (advisers[0] && advisers[0].adviser);
  const sel = h("select", { onchange: e => { PEOPLE.leaver = e.target.value; renderRoute(); } });
  advisers.forEach(a => { const o = h("option", { value: a.adviser }, a.adviser + (a.leaver ? " — left" : a.status === "dormant" ? " — inactive" : "")); if (a.adviser === PEOPLE.leaver) o.setAttribute("selected", ""); sel.appendChild(o); });
  v.appendChild(h("div", { class: "section-title" }, "📦 Leaver handover — reassign an open book", h("span", { class: "spacer" }), sel));

  const a = adviserBy(PEOPLE.leaver); if (!a) return;
  if (a.leaver) v.appendChild(h("div", { class: "error" }, h("strong", {}, "🚪 Marked as a leaver" + (a.leaveDate ? " (" + a.leaveDate + ")" : "") + ". "), "Reassign the open work below so nothing slips."));
  else if (a.status === "dormant") v.appendChild(h("div", { class: "error" }, h("strong", {}, "⚠ No activity since " + a.last_active + " (" + a.idle_months + " months). "), "If they’ve left, tick “Leaver?” on the Team tab; meanwhile reassign their book below."));

  v.appendChild(h("div", { class: "kpis" },
    kcard(gbp(a.book_value), "Open book value"),
    kcard(a.pipeline_due, "Remortgage reviews due (6m)"),
    kcard(a.gap_clients, "Protection-gap clients"),
    kcard(a.life_only_clients, "Life-only clients")));

  const pipe = DATA.pipeline.filter(p => effectiveOwner(p) === PEOPLE.leaver && (p.overdue || (p.days_to_review >= 0 && p.days_to_review <= 180)));
  const bulk = h("div", { class: "toolbar" });
  const bsel = h("select", { class: "mini" });
  staffNames().filter(n => n !== PEOPLE.leaver).forEach(n => bsel.appendChild(h("option", { value: n }, n)));
  bulk.append(h("span", { class: "muted" }, "Reassign all " + pipe.length + " shown to:"), bsel,
    h("button", { class: "btn", onclick: () => { if (!bsel.value) return; pipe.forEach(p => Settings.setReassign(pipeId(p), bsel.value)); renderRoute(); } }, "Apply"));
  const pc = card("Remortgage reviews to reassign", "Time-critical — these clients are approaching maturity. Change Owner per row, or bulk-reassign.");
  pc.appendChild(bulk);
  pc.appendChild(dataTable(pipe, [
    { key: "review_date", label: "Review", cls: "nowrap", fmt: (v, r) => v + (r.overdue ? " ⚠" : "") },
    { key: "client", label: "Client" }, { key: "lender", label: "Lender" },
    { key: "amount", label: "Loan", cls: "amt", fmt: gbp },
    { key: "owner", label: "Owner", get: r => effectiveOwner(r), node: r => ownerSelect(r) },
  ], { sortKey: "review_date", sortDir: 1, search: false, maxRows: 500 }));
  v.appendChild(pc);

  const gap = DATA.protection_gap.filter(g => g.admin === PEOPLE.leaver);
  const gc = card("Protection-gap clients in this book", "Warm cross-sell leads — hand these to whoever picks up the relationship.");
  gc.appendChild(dataTable(gap, [
    { key: "client", label: "Client" }, { key: "property", label: "Property" },
    { key: "lender", label: "Lender" }, { key: "amount", label: "Loan", cls: "amt", fmt: gbp },
  ], { sortKey: "amount", sortDir: -1, search: false, maxRows: 500 }));
  v.appendChild(gc);

  const capacity = TEAM.live.filter(x => x.adviser !== PEOPLE.leaver)
    .sort((x, y) => (y.conversion - y.book_value / 5000) - (x.conversion - x.book_value / 5000)).slice(0, 4);
  if (capacity.length) {
    const c = card("Suggested people to take it on", "Current staff with strong completion rates and a lighter open book.");
    c.appendChild(h("div", { class: "chips" }, capacity.map(x => h("span", { class: "chip on" }, x.adviser + " · " + x.conversion + "% complete · book " + gbp(x.book_value)))));
    v.appendChild(c);
  }
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
const ROUTES = { overview: pageOverview, pipeline: pagePipeline, people: pagePeople, crosssell: pageCrosssell, referrals: pageReferrals, explorer: pageExplorer, quality: pageQuality };
const TITLES = { overview: "Overview", pipeline: "Pipeline", people: "People", crosssell: "Cross-sell", referrals: "Referrals", explorer: "Explorer", quality: "Data quality" };

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
  if (OFFLINE) { $("#btnRefresh").title = "Offline snapshot — live refresh needs the app running on a computer"; }
  $("#btnRefresh").onclick = async () => {
    if (OFFLINE) { alert("This is an offline snapshot of your sheet.\nLive refresh needs the app running on a computer (python app.py)."); return; }
    $("#btnRefresh").textContent = "↻ Refreshing…"; try { await fetch("/api/refresh", { method: "POST" }); await load(); } finally { $("#btnRefresh").textContent = "↻ Refresh data"; }
  };
  window.addEventListener("hashchange", renderRoute);
}
async function load() {
  const j = await fetchData();
  if (j.error) { $("#view").innerHTML = ""; $("#view").appendChild(h("div", { class: "error" }, h("strong", {}, "Could not load data. "), j.error + (j.hint ? " — " + j.hint : ""))); $("#srcLine").textContent = "data error"; return; }
  DATA = j; Settings.seed(DATA.adviser);
  $("#srcLine").textContent = `Source: ${DATA.source} · generated ${DATA.generated.replace("T", " ")} · ${DATA.kpis.total_rows} cases`;
  renderRoute();
}
(async function init() {
  const j = await fetchData();
  if (!j.error) { DATA = j; Settings.seed(DATA.adviser); populateFilters(); }
  wireControls();
  $("#srcLine").textContent = j.error ? "data error" : `Source: ${DATA.source} · ${DATA.kpis.total_rows} cases`;
  if (j.error) { $("#view").innerHTML = `<div class="error">Could not load data — ${j.error}${j.hint ? " — " + j.hint : ""}</div>`; }
  else renderRoute();
})();
