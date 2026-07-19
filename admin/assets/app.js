/* Mortgage Oasis admin dashboard.
   Data comes from /data/tracker.json (Business Register tabs of the Tracker
   sheet) and /data/statements.json (weekly TRM commission consolidation
   statements). Charts are hand-rolled SVG — no external libraries. */

(function () {
  "use strict";

  var state = {
    tracker: null,
    statements: null,
    year: "all",
    trackerFilters: { segment: "all", admin: "all", status: "all", search: "" },
    openStatement: null,
    unmatchedItems: [],
    recon: loadReconSettings(),
    includeGI: false,
    chases: loadChases(),
    overrides: loadOverrides(),
    worklistSort: "amount",
  };

  function loadChases() {
    try { return JSON.parse(localStorage.getItem("mo-chases") || "{}"); }
    catch (e) { return {}; }
  }

  function saveChases() {
    try { localStorage.setItem("mo-chases", JSON.stringify(state.chases)); } catch (e) {}
  }

  function loadOverrides() {
    try { return JSON.parse(localStorage.getItem("mo-overrides") || "{}"); }
    catch (e) { return {}; }
  }

  function saveOverrides() {
    try { localStorage.setItem("mo-overrides", JSON.stringify(state.overrides)); } catch (e) {}
  }

  function loadReconSettings() {
    var defaults = { days: 90, variancePct: 25 };
    try {
      var saved = JSON.parse(localStorage.getItem("mo-recon-settings") || "{}");
      return {
        days: Number(saved.days) > 0 ? Number(saved.days) : defaults.days,
        variancePct: Number(saved.variancePct) > 0 ? Number(saved.variancePct) : defaults.variancePct,
      };
    } catch (e) { return defaults; }
  }

  function saveReconSettings() {
    try { localStorage.setItem("mo-recon-settings", JSON.stringify(state.recon)); } catch (e) {}
  }

  var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---------- utilities ----------

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else if (k === "html") node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function gbp(value, opts) {
    if (value == null || isNaN(value)) return "—";
    opts = opts || {};
    var sign = value < 0 ? "−" : "";
    var abs = Math.abs(value);
    if (opts.compact && abs >= 10000) {
      return sign + "£" + (abs / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    }
    // Tables and tooltips show exact pence; only compact (KPI/chart) displays round.
    var dp = opts.compact ? 0 : (opts.dp != null ? opts.dp : 2);
    return sign + "£" + abs.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }

  function monthKey(iso) { return iso ? iso.slice(0, 7) : null; }

  function monthLabel(key) {
    var y = key.slice(0, 4), m = parseInt(key.slice(5, 7), 10);
    return MONTH_NAMES[m - 1] + " " + y.slice(2);
  }

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function niceCeil(value) {
    if (value <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(value)));
    var norm = value / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  // ---------- data access ----------

  function filteredCases() {
    return state.tracker.cases.filter(function (c) {
      return state.year === "all" || String(c.register) === state.year;
    });
  }

  function filteredStatements() {
    return state.statements.statements.filter(function (s) {
      return state.year === "all" || s.date.slice(0, 4) === state.year;
    });
  }

  function caseStatus(c) {
    if (c.commissionReceived != null) return "received";
    if (overrideFor(c)) return "manual";            // confirmed paid by the owner
    if (c._matchedPaid > 0) return "matched";       // paid per statements, not yet in tracker
    if (c.commissionWritten != null) return "outstanding";
    return "none";
  }

  function effectiveReceived(c) {
    if (c.commissionReceived != null) return c.commissionReceived;
    var ov = overrideFor(c);
    if (ov) return ov.amount != null ? ov.amount : (c.commissionWritten || 0);
    if (c._matchedPaid > 0) return c._matchedPaid;
    return null;
  }

  // ---------- manual override (confirmed paid) ----------
  // For commission the owner KNOWS has been paid but that isn't on any
  // statement (or wasn't detected by the matcher): mark the case as paid by
  // hand. Stored on this device like chases; undo any time from Needs review.

  function overrideFor(c) {
    return state.overrides[chaseKey(c)] || null;
  }

  function markPaidManually(c) {
    var suggested = c.commissionWritten != null ? String(c.commissionWritten.toFixed(2)) : "";
    var answer = window.prompt(
      "Confirm commission received for " + (c.client || "this case") +
      ".\nAmount received (£):", suggested);
    if (answer === null) return false; // cancelled
    var amount = parseFloat(String(answer).replace(/[£,\s]/g, ""));
    if (isNaN(amount)) amount = c.commissionWritten != null ? c.commissionWritten : 0;
    state.overrides[chaseKey(c)] = {
      confirmedOn: isoToday(),
      amount: Math.round(amount * 100) / 100,
    };
    saveOverrides();
    return true;
  }

  function clearOverride(c) {
    delete state.overrides[chaseKey(c)];
    saveOverrides();
  }

  function ageDays(iso) {
    if (!iso) return null;
    return Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86400000);
  }

  function isOverdue(c) {
    var status = caseStatus(c);
    if (status !== "outstanding") return false;
    var age = ageDays(c.date);
    return age != null && age > state.recon.days;
  }

  // Variance of what was actually paid vs the predicted (written) amount.
  function variancePct(c) {
    var rec = effectiveReceived(c);
    if (rec == null || !(c.commissionWritten > 0)) return null;
    return (rec / c.commissionWritten - 1) * 100;
  }

  function isVarianceFlagged(c) {
    var v = variancePct(c);
    return v != null && Math.abs(v) > state.recon.variancePct;
  }

  // ---------- chase workflow ----------
  // Chasing an overdue case opens a pre-filled Gmail compose to the network
  // and records the chase locally (this device) with a follow-up a week out.

  var CHASE_TO = "commissions@therightmortgage.co.uk";

  function chaseKey(c) {
    return [c.register, c.date, c.client, c.provider].join("|");
  }

  function chaseFor(c) {
    return state.chases[chaseKey(c)] || null;
  }

  function isoToday() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }

  function isoPlusDays(iso, days) {
    var d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + days);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }

  function shortDate(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T00:00:00");
    return d.getDate() + " " + MONTH_NAMES[d.getMonth()];
  }

  function isFollowUpDue(c) {
    var chase = chaseFor(c);
    return !!chase && caseStatus(c) === "outstanding" && isoToday() >= chase.followUpDue;
  }

  function chaseEmailUrl(c) {
    var subject = "Outstanding commission — " + (c.client || "client") +
      (c.provider ? " / " + c.provider : "");
    var lines = [
      "Hello,",
      "",
      "We have an outstanding commission payment that has not yet appeared on our consolidation statements, and I would like an update on when it will be paid.",
      "",
      "Client: " + (c.client || "—"),
      "Reference / property: " + (c.property || "—"),
      "Provider / lender: " + (c.provider || "—"),
      "Product: " + ((c.business || "") + (c.product && c.product !== c.business ? " — " + c.product : "") || "—"),
      "Date written: " + (c.date || "—"),
    ];
    if (c.completedDate) lines.push("Completed / on risk: " + c.completedDate);
    if (c.commissionWritten != null) lines.push("Commission due: " + gbp(c.commissionWritten));
    var age = ageDays(c.date);
    if (age != null) lines.push("Days outstanding: " + age);
    lines.push(
      "",
      "Please confirm the payment date, or include this commission on the next consolidation statement. If there is an issue holding up payment, let me know what is needed to resolve it.",
      "",
      "Kind regards,",
      "Mortgage Oasis Limited"
    );
    return "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(CHASE_TO) +
      "&su=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(lines.join("\n"));
  }

  function recordChase(c) {
    var today = isoToday();
    state.chases[chaseKey(c)] = { chasedOn: today, followUpDue: isoPlusDays(today, 7) };
    saveChases();
  }

  // ---------- statement ↔ tracker matching ----------
  // Runs once at load. Statement line items (ignoring trail/renewal noise)
  // are matched to tracker cases by client surname, then scored on provider,
  // amount vs predicted commission, and date proximity. This is what lets a
  // freshly dropped-in statements.json light up cases as paid automatically.

  var LENDER_ALIASES = {
    "lg": "legalandgeneral", "landg": "legalandgeneral", "legalgeneral": "legalandgeneral",
    "leedsbuildingsociety": "leeds", "skiptonbs": "skipton", "skiptonbuildingsociety": "skipton",
    "coventrymortgages": "coventry", "coventrybuildingsociety": "coventry",
    "virginmoney": "virgin", "lvgi": "lv", "liverpoolvictoria": "lv",
    "bmsolutions": "bm", "thecooperative": "cooperative", "cooperativebank": "cooperative",
    "berkleyalexander": "berkeleyalexander", "cirencesterfriendly": "cirencester",
    "natwestbank": "natwest", "nationwidebuildingsociety": "nationwide",
    "scottishwidowsbank": "scottishwidows",
  };

  function lenderKey(name) {
    if (!name) return "";
    var key = String(name).toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");
    return LENDER_ALIASES[key] || key;
  }

  function surnameTokens(text) {
    if (!text) return [];
    return String(text).toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/)
      .filter(function (t) { return t.length >= 3 && ["and", "the", "mrs"].indexOf(t) === -1; });
  }

  function itemSurname(item) {
    // Mortgage items look like "HOLMES /M625621600 J"; protection like "Cross".
    var raw = (item.surname || "").split("/")[0];
    return surnameTokens(raw)[0] || null;
  }

  function buildMatches() {
    var cases = state.tracker.cases;
    cases.forEach(function (c) {
      c._matchedPaid = 0;
      c._matchedItems = [];
      c._tokens = surnameTokens(c.client);
      c._lender = lenderKey(c.provider);
    });

    // index cases by every name token
    var index = {};
    cases.forEach(function (c) {
      c._tokens.forEach(function (t) {
        (index[t] = index[t] || []).push(c);
      });
    });

    var unmatched = [];
    state.statements.statements.forEach(function (s) {
      s.items.forEach(function (item) {
        // Trail/renewal drip (class R and tiny amounts) has no tracker case.
        if (item.class === "R" || Math.abs(item.amount) < 40) return;
        var surname = itemSurname(item);
        var candidates = (surname && index[surname]) || [];
        var best = null, bestScore = 0;
        candidates.forEach(function (c) {
          if (c.commissionWritten == null && c.commissionReceived == null) return;
          var score = 1; // surname matched
          if (c._lender && lenderKey(item.lender) === c._lender) score += 2;
          if (c.commissionReceived != null &&
              Math.abs(item.amount - c.commissionReceived) <= Math.max(1, c.commissionReceived * 0.01)) {
            score += 3; // exact match against the tracker's own received figure
          } else if (c.commissionWritten > 0) {
            var ratio = item.amount / c.commissionWritten;
            if (ratio >= 0.7 && ratio <= 1.1) score += 2;
            else if (ratio >= 0.4 && ratio <= 1.6) score += 1;
          }
          if (c.date && item.date) {
            var lag = (new Date(item.date) - new Date(c.date)) / 86400000;
            if (lag >= -45 && lag <= 550) score += 1;
            else score -= 2; // payment far outside the case's life
          }
          // prefer cases not already matched to an item
          if (c._matchedItems.length === 0) score += 0.5;
          if (score > bestScore) { bestScore = score; best = c; }
        });
        if (best && bestScore >= 4) {
          best._matchedPaid = Math.round((best._matchedPaid + item.amount) * 100) / 100;
          best._matchedItems.push({ date: item.date, lender: item.lender, amount: item.amount, statement: s.date });
        } else {
          unmatched.push({ statement: s.date, date: item.date, lender: item.lender,
                           name: ((item.firstName || "") + " " + (item.surname || "")).trim(),
                           type: item.type, amount: item.amount });
        }
      });
    });
    state.unmatchedItems = unmatched.sort(function (a, b) { return Math.abs(b.amount) - Math.abs(a.amount); });
  }

  function monthRange(keys) {
    if (!keys.length) return [];
    var sorted = keys.slice().sort();
    var out = [];
    var cur = sorted[0];
    var last = sorted[sorted.length - 1];
    while (cur <= last) {
      out.push(cur);
      var y = parseInt(cur.slice(0, 4), 10), m = parseInt(cur.slice(5, 7), 10);
      m += 1; if (m > 12) { m = 1; y += 1; }
      cur = y + "-" + String(m).padStart(2, "0");
    }
    return out;
  }

  // ---------- charts ----------

  function makeTip(wrap) {
    var tip = el("div", { class: "chart-tip" });
    wrap.appendChild(tip);
    return {
      show: function (html, x, y) {
        tip.innerHTML = html;
        tip.style.opacity = "1";
        var rect = wrap.getBoundingClientRect();
        var w = tip.offsetWidth, h = tip.offsetHeight;
        var left = Math.min(Math.max(4, x - w / 2), rect.width - w - 4);
        var top = y - h - 12;
        if (top < 0) top = y + 14;
        tip.style.left = left + "px";
        tip.style.top = top + "px";
      },
      hide: function () { tip.style.opacity = "0"; },
    };
  }

  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Spreadsheet-sourced strings pass through here into innerHTML — escape them.
  function tipRows(title, rows) {
    return '<div class="tip-title">' + esc(title) + "</div>" + rows.map(function (r) {
      return '<div class="tip-row"><span class="swatch" style="width:8px;height:8px;border-radius:2px;background:' +
        esc(r.color) + '"></span>' + esc(r.name) + "<b>" + esc(r.value) + "</b></div>";
    }).join("");
  }

  /* Grouped (or single-series) column chart.
     cfg: {labels, series: [{name, cssVar, values}], height} */
  function columnChart(container, cfg) {
    container.innerHTML = "";
    var wrap = el("div", { class: "chart-wrap" });
    container.appendChild(wrap);
    var tip = makeTip(wrap);

    var n = cfg.labels.length;
    if (!n) { wrap.appendChild(el("p", { class: "empty", text: "No data for this period." })); return; }

    var height = cfg.height || 260;
    var pad = { top: 14, right: 12, bottom: 26, left: 52 };
    var groupWidth = Math.max(cfg.series.length * 14 + 10, 30, 560 / n);
    var plotW = n * groupWidth;
    var width = plotW + pad.left + pad.right;
    var plotH = height - pad.top - pad.bottom;

    var maxVal = 0, minVal = 0;
    cfg.series.forEach(function (s) {
      s.values.forEach(function (v) {
        if (v == null) return;
        if (v > maxVal) maxVal = v;
        if (v < minVal) minVal = v;
      });
    });
    var yMax = niceCeil(maxVal || 1);
    var yMin = minVal < 0 ? -niceCeil(-minVal) : 0;
    var span = yMax - yMin;
    function yFor(v) { return pad.top + plotH * (yMax - v) / span; }
    var zeroY = yFor(0);

    var svg = svgEl("svg", { viewBox: "0 0 " + width + " " + height, width: width, height: height, role: "img" });
    wrap.appendChild(svg);

    // gridlines + ticks: clean steps across the span, always including zero
    var step = niceCeil(span / 4);
    var tickVals = [];
    for (var tv = Math.ceil(yMin / step) * step; tv <= yMax + 1e-9; tv += step) tickVals.push(tv);
    if (tickVals.indexOf(0) === -1) tickVals.push(0);
    tickVals.forEach(function (yv) {
      var y = yFor(yv);
      svg.appendChild(svgEl("line", {
        x1: pad.left, x2: pad.left + plotW, y1: y, y2: y,
        stroke: yv === 0 ? css("--baseline") : css("--grid"), "stroke-width": 1,
      }));
      var tick = svgEl("text", {
        x: pad.left - 8, y: y + 4, "text-anchor": "end",
        fill: css("--muted"), "font-size": 11,
      });
      tick.textContent = Math.abs(yv) >= 1000 ? (yv / 1000) + "K" : String(Math.round(yv));
      svg.appendChild(tick);
    });

    var barW = Math.min(24, groupWidth / cfg.series.length - 4);
    cfg.labels.forEach(function (label, i) {
      var gx = pad.left + i * groupWidth;
      // x label (thin out when crowded)
      var every = Math.max(1, Math.ceil(52 / groupWidth));
      if (i % every === 0) {
        var xl = svgEl("text", {
          x: gx + groupWidth / 2, y: height - 8, "text-anchor": "middle",
          fill: css("--muted"), "font-size": 11,
        });
        xl.textContent = label;
        svg.appendChild(xl);
      }
      var totalBars = cfg.series.length * barW + (cfg.series.length - 1) * 2;
      var startX = gx + (groupWidth - totalBars) / 2;
      cfg.series.forEach(function (s, si) {
        var v = s.values[i];
        if (v == null || v === 0) return;
        var x = startX + si * (barW + 2);
        var h = Math.max(2, plotH * Math.abs(v) / span);
        var r = Math.min(4, h / 2);
        var path;
        if (v > 0) {
          var y0 = zeroY - h;
          path = "M" + x + "," + zeroY +
            " L" + x + "," + (y0 + r) +
            " Q" + x + "," + y0 + " " + (x + r) + "," + y0 +
            " L" + (x + barW - r) + "," + y0 +
            " Q" + (x + barW) + "," + y0 + " " + (x + barW) + "," + (y0 + r) +
            " L" + (x + barW) + "," + zeroY + " Z";
        } else {
          var y1 = zeroY + h; // rounded data-end points down for debits
          path = "M" + x + "," + zeroY +
            " L" + x + "," + (y1 - r) +
            " Q" + x + "," + y1 + " " + (x + r) + "," + y1 +
            " L" + (x + barW - r) + "," + y1 +
            " Q" + (x + barW) + "," + y1 + " " + (x + barW) + "," + (y1 - r) +
            " L" + (x + barW) + "," + zeroY + " Z";
        }
        svg.appendChild(svgEl("path", { d: path, fill: css(s.cssVar) }));
      });
      // hover hit target for the whole group
      var hit = svgEl("rect", {
        x: gx, y: pad.top, width: groupWidth, height: plotH,
        fill: "transparent",
      });
      hit.addEventListener("mousemove", function (ev) {
        var rows = cfg.series.map(function (s) {
          return { name: s.name, color: css(s.cssVar), value: gbp(s.values[i] || 0) };
        });
        var rect = wrap.getBoundingClientRect();
        tip.show(tipRows(cfg.tipTitle ? cfg.tipTitle(i) : label, rows),
          ev.clientX - rect.left + wrap.scrollLeft, ev.clientY - rect.top);
      });
      hit.addEventListener("mouseleave", tip.hide);
      svg.appendChild(hit);
    });
  }

  /* Horizontal bar chart for categorical magnitude (single hue). */
  function hbarChart(container, cfg) {
    container.innerHTML = "";
    var wrap = el("div", { class: "chart-wrap" });
    container.appendChild(wrap);
    var tip = makeTip(wrap);

    var rows = cfg.rows.filter(function (r) { return r.value > 0; });
    if (!rows.length) { wrap.appendChild(el("p", { class: "empty", text: "No data for this period." })); return; }
    var rowH = 30, pad = { top: 4, right: 70, bottom: 4, left: 150 };
    var width = 580;
    var height = rows.length * rowH + pad.top + pad.bottom;
    var plotW = width - pad.left - pad.right;
    var maxVal = niceCeil(Math.max.apply(null, rows.map(function (r) { return r.value; })) || 1);

    var svg = svgEl("svg", { viewBox: "0 0 " + width + " " + height, width: "100%", role: "img" });
    svg.style.maxWidth = width + "px";
    wrap.appendChild(svg);

    rows.forEach(function (r, i) {
      var y = pad.top + i * rowH;
      var barH = 18;
      var w = Math.max(2, plotW * r.value / maxVal);
      var name = svgEl("text", {
        x: pad.left - 10, y: y + barH / 2 + 4.5, "text-anchor": "end",
        fill: css("--ink-2"), "font-size": 12.5,
      });
      name.textContent = r.label.length > 20 ? r.label.slice(0, 19) + "…" : r.label;
      svg.appendChild(name);
      var rr = Math.min(4, w / 2);
      var path = "M" + pad.left + "," + y +
        " L" + (pad.left + w - rr) + "," + y +
        " Q" + (pad.left + w) + "," + y + " " + (pad.left + w) + "," + (y + rr) +
        " L" + (pad.left + w) + "," + (y + barH - rr) +
        " Q" + (pad.left + w) + "," + (y + barH) + " " + (pad.left + w - rr) + "," + (y + barH) +
        " L" + pad.left + "," + (y + barH) + " Z";
      var bar = svgEl("path", { d: path, fill: css(cfg.cssVar || "--series-1") });
      svg.appendChild(bar);
      // value at the tip
      var val = svgEl("text", {
        x: pad.left + w + 8, y: y + barH / 2 + 4.5,
        fill: css("--ink-2"), "font-size": 12, "font-weight": 600,
      });
      val.textContent = gbp(r.value, { compact: true });
      svg.appendChild(val);

      var hit = svgEl("rect", { x: 0, y: y - 2, width: width, height: rowH, fill: "transparent" });
      hit.addEventListener("mousemove", function (ev) {
        var rect = wrap.getBoundingClientRect();
        tip.show(tipRows(r.label, [{ name: cfg.valueName || "Value", color: css(cfg.cssVar || "--series-1"), value: gbp(r.value) }]),
          ev.clientX - rect.left, ev.clientY - rect.top);
      });
      hit.addEventListener("mouseleave", tip.hide);
      svg.appendChild(hit);
    });
  }

  /* Single-series line chart with an area wash — for cumulative totals.
     cfg: {labels, values, cssVar, height, tipName} */
  function lineChart(container, cfg) {
    container.innerHTML = "";
    var wrap = el("div", { class: "chart-wrap" });
    container.appendChild(wrap);
    var tip = makeTip(wrap);

    var n = cfg.labels.length;
    if (!n) { wrap.appendChild(el("p", { class: "empty", text: "No data for this period." })); return; }

    var height = cfg.height || 240;
    var pad = { top: 14, right: 18, bottom: 26, left: 52 };
    var stepX = Math.max(18, 560 / Math.max(n - 1, 1));
    var plotW = stepX * Math.max(n - 1, 1);
    var width = plotW + pad.left + pad.right;
    var plotH = height - pad.top - pad.bottom;
    var yMax = niceCeil(Math.max.apply(null, cfg.values.concat([1])));
    var color = css(cfg.cssVar || "--series-1");

    var svg = svgEl("svg", { viewBox: "0 0 " + width + " " + height, width: width, height: height, role: "img" });
    wrap.appendChild(svg);

    for (var t = 0; t <= 4; t++) {
      var y = pad.top + plotH - plotH * t / 4;
      svg.appendChild(svgEl("line", {
        x1: pad.left, x2: pad.left + plotW, y1: y, y2: y,
        stroke: t === 0 ? css("--baseline") : css("--grid"), "stroke-width": 1,
      }));
      var tickV = yMax * t / 4;
      var tick = svgEl("text", { x: pad.left - 8, y: y + 4, "text-anchor": "end", fill: css("--muted"), "font-size": 11 });
      tick.textContent = tickV >= 1000 ? (tickV / 1000) + "K" : String(Math.round(tickV));
      svg.appendChild(tick);
    }

    function ptX(i) { return pad.left + i * stepX; }
    function ptY(i) { return pad.top + plotH * (1 - cfg.values[i] / yMax); }

    var lineD = "", areaD = "M" + ptX(0) + "," + (pad.top + plotH);
    for (var i = 0; i < n; i++) {
      lineD += (i ? " L" : "M") + ptX(i) + "," + ptY(i);
      areaD += " L" + ptX(i) + "," + ptY(i);
    }
    areaD += " L" + ptX(n - 1) + "," + (pad.top + plotH) + " Z";
    svg.appendChild(svgEl("path", { d: areaD, fill: color, opacity: 0.1 }));
    svg.appendChild(svgEl("path", { d: lineD, fill: "none", stroke: color, "stroke-width": 2,
      "stroke-linejoin": "round", "stroke-linecap": "round" }));
    // end marker: surface ring + dot, value label at the end
    svg.appendChild(svgEl("circle", { cx: ptX(n - 1), cy: ptY(n - 1), r: 6, fill: css("--surface") }));
    svg.appendChild(svgEl("circle", { cx: ptX(n - 1), cy: ptY(n - 1), r: 4, fill: color }));
    var endLabel = svgEl("text", {
      x: ptX(n - 1) - 6, y: ptY(n - 1) - 10, "text-anchor": "end",
      fill: css("--ink-2"), "font-size": 12, "font-weight": 600,
    });
    endLabel.textContent = gbp(cfg.values[n - 1], { compact: true });
    svg.appendChild(endLabel);

    // x labels, thinned
    var every = Math.max(1, Math.ceil(52 / stepX));
    for (var xi = 0; xi < n; xi += every) {
      var xl = svgEl("text", { x: ptX(xi), y: height - 8, "text-anchor": "middle", fill: css("--muted"), "font-size": 11 });
      xl.textContent = cfg.labels[xi];
      svg.appendChild(xl);
    }

    // crosshair + tooltip
    var cross = svgEl("line", { y1: pad.top, y2: pad.top + plotH, stroke: css("--baseline"), "stroke-width": 1, opacity: 0 });
    svg.appendChild(cross);
    var hit = svgEl("rect", { x: pad.left, y: pad.top, width: plotW, height: plotH, fill: "transparent" });
    hit.addEventListener("mousemove", function (ev) {
      var rect = wrap.getBoundingClientRect();
      var mx = ev.clientX - rect.left + wrap.scrollLeft;
      var i = Math.max(0, Math.min(n - 1, Math.round((mx - pad.left) / stepX)));
      cross.setAttribute("x1", ptX(i)); cross.setAttribute("x2", ptX(i));
      cross.setAttribute("opacity", 1);
      tip.show(tipRows(cfg.labels[i], [{ name: cfg.tipName || "Total", color: color, value: gbp(cfg.values[i]) }]),
        ev.clientX - rect.left + wrap.scrollLeft, ev.clientY - rect.top);
    });
    hit.addEventListener("mouseleave", function () { cross.setAttribute("opacity", 0); tip.hide(); });
    svg.appendChild(hit);
  }

  /* Stacked column chart (positive values only) with 2px surface gaps between
     segments; only the top segment of each stack gets the rounded data-end.
     cfg: {labels, series: [{name, cssVar, values}], height, tipTitle} */
  function stackedChart(container, cfg) {
    container.innerHTML = "";
    var wrap = el("div", { class: "chart-wrap" });
    container.appendChild(wrap);
    var tip = makeTip(wrap);

    var n = cfg.labels.length;
    if (!n) { wrap.appendChild(el("p", { class: "empty", text: "No data for this period." })); return; }

    var height = cfg.height || 260;
    var pad = { top: 14, right: 12, bottom: 26, left: 52 };
    var groupWidth = Math.max(30, 560 / n);
    var plotW = n * groupWidth;
    var width = plotW + pad.left + pad.right;
    var plotH = height - pad.top - pad.bottom;

    var totals = cfg.labels.map(function (_, i) {
      return cfg.series.reduce(function (a, s) { return a + Math.max(0, s.values[i] || 0); }, 0);
    });
    var yMax = niceCeil(Math.max.apply(null, totals.concat([1])));

    var svg = svgEl("svg", { viewBox: "0 0 " + width + " " + height, width: width, height: height, role: "img" });
    wrap.appendChild(svg);

    for (var t = 0; t <= 4; t++) {
      var y = pad.top + plotH - plotH * t / 4;
      svg.appendChild(svgEl("line", {
        x1: pad.left, x2: pad.left + plotW, y1: y, y2: y,
        stroke: t === 0 ? css("--baseline") : css("--grid"), "stroke-width": 1,
      }));
      var tickV = yMax * t / 4;
      var tick = svgEl("text", { x: pad.left - 8, y: y + 4, "text-anchor": "end", fill: css("--muted"), "font-size": 11 });
      tick.textContent = tickV >= 1000 ? (tickV / 1000) + "K" : String(Math.round(tickV));
      svg.appendChild(tick);
    }

    var barW = Math.min(24, groupWidth - 8);
    cfg.labels.forEach(function (label, i) {
      var gx = pad.left + i * groupWidth;
      var every = Math.max(1, Math.ceil(52 / groupWidth));
      if (i % every === 0) {
        var xl = svgEl("text", { x: gx + groupWidth / 2, y: height - 8, "text-anchor": "middle", fill: css("--muted"), "font-size": 11 });
        xl.textContent = label;
        svg.appendChild(xl);
      }
      var x = gx + (groupWidth - barW) / 2;
      var yCursor = pad.top + plotH; // build the stack bottom-up
      var segs = cfg.series.map(function (s) { return Math.max(0, s.values[i] || 0); });
      var topIdx = -1;
      segs.forEach(function (v, si) { if (v > 0) topIdx = si; });
      segs.forEach(function (v, si) {
        if (v <= 0) return;
        var h = Math.max(1.5, plotH * v / yMax);
        var yTop = yCursor - h;
        if (si === topIdx) {
          var r = Math.min(4, h / 2);
          svg.appendChild(svgEl("path", { d:
            "M" + x + "," + yCursor +
            " L" + x + "," + (yTop + r) +
            " Q" + x + "," + yTop + " " + (x + r) + "," + yTop +
            " L" + (x + barW - r) + "," + yTop +
            " Q" + (x + barW) + "," + yTop + " " + (x + barW) + "," + (yTop + r) +
            " L" + (x + barW) + "," + yCursor + " Z",
            fill: css(cfg.series[si].cssVar) }));
        } else {
          svg.appendChild(svgEl("rect", { x: x, y: yTop, width: barW, height: h, fill: css(cfg.series[si].cssVar) }));
        }
        yCursor = yTop - 2; // 2px surface gap between segments
      });

      var hit = svgEl("rect", { x: gx, y: pad.top, width: groupWidth, height: plotH, fill: "transparent" });
      hit.addEventListener("mousemove", function (ev) {
        var rows = cfg.series.map(function (s) {
          return { name: s.name, color: css(s.cssVar), value: gbp(s.values[i] || 0) };
        });
        rows.push({ name: "Total", color: css("--muted"), value: gbp(totals[i]) });
        var rect = wrap.getBoundingClientRect();
        tip.show(tipRows(cfg.tipTitle ? cfg.tipTitle(i) : label, rows),
          ev.clientX - rect.left + wrap.scrollLeft, ev.clientY - rect.top);
      });
      hit.addEventListener("mouseleave", tip.hide);
      svg.appendChild(hit);
    });
  }

  function legend(series) {
    return el("div", { class: "legend" }, series.map(function (s) {
      return el("span", { class: "key" }, [
        el("span", { class: "swatch", style: "background:" + css(s.cssVar) }),
        el("span", { text: s.name }),
      ]);
    }));
  }

  // ---------- overview view ----------

  function renderOverview() {
    var root = document.getElementById("view-overview");
    root.innerHTML = "";
    var cases = filteredCases();
    var stmts = filteredStatements();

    var written = 0, received = 0, fees = 0, outstanding = 0;
    cases.forEach(function (c) {
      written += c.commissionWritten || 0;
      received += c.commissionReceived || 0;
      fees += c.brokerFee || 0;
      if (caseStatus(c) === "outstanding") outstanding += c.commissionWritten || 0;
    });
    var stmtTotal = stmts.reduce(function (a, s) { return a + s.total; }, 0);

    var tiles = el("div", { class: "tile-row" });
    [
      { label: "Commission written (predicted)", value: gbp(written, { compact: true }) },
      { label: "Commission received (tracker)", value: gbp(received, { compact: true }) },
      { label: "Predicted, not yet received", value: gbp(outstanding, { compact: true }) },
      { label: "Broker fees", value: gbp(fees, { compact: true }) },
      { label: "Statement income (TRM)", value: gbp(stmtTotal, { compact: true }) },
      { label: "Cases", value: String(cases.length) },
    ].forEach(function (tdef) {
      tiles.appendChild(el("div", { class: "tile" }, [
        el("div", { class: "label", text: tdef.label }),
        el("div", { class: "value", text: tdef.value }),
      ]));
    });
    root.appendChild(tiles);

    // monthly written vs received (by month the business was written)
    var byMonth = {};
    cases.forEach(function (c) {
      var k = monthKey(c.date);
      if (!k) return;
      byMonth[k] = byMonth[k] || { written: 0, received: 0 };
      byMonth[k].written += c.commissionWritten || 0;
      byMonth[k].received += c.commissionReceived || 0;
    });
    var months = monthRange(Object.keys(byMonth));
    var card1 = el("div", { class: "card" });
    var head1 = el("div", { class: "card-head" }, [
      el("div", {}, [
        el("h2", { text: "Commission written vs received, by month written" }),
        el("div", { class: "sub", text: "Each month compares commission predicted at the point of writing with what has since been received for those same cases." }),
      ]),
      el("div", { class: "spacer" }),
      legend([
        { name: "Written (predicted)", cssVar: "--series-2" },
        { name: "Received", cssVar: "--series-1" },
      ]),
    ]);
    card1.appendChild(head1);
    var chart1 = el("div");
    card1.appendChild(chart1);
    root.appendChild(card1);
    columnChart(chart1, {
      labels: months.map(monthLabel),
      tipTitle: function (i) { return monthLabel(months[i]); },
      series: [
        { name: "Written (predicted)", cssVar: "--series-2", values: months.map(function (m) { return (byMonth[m] || {}).written || 0; }) },
        { name: "Received", cssVar: "--series-1", values: months.map(function (m) { return (byMonth[m] || {}).received || 0; }) },
      ],
    });

    // cumulative statement income + monthly business mix
    var twoNew = el("div", { class: "two-col" });
    root.appendChild(twoNew);

    var byStmtMonthCum = {};
    stmts.forEach(function (s) {
      var k = monthKey(s.date);
      byStmtMonthCum[k] = (byStmtMonthCum[k] || 0) + s.total;
    });
    var cumMonths = monthRange(Object.keys(byStmtMonthCum));
    var running = 0;
    var cumValues = cumMonths.map(function (m) { running += byStmtMonthCum[m] || 0; return Math.round(running * 100) / 100; });
    var cardCum = el("div", { class: "card" });
    cardCum.appendChild(el("div", { class: "card-head" }, [
      el("div", {}, [
        el("h2", { text: "Cumulative statement income" }),
        el("div", { class: "sub", text: "Running total of everything the network has paid, month by month." }),
      ]),
    ]));
    var chartCum = el("div");
    cardCum.appendChild(chartCum);
    twoNew.appendChild(cardCum);
    lineChart(chartCum, {
      labels: cumMonths.map(monthLabel),
      values: cumValues,
      tipName: "Paid to date",
      height: 250,
    });

    // fixed palette-order segments; anything else folds into Other
    var MIX_SEGMENTS = [
      { key: "Mortgage", cssVar: "--series-1" },
      { key: "Protection", cssVar: "--series-2" },
      { key: "General Insurance", cssVar: "--series-3" },
      { key: "Other", cssVar: "--series-4" },
    ];
    var mixByMonth = {};
    cases.forEach(function (c) {
      var k = monthKey(c.date);
      if (!k || !(c.commissionWritten > 0)) return;
      var seg = (c.segment === "Mortgage" || c.segment === "Protection" || c.segment === "General Insurance") ? c.segment : "Other";
      mixByMonth[k] = mixByMonth[k] || {};
      mixByMonth[k][seg] = (mixByMonth[k][seg] || 0) + c.commissionWritten;
    });
    var mixMonths = monthRange(Object.keys(mixByMonth));
    var cardMix = el("div", { class: "card" });
    cardMix.appendChild(el("div", { class: "card-head" }, [
      el("div", {}, [
        el("h2", { text: "Business mix by month" }),
        el("div", { class: "sub", text: "Commission written each month, stacked by business type." }),
      ]),
      el("div", { class: "spacer" }),
      legend(MIX_SEGMENTS.map(function (s) { return { name: s.key, cssVar: s.cssVar }; })),
    ]));
    var chartMix = el("div");
    cardMix.appendChild(chartMix);
    twoNew.appendChild(cardMix);
    stackedChart(chartMix, {
      labels: mixMonths.map(monthLabel),
      height: 250,
      tipTitle: function (i) { return monthLabel(mixMonths[i]); },
      series: MIX_SEGMENTS.map(function (s) {
        return { name: s.key, cssVar: s.cssVar,
          values: mixMonths.map(function (m) { return (mixByMonth[m] || {})[s.key] || 0; }) };
      }),
    });

    // statement income by month + segment split
    var two = el("div", { class: "two-col" });
    root.appendChild(two);

    var byStmtMonth = {};
    stmts.forEach(function (s) {
      var k = monthKey(s.date);
      byStmtMonth[k] = (byStmtMonth[k] || 0) + s.total;
    });
    var sMonths = monthRange(Object.keys(byStmtMonth));
    var card2 = el("div", { class: "card" });
    card2.appendChild(el("div", { class: "card-head" }, [
      el("div", {}, [
        el("h2", { text: "Statement income by month" }),
        el("div", { class: "sub", text: "Weekly TRM consolidation statement totals, grouped by statement month." }),
      ]),
    ]));
    var chart2 = el("div");
    card2.appendChild(chart2);
    two.appendChild(card2);
    columnChart(chart2, {
      labels: sMonths.map(monthLabel),
      height: 240,
      tipTitle: function (i) { return monthLabel(sMonths[i]); },
      series: [
        { name: "Paid", cssVar: "--series-1", values: sMonths.map(function (m) { return byStmtMonth[m] || 0; }) },
      ],
    });

    var bySegment = {};
    cases.forEach(function (c) {
      bySegment[c.segment] = bySegment[c.segment] || 0;
      bySegment[c.segment] += c.commissionWritten || 0;
    });
    var card3 = el("div", { class: "card" });
    card3.appendChild(el("div", { class: "card-head" }, [
      el("div", {}, [
        el("h2", { text: "Commission written by business type" }),
        el("div", { class: "sub", text: "Tracker cases grouped into business segments." }),
      ]),
    ]));
    var chart3 = el("div");
    card3.appendChild(chart3);
    two.appendChild(card3);
    hbarChart(chart3, {
      valueName: "Written",
      rows: Object.keys(bySegment).map(function (k) {
        return { label: k, value: bySegment[k] };
      }).sort(function (a, b) { return b.value - a.value; }),
    });

    // top providers (group case-insensitively; keep the tidiest display name)
    var byProvider = {};
    cases.forEach(function (c) {
      if (!c.provider) return;
      var label = c.provider.trim().replace(/\s+/g, " ");
      var key = label.toLowerCase();
      if (!byProvider[key]) byProvider[key] = { label: label, value: 0 };
      if (label[0] && label[0] === label[0].toUpperCase()) byProvider[key].label = label;
      byProvider[key].value += c.commissionWritten || 0;
    });
    var top = Object.keys(byProvider).map(function (k) { return byProvider[k]; })
      .sort(function (a, b) { return b.value - a.value; }).slice(0, 10);
    var card4 = el("div", { class: "card" });
    card4.appendChild(el("div", { class: "card-head" }, [
      el("div", {}, [
        el("h2", { text: "Top providers by commission written" }),
        el("div", { class: "sub", text: "Top 10 lenders / providers across the selected period." }),
      ]),
    ]));
    var chart4 = el("div");
    card4.appendChild(chart4);
    root.appendChild(card4);
    hbarChart(chart4, { valueName: "Written", rows: top });
  }

  // ---------- tracker view ----------

  function renderTracker() {
    var root = document.getElementById("view-tracker");
    root.innerHTML = "";
    var all = filteredCases();
    var f = state.trackerFilters;

    var segments = {}, admins = {};
    all.forEach(function (c) {
      if (c.segment) segments[c.segment] = 1;
      if (c.admin) admins[c.admin.trim()] = 1;
    });

    var rows = all.filter(function (c) {
      if (f.segment !== "all" && c.segment !== f.segment) return false;
      if (f.admin !== "all" && (c.admin || "").trim() !== f.admin) return false;
      if (f.status !== "all" && caseStatus(c) !== f.status) return false;
      if (f.search) {
        var text = ((c.client || "") + " " + (c.property || "") + " " + (c.provider || "")).toLowerCase();
        if (text.indexOf(f.search.toLowerCase()) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });

    var written = 0, received = 0, feesSum = 0;
    rows.forEach(function (c) {
      written += c.commissionWritten || 0;
      received += c.commissionReceived || 0;
      feesSum += c.brokerFee || 0;
    });

    var tiles = el("div", { class: "tile-row" });
    [
      { label: "Cases shown", value: String(rows.length) },
      { label: "Commission written", value: gbp(written, { compact: true }) },
      { label: "Commission received", value: gbp(received, { compact: true }) },
      { label: "Broker fees", value: gbp(feesSum, { compact: true }) },
    ].forEach(function (tdef) {
      tiles.appendChild(el("div", { class: "tile" }, [
        el("div", { class: "label", text: tdef.label }),
        el("div", { class: "value", text: tdef.value }),
      ]));
    });
    root.appendChild(tiles);

    var card = el("div", { class: "card" });
    root.appendChild(card);

    function select(name, options, current, allLabel) {
      var s = el("select", { class: "select", "aria-label": name });
      s.appendChild(el("option", { value: "all", text: allLabel }));
      options.sort().forEach(function (o) {
        var opt = el("option", { value: o, text: o });
        if (o === current) opt.selected = true;
        s.appendChild(opt);
      });
      s.value = current;
      return s;
    }

    var segSel = select("Segment", Object.keys(segments), f.segment, "All types");
    segSel.addEventListener("change", function () { f.segment = segSel.value; renderTracker(); });
    var admSel = select("Administrator", Object.keys(admins), f.admin, "All administrators");
    admSel.addEventListener("change", function () { f.admin = admSel.value; renderTracker(); });
    var statSel = el("select", { class: "select", "aria-label": "Status" });
    [["all", "Any status"], ["received", "Commission received"],
     ["matched", "Paid per statements"], ["manual", "Paid (manual override)"],
     ["outstanding", "Awaiting commission"],
     ["none", "No commission recorded"]].forEach(function (p) {
      var opt = el("option", { value: p[0], text: p[1] });
      if (p[0] === f.status) opt.selected = true;
      statSel.appendChild(opt);
    });
    statSel.addEventListener("change", function () { f.status = statSel.value; renderTracker(); });
    var search = el("input", { class: "search", type: "search", placeholder: "Search client, property, provider…" });
    search.value = f.search;
    search.addEventListener("input", function () {
      f.search = search.value;
      clearTimeout(search._t);
      search._t = setTimeout(renderTracker, 200);
    });

    card.appendChild(el("div", { class: "filters" }, [segSel, admSel, statSel, search]));

    var table = el("table", { class: "data" });
    var thead = el("thead", {}, [el("tr", {}, [
      el("th", { text: "Date" }),
      el("th", { text: "Client" }),
      el("th", { text: "Business" }),
      el("th", { text: "Provider" }),
      el("th", { text: "Admin" }),
      el("th", { class: "num", text: "Amount" }),
      el("th", { class: "num", text: "Broker fee" }),
      el("th", { class: "num", text: "Written" }),
      el("th", { class: "num", text: "Received" }),
      el("th", { text: "Status" }),
    ])]);
    table.appendChild(thead);
    var tbody = el("tbody");
    rows.forEach(function (c) {
      var status = caseStatus(c);
      var badge = status === "received"
        ? el("span", { class: "badge ok", text: "Received" })
        : status === "manual"
          ? el("span", { class: "badge stmt", text: "Paid (manual)", title: "Confirmed by hand: " + gbp(effectiveReceived(c)) })
        : status === "matched"
          ? el("span", { class: "badge stmt", text: "Paid (stmt)", title: "Matched to statement payment of " + gbp(c._matchedPaid) })
          : status === "outstanding"
            ? (isOverdue(c)
                ? el("span", { class: "badge bad", text: "Overdue" })
                : el("span", { class: "badge wait", text: "Awaiting" }))
            : el("span", { text: "—" });
      var statusCell = el("td", {}, [badge]);
      if (isVarianceFlagged(c)) {
        var v = variancePct(c);
        statusCell.appendChild(document.createTextNode(" "));
        statusCell.appendChild(el("span", {
          class: "badge bad",
          text: (v > 0 ? "+" : "") + v.toFixed(0) + "%",
          title: "Paid differs from predicted by more than " + state.recon.variancePct + "%",
        }));
      }
      tbody.appendChild(el("tr", {}, [
        el("td", { text: c.date || "—" }),
        el("td", { text: c.client || "—", title: c.property || "" }),
        el("td", { text: (c.business || c.segment || "—") + (c.product && c.product !== c.business ? " · " + c.product : "") }),
        el("td", { text: c.provider || "—" }),
        el("td", { text: c.admin || "—" }),
        el("td", { class: "num", text: c.amount != null ? gbp(c.amount) : "—" }),
        el("td", { class: "num", text: c.brokerFee != null ? gbp(c.brokerFee) : "—" }),
        el("td", { class: "num", text: c.commissionWritten != null ? gbp(c.commissionWritten) : "—" }),
        el("td", { class: "num " + (c.commissionReceived != null ? "pos" : ""), text: c.commissionReceived != null ? gbp(c.commissionReceived) : "—" }),
        statusCell,
      ]));
    });
    table.appendChild(tbody);
    card.appendChild(el("div", { class: "table-scroll" }, [table]));
    card.appendChild(el("p", { class: "table-note", text: "Hover a client for the property address. Data comes straight from the Tracker sheet's Business Register tabs." }));
  }

  // ---------- reconciliation view ----------

  function sliderBlock(labelText, valueText, min, max, step, value, onInput) {
    var label = el("div", { class: "slider-label" }, [
      el("span", { text: labelText }),
      el("b", { text: valueText }),
    ]);
    var input = el("input", { type: "range", min: min, max: max, step: step, value: value });
    input.addEventListener("input", function () { onInput(Number(input.value), label); });
    return el("div", { class: "slider-block" }, [label, input]);
  }

  // Aging buckets for outstanding receivables. Fixed 30/60/90-day bands (the
  // convention for aged debt); a band entirely past the overdue slider is red.
  var AGING_BUCKETS = [
    { name: "0–30 days", min: 0, max: 30 },
    { name: "31–60 days", min: 31, max: 60 },
    { name: "61–90 days", min: 61, max: 90 },
    { name: "90+ days", min: 91, max: Infinity },
  ];

  function renderReconciliation() {
    var root = document.getElementById("view-reconciliation");
    root.innerHTML = "";
    var cases = filteredCases();

    var heroWrap = el("div");
    root.appendChild(heroWrap);

    // thresholds card with the two sliding scales
    var settings = el("div", { class: "card" });
    settings.appendChild(el("div", { class: "card-head" }, [
      el("div", {}, [
        el("h2", { text: "Highlight thresholds" }),
        el("div", { class: "sub", text: "Both scales apply everywhere on the dashboard and are remembered on this device." }),
      ]),
    ]));
    var sliders = el("div", { class: "sliders" });
    sliders.appendChild(sliderBlock(
      "Overdue after", state.recon.days + " days", 7, 365, 7, state.recon.days,
      function (v, label) {
        state.recon.days = v;
        label.querySelector("b").textContent = v + " days";
        saveReconSettings();
        clearTimeout(sliders._t); sliders._t = setTimeout(renderAllExceptRecon, 150);
        refreshReconTables();
      }));
    sliders.appendChild(sliderBlock(
      "Variance threshold", state.recon.variancePct + "%", 1, 60, 1, state.recon.variancePct,
      function (v, label) {
        state.recon.variancePct = v;
        label.querySelector("b").textContent = v + "%";
        saveReconSettings();
        clearTimeout(sliders._t); sliders._t = setTimeout(renderAllExceptRecon, 150);
        refreshReconTables();
      }));
    settings.appendChild(sliders);
    settings.appendChild(el("p", {
      class: "slider-note",
      text: "Outstanding cases older than the overdue limit get a Chase button. Cases whose paid amount differs from the predicted commission by more than the variance threshold are flagged for checking.",
    }));
    root.appendChild(settings);

    var tablesWrap = el("div");
    root.appendChild(tablesWrap);

    function refreshReconTables() {
      heroWrap.innerHTML = "";
      tablesWrap.innerHTML = "";

      var outstanding = cases.filter(function (c) { return caseStatus(c) === "outstanding"; });
      var overdue = outstanding.filter(isOverdue);
      var matchedOnly = cases.filter(function (c) { return caseStatus(c) === "matched"; });
      var outstandingSum = outstanding.reduce(function (a, c) { return a + (c.commissionWritten || 0); }, 0);

      // ---- hero: outstanding-to-chase + aging ----
      var buckets = AGING_BUCKETS.map(function (b) {
        var inBucket = outstanding.filter(function (c) {
          var age = ageDays(c.date);
          return age != null && age >= b.min && age <= b.max;
        });
        return {
          name: b.name,
          overdue: b.min > state.recon.days,
          sum: inBucket.reduce(function (a, c) { return a + (c.commissionWritten || 0); }, 0),
          count: inBucket.length,
        };
      });
      var bucketMax = Math.max.apply(null, buckets.map(function (b) { return b.sum; }).concat([1]));

      var agingRows = el("div", { class: "aging" });
      buckets.forEach(function (b) {
        agingRows.appendChild(el("div", { class: "aging-row" }, [
          el("div", { class: "aging-name", text: b.name }),
          el("div", { class: "aging-track" }, [
            el("div", { class: "aging-bar" + (b.overdue ? " overdue" : ""),
              style: "width:" + (b.sum / bucketMax * 100).toFixed(1) + "%" }),
          ]),
          el("div", { class: "aging-val", html: gbp(b.sum, { compact: true }) +
            '<span class="count">' + b.count + "</span>" }),
        ]));
      });

      var hero = el("div", { class: "card" }, [
        el("div", { class: "hero" }, [
          el("div", {}, [
            el("div", { class: "hero-label", text: "Outstanding to chase" }),
            el("div", { class: "hero-figure" + (outstandingSum ? "" : " zero"), text: gbp(outstandingSum) }),
            el("div", { class: "hero-sub", text: outstanding.length + " cases awaiting commission · " +
              overdue.length + " overdue (" + gbp(overdue.reduce(function (a, c) { return a + (c.commissionWritten || 0); }, 0), { compact: true }) + ")" }),
          ]),
          el("div", {}, [
            el("div", { class: "hero-label", text: "Age of outstanding commission" }),
            agingRows,
          ]),
        ]),
      ]);
      heroWrap.appendChild(hero);

      // ---- worklist: outstanding → chased → paid ----
      var card1 = el("div", { class: "card" });
      var sortBtns = el("div", { class: "sort-btns" }, [
        el("button", { class: "sort-btn" + (state.worklistSort === "amount" ? " active" : ""), text: "Biggest first",
          onclick: function () { state.worklistSort = "amount"; refreshReconTables(); } }),
        el("button", { class: "sort-btn" + (state.worklistSort === "age" ? " active" : ""), text: "Oldest first",
          onclick: function () { state.worklistSort = "age"; refreshReconTables(); } }),
      ]);
      card1.appendChild(el("div", { class: "card-head" }, [
        el("div", {}, [
          el("h2", { text: "Chase worklist" }),
          el("div", { class: "sub", text: "Written business with no commission received yet. Chase the overdue ones; a case drops off once a statement payment or the tracker records it as received." }),
        ]),
        el("div", { class: "spacer" }),
        sortBtns,
      ]));
      var t1 = el("table", { class: "data" });
      t1.appendChild(el("thead", {}, [el("tr", {}, [
        el("th", { text: "Date" }), el("th", { text: "Client" }), el("th", { text: "Business" }),
        el("th", { text: "Provider" }), el("th", { class: "num", text: "Predicted" }),
        el("th", { class: "num", text: "Days" }), el("th", { text: "Status" }),
        el("th", { text: "Action" }),
      ])]));
      var tb1 = el("tbody");
      var sortedWork = outstanding.slice().sort(function (a, b) {
        if (state.worklistSort === "amount") return (b.commissionWritten || 0) - (a.commissionWritten || 0);
        return (a.date || "").localeCompare(b.date || ""); // oldest first
      });
      sortedWork.forEach(function (c) {
        var age = ageDays(c.date);
        var chase = chaseFor(c);
        var statusBits = [];
        if (isFollowUpDue(c)) statusBits.push(el("span", { class: "badge bad", text: "Follow up due" }));
        else if (isOverdue(c)) statusBits.push(el("span", { class: "badge bad", text: "Overdue" }));
        else statusBits.push(el("span", { class: "badge wait", text: "Awaiting" }));
        if (chase) statusBits.push(el("span", {
          class: "chase-meta",
          text: "Chased " + shortDate(chase.chasedOn) + " · follow up " + shortDate(chase.followUpDue),
        }));
        var actionCell = el("td", { class: "action-cell" });
        if (isOverdue(c)) {
          var btn = el("button", { class: "chase-btn", text: chase ? "Chase again" : "Chase" });
          btn.addEventListener("click", function () {
            window.open(chaseEmailUrl(c), "_blank", "noopener");
            recordChase(c);
            refreshReconTables();
          });
          actionCell.appendChild(btn);
        }
        var paidBtn = el("button", {
          class: "chase-btn quiet",
          text: "Mark paid",
          title: "Commission confirmed received but not showing on a statement — record it by hand",
        });
        paidBtn.addEventListener("click", function () {
          if (markPaidManually(c)) { renderAllExceptRecon(); refreshReconTables(); }
        });
        actionCell.appendChild(paidBtn);
        tb1.appendChild(el("tr", {}, [
          el("td", { text: c.date || "—" }),
          el("td", { text: c.client || "—", title: c.property || "" }),
          el("td", { text: c.business || c.segment || "—" }),
          el("td", { text: c.provider || "—" }),
          el("td", { class: "num", text: gbp(c.commissionWritten) }),
          el("td", { class: "num", text: age != null ? String(age) : "—" }),
          el("td", {}, statusBits),
          actionCell,
        ]));
      });
      if (!outstanding.length) tb1.appendChild(el("tr", {}, [el("td", { colspan: "8", class: "empty", text: "Nothing outstanding in this period — all commission accounted for." })]));
      t1.appendChild(tb1);
      card1.appendChild(el("div", { class: "table-scroll" }, [t1]));
      tablesWrap.appendChild(card1);

      // ---- tracker vs statement: predicted vs paid, shortfalls ----
      // Every case with a payment (tracker "received" or a statement match)
      // where predicted and paid diverge by at least £1, biggest gap first.
      var compare = cases.filter(function (c) {
        var paid = effectiveReceived(c);
        return paid != null && c.commissionWritten > 0 &&
          Math.abs((c.commissionWritten || 0) - paid) >= 1;
      }).map(function (c) {
        return { c: c, shortfall: (c.commissionWritten || 0) - effectiveReceived(c) };
      }).sort(function (a, b) { return Math.abs(b.shortfall) - Math.abs(a.shortfall); });

      var card2 = el("div", { class: "card" });
      card2.appendChild(el("div", { class: "card-head" }, [
        el("div", {}, [
          el("h2", { text: "Tracker vs statements — predicted vs paid" }),
          el("div", { class: "sub", text: "Cases where the commission actually paid differs from the predicted amount. A negative shortfall means you were underpaid; flagged rows exceed the variance threshold." }),
        ]),
      ]));
      var t2 = el("table", { class: "data" });
      t2.appendChild(el("thead", {}, [el("tr", {}, [
        el("th", { text: "Date" }), el("th", { text: "Client" }), el("th", { text: "Provider" }),
        el("th", { class: "num", text: "Predicted" }), el("th", { class: "num", text: "Paid" }),
        el("th", { class: "num", text: "Shortfall" }), el("th", { class: "num", text: "Variance" }),
        el("th", { text: "Paid via" }),
      ])]));
      var tb2 = el("tbody");
      compare.slice(0, 100).forEach(function (row) {
        var c = row.c;
        var v = variancePct(c);
        var owed = row.shortfall > 0; // predicted exceeds paid → underpaid
        var statusCell = el("td", { text: c.commissionReceived != null ? "Tracker" : "Statement match" });
        if (isVarianceFlagged(c)) statusCell.appendChild(el("span", { class: "badge bad", text: " check", title: "Exceeds the variance threshold" }));
        tb2.appendChild(el("tr", {}, [
          el("td", { text: c.date || "—" }),
          el("td", { text: c.client || "—", title: c.property || "" }),
          el("td", { text: c.provider || "—" }),
          el("td", { class: "num", text: gbp(c.commissionWritten) }),
          el("td", { class: "num", text: gbp(effectiveReceived(c)) }),
          el("td", { class: "num " + (owed ? "neg" : "pos"), text: (owed ? "−" : "+") + gbp(Math.abs(row.shortfall)) }),
          el("td", { class: "num " + (v < 0 ? "neg" : "pos"), text: (v > 0 ? "+" : "") + v.toFixed(0) + "%" }),
          statusCell,
        ]));
      });
      if (!compare.length) tb2.appendChild(el("tr", {}, [el("td", { colspan: "8", class: "empty", text: "Every paid case matches its predicted commission." })]));
      t2.appendChild(tb2);
      card2.appendChild(el("div", { class: "table-scroll" }, [t2]));
      if (compare.length > 100) card2.appendChild(el("p", { class: "table-note", text: "Showing the 100 biggest gaps of " + compare.length + "." }));
      tablesWrap.appendChild(card2);

      // ---- needs review: matched-not-in-tracker + unmatched payments ----
      tablesWrap.appendChild(el("h2", { class: "section-title", text: "Needs review" }));
      tablesWrap.appendChild(el("p", { class: "section-note",
        text: "Matching runs automatically — these are the cases it isn't sure about, so nothing is silently wrong." }));

      // statement payments matched to cases the tracker hasn't recorded yet
      if (matchedOnly.length) {
        var card3 = el("div", { class: "card" });
        card3.appendChild(el("div", { class: "card-head" }, [
          el("div", {}, [
            el("h2", { text: "Paid on statements, not yet recorded in the tracker" }),
            el("div", { class: "sub", text: "Statement payments auto-matched to tracker cases whose Commission Received column is still empty — copy these back into the sheet when confirmed." }),
          ]),
        ]));
        var t3 = el("table", { class: "data" });
        t3.appendChild(el("thead", {}, [el("tr", {}, [
          el("th", { text: "Date" }), el("th", { text: "Client" }), el("th", { text: "Provider" }),
          el("th", { class: "num", text: "Predicted" }), el("th", { class: "num", text: "Paid (statements)" }),
          el("th", { text: "Statement(s)" }),
        ])]));
        var tb3 = el("tbody");
        matchedOnly.slice().sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); })
          .forEach(function (c) {
            tb3.appendChild(el("tr", {}, [
              el("td", { text: c.date || "—" }),
              el("td", { text: c.client || "—", title: c.property || "" }),
              el("td", { text: c.provider || "—" }),
              el("td", { class: "num", text: c.commissionWritten != null ? gbp(c.commissionWritten) : "—" }),
              el("td", { class: "num pos", text: gbp(c._matchedPaid) }),
              el("td", { text: c._matchedItems.map(function (m) { return m.statement; }).join(", ") }),
            ]));
          });
        t3.appendChild(tb3);
        card3.appendChild(el("div", { class: "table-scroll" }, [t3]));
        tablesWrap.appendChild(card3);
      }

      // manual overrides in force for this period
      var manualCases = cases.filter(function (c) { return caseStatus(c) === "manual"; });
      if (manualCases.length) {
        var cardM = el("div", { class: "card" });
        cardM.appendChild(el("div", { class: "card-head" }, [
          el("div", {}, [
            el("h2", { text: "Manually confirmed as paid" }),
            el("div", { class: "sub", text: "Cases you've marked as paid by hand (no statement match, nothing in the tracker's Commission Received column). Undo removes the override; the case returns to the worklist." }),
          ]),
        ]));
        var tM = el("table", { class: "data" });
        tM.appendChild(el("thead", {}, [el("tr", {}, [
          el("th", { text: "Date" }), el("th", { text: "Client" }), el("th", { text: "Provider" }),
          el("th", { class: "num", text: "Predicted" }), el("th", { class: "num", text: "Confirmed amount" }),
          el("th", { text: "Confirmed on" }), el("th", { text: "" }),
        ])]));
        var tbM = el("tbody");
        manualCases.slice().sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); })
          .forEach(function (c) {
            var ov = overrideFor(c);
            var undo = el("button", { class: "chase-btn quiet", text: "Undo" });
            undo.addEventListener("click", function () {
              clearOverride(c);
              renderAllExceptRecon();
              refreshReconTables();
            });
            tbM.appendChild(el("tr", {}, [
              el("td", { text: c.date || "—" }),
              el("td", { text: c.client || "—", title: c.property || "" }),
              el("td", { text: c.provider || "—" }),
              el("td", { class: "num", text: c.commissionWritten != null ? gbp(c.commissionWritten) : "—" }),
              el("td", { class: "num pos", text: gbp(effectiveReceived(c)) }),
              el("td", { text: ov ? ov.confirmedOn : "—" }),
              el("td", {}, [undo]),
            ]));
          });
        tM.appendChild(tbM);
        cardM.appendChild(el("div", { class: "table-scroll" }, [tM]));
        tablesWrap.appendChild(cardM);
      }

      // unmatched statement money (non-trail) for the selected period
      var unmatched = state.unmatchedItems.filter(function (it) {
        return state.year === "all" || (it.statement || "").slice(0, 4) === state.year;
      });
      var card4 = el("div", { class: "card" });
      card4.appendChild(el("div", { class: "card-head" }, [
        el("div", {}, [
          el("h2", { text: "Statement payments with no tracker match" }),
          el("div", { class: "sub", text: "Initial commissions of £40+ on statements that couldn't be matched to a tracker case (trail and renewal drip is excluded). Worth a look — either the tracker is missing a case or the client name differs." }),
        ]),
      ]));
      var t4 = el("table", { class: "data" });
      t4.appendChild(el("thead", {}, [el("tr", {}, [
        el("th", { text: "Statement" }), el("th", { text: "Date" }), el("th", { text: "Provider" }),
        el("th", { text: "Client / reference" }), el("th", { text: "Type" }), el("th", { class: "num", text: "Amount" }),
      ])]));
      var tb4 = el("tbody");
      unmatched.slice(0, 100).forEach(function (it) {
        tb4.appendChild(el("tr", {}, [
          el("td", { text: it.statement }),
          el("td", { text: it.date || "—" }),
          el("td", { text: it.lender || "—" }),
          el("td", { text: it.name || "—" }),
          el("td", { text: it.type || "—" }),
          el("td", { class: "num " + (it.amount < 0 ? "neg" : ""), text: gbp(it.amount) }),
        ]));
      });
      if (!unmatched.length) tb4.appendChild(el("tr", {}, [el("td", { colspan: "6", class: "empty", text: "Everything matched for this period." })]));
      t4.appendChild(tb4);
      card4.appendChild(el("div", { class: "table-scroll" }, [t4]));
      if (unmatched.length > 100) card4.appendChild(el("p", { class: "table-note", text: "Showing the 100 largest of " + unmatched.length + " unmatched items." }));
      tablesWrap.appendChild(card4);
    }

    refreshReconTables();
  }

  // ---------- recurring income view ----------
  // Statement line items by class: M = mortgage, I = insurance (indemnified),
  // NI = non-indemnity, R = recurring trail. This view tracks the drip income
  // (NI + R) as monthly totals; GI-type items are hidden behind a toggle.

  function renderRecurring() {
    var root = document.getElementById("view-recurring");
    root.innerHTML = "";

    var byMonth = {};
    var totals = { NI: 0, R: 0 };
    var itemCount = 0, giHidden = 0;
    filteredStatements().forEach(function (s) {
      var m = monthKey(s.date);
      s.items.forEach(function (item) {
        if (item.class !== "NI" && item.class !== "R") return;
        if (item.type === "GI" && !state.includeGI) { giHidden++; return; }
        byMonth[m] = byMonth[m] || { NI: 0, R: 0 };
        byMonth[m][item.class] += item.amount;
        totals[item.class] += item.amount;
        itemCount++;
      });
    });
    var months = monthRange(Object.keys(byMonth));

    var tiles = el("div", { class: "tile-row" });
    [
      { label: "Recurring (R) income", value: gbp(totals.R, { compact: true }) },
      { label: "Non-indemnity (NI) income", value: gbp(totals.NI, { compact: true }) },
      { label: "Monthly average (NI + R)", value: gbp(months.length ? (totals.NI + totals.R) / months.length : 0, { compact: true }) },
      { label: "Payments", value: String(itemCount) },
    ].forEach(function (tdef) {
      tiles.appendChild(el("div", { class: "tile" }, [
        el("div", { class: "label", text: tdef.label }),
        el("div", { class: "value", text: tdef.value }),
      ]));
    });
    root.appendChild(tiles);

    var giToggle = el("label", { class: "check-label" });
    var giBox = el("input", { type: "checkbox" });
    giBox.checked = state.includeGI;
    giBox.addEventListener("change", function () {
      state.includeGI = giBox.checked;
      renderRecurring();
    });
    giToggle.appendChild(giBox);
    giToggle.appendChild(el("span", {
      text: "Include GI" + (!state.includeGI && giHidden ? " (" + giHidden + " hidden)" : ""),
    }));

    var chartCard = el("div", { class: "card" });
    chartCard.appendChild(el("div", { class: "card-head" }, [
      el("div", {}, [
        el("h2", { text: "Recurring income by month" }),
        el("div", { class: "sub", text: "Monthly totals of NI and R class payments on the consolidation statements." }),
      ]),
      el("div", { class: "spacer" }),
      giToggle,
      legend([
        { name: "Non-indemnity (NI)", cssVar: "--series-1" },
        { name: "Recurring (R)", cssVar: "--series-2" },
      ]),
    ]));
    var chart = el("div");
    chartCard.appendChild(chart);
    root.appendChild(chartCard);
    columnChart(chart, {
      labels: months.map(monthLabel),
      tipTitle: function (i) { return monthLabel(months[i]); },
      series: [
        { name: "Non-indemnity (NI)", cssVar: "--series-1", values: months.map(function (m) { return (byMonth[m] || {}).NI || 0; }) },
        { name: "Recurring (R)", cssVar: "--series-2", values: months.map(function (m) { return (byMonth[m] || {}).R || 0; }) },
      ],
    });

    var tableCard = el("div", { class: "card" });
    tableCard.appendChild(el("div", { class: "card-head" }, [
      el("div", {}, [
        el("h2", { text: "Monthly totals" }),
        el("div", { class: "sub", text: "Newest first. Negative amounts are clawbacks/debits on the statements." }),
      ]),
    ]));
    var table = el("table", { class: "data" });
    table.appendChild(el("thead", {}, [el("tr", {}, [
      el("th", { text: "Month" }),
      el("th", { class: "num", text: "Non-indemnity (NI)" }),
      el("th", { class: "num", text: "Recurring (R)" }),
      el("th", { class: "num", text: "Total" }),
    ])]));
    var tbody = el("tbody");
    months.slice().reverse().forEach(function (m) {
      var row = byMonth[m] || { NI: 0, R: 0 };
      var total = row.NI + row.R;
      tbody.appendChild(el("tr", {}, [
        el("td", { text: monthLabel(m) }),
        el("td", { class: "num " + (row.NI < 0 ? "neg" : ""), text: gbp(row.NI) }),
        el("td", { class: "num " + (row.R < 0 ? "neg" : ""), text: gbp(row.R) }),
        el("td", { class: "num " + (total < 0 ? "neg" : ""), text: gbp(total) }),
      ]));
    });
    if (!months.length) tbody.appendChild(el("tr", {}, [el("td", { colspan: "4", class: "empty", text: "No NI or R payments in this period." })]));
    table.appendChild(tbody);
    tableCard.appendChild(el("div", { class: "table-scroll" }, [table]));
    root.appendChild(tableCard);
  }

  // ---------- statements view ----------

  function renderStatements() {
    var root = document.getElementById("view-statements");
    root.innerHTML = "";
    var stmts = filteredStatements().slice().sort(function (a, b) {
      return b.date.localeCompare(a.date);
    });

    var total = 0, items = 0, negatives = 0;
    stmts.forEach(function (s) {
      total += s.total;
      items += s.items.length;
      s.items.forEach(function (it) { if (it.amount < 0) negatives += it.amount; });
    });

    var tiles = el("div", { class: "tile-row" });
    [
      { label: "Statements", value: String(stmts.length) },
      { label: "Total paid", value: gbp(total, { compact: true }) },
      { label: "Line items", value: String(items) },
      { label: "Clawbacks / debits", value: gbp(negatives, { compact: true }) },
    ].forEach(function (tdef) {
      tiles.appendChild(el("div", { class: "tile" }, [
        el("div", { class: "label", text: tdef.label }),
        el("div", { class: "value", text: tdef.value }),
      ]));
    });
    root.appendChild(tiles);

    var byMonth = {};
    stmts.forEach(function (s) {
      var k = monthKey(s.date);
      byMonth[k] = (byMonth[k] || 0) + s.total;
    });
    var months = monthRange(Object.keys(byMonth));
    var chartCard = el("div", { class: "card" });
    chartCard.appendChild(el("div", { class: "card-head" }, [
      el("div", {}, [
        el("h2", { text: "Statement income by month" }),
        el("div", { class: "sub", text: "Sum of weekly consolidation statement totals per calendar month." }),
      ]),
    ]));
    var chart = el("div");
    chartCard.appendChild(chart);
    root.appendChild(chartCard);
    columnChart(chart, {
      labels: months.map(monthLabel),
      tipTitle: function (i) { return monthLabel(months[i]); },
      series: [
        { name: "Paid", cssVar: "--series-1", values: months.map(function (m) { return byMonth[m] || 0; }) },
      ],
    });

    var listCard = el("div", { class: "card" });
    listCard.appendChild(el("div", { class: "card-head" }, [
      el("div", {}, [
        el("h2", { text: "Weekly statements" }),
        el("div", { class: "sub", text: "Click a statement to see its line items." }),
      ]),
    ]));
    var table = el("table", { class: "data" });
    table.appendChild(el("thead", {}, [el("tr", {}, [
      el("th", { text: "Statement date" }),
      el("th", { text: "File" }),
      el("th", { class: "num", text: "Line items" }),
      el("th", { class: "num", text: "Total" }),
    ])]));
    var tbody = el("tbody");
    stmts.forEach(function (s) {
      var row = el("tr", { class: "rowlink" }, [
        el("td", { text: s.date }),
        el("td", { text: s.file }),
        el("td", { class: "num", text: String(s.items.length) }),
        el("td", { class: "num " + (s.total < 0 ? "neg" : ""), text: gbp(s.total) }),
      ]);
      row.addEventListener("click", function () {
        state.openStatement = state.openStatement === s.file ? null : s.file;
        renderStatements();
      });
      tbody.appendChild(row);
      if (state.openStatement === s.file) {
        var inner = el("table", { class: "data" });
        inner.appendChild(el("thead", {}, [el("tr", {}, [
          el("th", { text: "Date" }),
          el("th", { text: "Provider" }),
          el("th", { text: "Client / reference" }),
          el("th", { text: "Type" }),
          el("th", { class: "num", text: "Amount" }),
        ])]));
        var ib = el("tbody");
        s.items.slice().sort(function (a, b) { return b.amount - a.amount; }).forEach(function (it) {
          ib.appendChild(el("tr", {}, [
            el("td", { text: it.date || "—" }),
            el("td", { text: it.lender || "—" }),
            el("td", { text: ((it.firstName || "") + " " + (it.surname || "")).trim() || it.ref || "—", title: it.ref || "" }),
            el("td", { text: it.type || "—" }),
            el("td", { class: "num " + (it.amount < 0 ? "neg" : ""), text: gbp(it.amount) }),
          ]));
        });
        inner.appendChild(ib);
        tbody.appendChild(el("tr", {}, [
          el("td", { colspan: "4" }, [el("div", { class: "table-scroll" }, [inner])]),
        ]));
      }
    });
    table.appendChild(tbody);
    listCard.appendChild(el("div", { class: "table-scroll" }, [table]));
    root.appendChild(listCard);
  }

  // ---------- shell ----------

  function renderAllExceptRecon() {
    renderOverview();
    renderTracker();
    renderRecurring();
    renderStatements();
  }

  function renderAll() {
    renderOverview();
    renderTracker();
    renderReconciliation();
    renderRecurring();
    renderStatements();
    var meta = document.getElementById("data-meta");
    meta.textContent = "Tracker: " + state.tracker.cases.length + " cases · Statements: " +
      state.statements.statements.length + " · Data as of " +
      (state.tracker.generatedAt || "").slice(0, 10);
  }

  function initShell() {
    document.getElementById("tabs").addEventListener("click", function (ev) {
      var btn = ev.target.closest(".tab");
      if (!btn) return;
      document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
      btn.classList.add("active");
      document.querySelectorAll(".view").forEach(function (v) { v.classList.remove("active"); });
      document.getElementById("view-" + btn.getAttribute("data-view")).classList.add("active");
    });

    var years = {};
    state.tracker.cases.forEach(function (c) { years[c.register] = 1; });
    state.statements.statements.forEach(function (s) { years[s.date.slice(0, 4)] = 1; });
    var yearSel = document.getElementById("year-filter");
    Object.keys(years).sort().reverse().forEach(function (y) {
      yearSel.appendChild(el("option", { value: String(y), text: String(y) }));
    });
    yearSel.addEventListener("change", function () {
      state.year = yearSel.value;
      renderAll();
    });

    var toggle = document.getElementById("theme-toggle");
    toggle.addEventListener("click", function () {
      var rootEl = document.documentElement;
      var dark = rootEl.getAttribute("data-theme") === "dark" ||
        (!rootEl.getAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
      rootEl.setAttribute("data-theme", dark ? "light" : "dark");
      renderAll(); // charts read colors from CSS vars at render time
    });

    var refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", runRefresh);
    var backupBtn = document.getElementById("backup-btn");
    if (backupBtn) backupBtn.addEventListener("click", downloadBackup);
    var reportBtn = document.getElementById("report-btn");
    if (reportBtn) reportBtn.addEventListener("click", openPrintReport);
    var xlsxBtn = document.getElementById("report-xlsx-btn");
    if (xlsxBtn) xlsxBtn.addEventListener("click", downloadXlsxReport);
  }

  // ---------- backup & reports ----------

  function downloadBlob(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // Full backup: both datasets plus everything stored on this device
  // (chases, manual overrides, thresholds) in one dated JSON file.
  function downloadBackup() {
    var payload = {
      exportedAt: new Date().toISOString(),
      app: "Mortgage Oasis dashboard backup",
      tracker: state.tracker,
      statements: state.statements,
      local: { chases: state.chases, overrides: state.overrides, settings: state.recon },
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" }),
      "MortgageOasis-Backup-" + isoToday() + ".json");
  }

  // One set of report rows feeds both the PDF (print) report and the Excel
  // report — so every export shows exactly what the dashboard shows.
  function buildReportData() {
    var cases = filteredCases();
    var stmts = filteredStatements();
    var outstanding = cases.filter(function (c) { return caseStatus(c) === "outstanding"; });
    var overdue = outstanding.filter(isOverdue);
    var written = 0, paid = 0, fees = 0;
    cases.forEach(function (c) {
      written += c.commissionWritten || 0;
      paid += effectiveReceived(c) || 0;
      fees += c.brokerFee || 0;
    });
    var stmtTotal = stmts.reduce(function (a, s) { return a + s.total; }, 0);
    var outstandingSum = outstanding.reduce(function (a, c) { return a + (c.commissionWritten || 0); }, 0);

    var byMonth = {};
    stmts.forEach(function (s) {
      var k = monthKey(s.date);
      byMonth[k] = byMonth[k] || { income: 0, ni: 0, r: 0 };
      byMonth[k].income += s.total;
      s.items.forEach(function (it) {
        if (it.class === "NI") byMonth[k].ni += it.amount;
        if (it.class === "R") byMonth[k].r += it.amount;
      });
    });
    var months = monthRange(Object.keys(byMonth));

    var variance = cases.filter(isVarianceFlagged).map(function (c) {
      return {
        date: c.date, client: c.client, provider: c.provider,
        predicted: c.commissionWritten, paid: effectiveReceived(c),
        shortfall: Math.round(((c.commissionWritten || 0) - (effectiveReceived(c) || 0)) * 100) / 100,
        variancePct: Math.round(variancePct(c)),
        via: c.commissionReceived != null ? "Tracker" : (overrideFor(c) ? "Manual" : "Statement match"),
      };
    }).sort(function (a, b) { return Math.abs(b.shortfall) - Math.abs(a.shortfall); });

    return {
      generatedAt: new Date().toISOString(),
      period: state.year === "all" ? "All years" : state.year,
      thresholds: { overdueDays: state.recon.days, variancePct: state.recon.variancePct },
      summary: [
        ["Commission written (predicted)", written],
        ["Commission paid (tracker + statements + manual)", paid],
        ["Outstanding to chase", outstandingSum],
        ["Overdue (> " + state.recon.days + " days)", overdue.reduce(function (a, c) { return a + (c.commissionWritten || 0); }, 0)],
        ["Statement income", stmtTotal],
        ["Broker fees", fees],
        ["Cases", cases.length],
        ["Outstanding cases", outstanding.length],
        ["Overdue cases", overdue.length],
      ],
      outstanding: outstanding.slice().sort(function (a, b) { return (a.date || "").localeCompare(b.date || ""); })
        .map(function (c) {
          var chase = chaseFor(c);
          return {
            date: c.date, client: c.client, business: c.business || c.segment,
            provider: c.provider, predicted: c.commissionWritten,
            days: ageDays(c.date),
            status: isFollowUpDue(c) ? "Follow up due" : (isOverdue(c) ? "Overdue" : "Awaiting"),
            chasedOn: chase ? chase.chasedOn : null,
            followUpDue: chase ? chase.followUpDue : null,
          };
        }),
      variance: variance,
      monthly: months.map(function (m) {
        var row = byMonth[m] || { income: 0, ni: 0, r: 0 };
        return { month: monthLabel(m), income: Math.round(row.income * 100) / 100,
                 ni: Math.round(row.ni * 100) / 100, r: Math.round(row.r * 100) / 100 };
      }),
    };
  }

  // PDF report: a print-styled window built from the live data plus copies of
  // the dashboard's own charts; the browser's Print → Save as PDF does the rest.
  function openPrintReport() {
    var data = buildReportData();
    var win = window.open("", "_blank");
    if (!win) return;

    function tableHtml(headers, rows, numericFrom) {
      return "<table><thead><tr>" + headers.map(function (h, i) {
        return "<th" + (i >= numericFrom ? ' class="num"' : "") + ">" + esc(h) + "</th>";
      }).join("") + "</tr></thead><tbody>" + rows.map(function (r) {
        return "<tr>" + r.map(function (v, i) {
          return "<td" + (i >= numericFrom ? ' class="num"' : "") + ">" + esc(v == null ? "—" : v) + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody></table>";
    }

    var charts = "";
    ["view-overview"].forEach(function (viewId) {
      var view = document.getElementById(viewId);
      view.querySelectorAll(".card").forEach(function (card) {
        var svg = card.querySelector("svg");
        var title = card.querySelector("h2");
        if (svg && title && /written vs received|Cumulative/.test(title.textContent)) {
          charts += '<div class="chart-block"><h3>' + esc(title.textContent) + "</h3>" +
            '<div class="chart-scroll">' + svg.outerHTML + "</div></div>";
        }
      });
    });

    var html = "<!DOCTYPE html><html><head><meta charset='utf-8'>" +
      "<title>Mortgage Oasis — Commission report</title><style>" +
      "body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0b0b0b;margin:32px;max-width:900px}" +
      "h1{font-size:22px;margin:0}h2{font-size:15px;margin:26px 0 8px;border-bottom:1px solid #c3c2b7;padding-bottom:4px}" +
      "h3{font-size:13px;margin:14px 0 6px}.meta{color:#52514e;font-size:12.5px;margin-top:4px}" +
      "table{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:6px}" +
      "th{font-weight:600;text-align:left;color:#52514e;border-bottom:1px solid #c3c2b7;padding:4px 6px}" +
      "td{padding:3.5px 6px;border-bottom:1px solid #e1e0d9;vertical-align:top}" +
      "th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}" +
      ".chart-block{margin-top:10px}.chart-scroll{overflow:hidden}svg{max-width:100%;height:auto}" +
      ".print-btn{position:fixed;top:14px;right:14px;font:inherit;font-size:13px;padding:8px 16px;" +
      "border:1px solid #2a78d6;color:#2a78d6;background:#fff;border-radius:8px;cursor:pointer}" +
      "@media print{.print-btn{display:none}body{margin:0}h2{page-break-after:avoid}table{page-break-inside:auto}tr{page-break-inside:avoid}}" +
      "</style></head><body>" +
      "<button class='print-btn' onclick='window.print()'>Print / Save as PDF</button>" +
      "<h1>Mortgage Oasis — Commission report</h1>" +
      "<p class='meta'>Period: " + esc(data.period) + " · Generated " + esc(data.generatedAt.slice(0, 10)) +
      " · Overdue after " + data.thresholds.overdueDays + " days · Variance threshold " + data.thresholds.variancePct + "%</p>" +
      "<h2>Summary</h2>" +
      tableHtml(["Measure", "Value"], data.summary.map(function (row) {
        return [row[0], typeof row[1] === "number" && row[0].indexOf("ases") === -1 ? gbp(row[1]) : String(row[1])];
      }), 1) +
      charts +
      "<h2>Outstanding commission (oldest first)</h2>" +
      tableHtml(["Date", "Client", "Business", "Provider", "Predicted", "Days", "Status", "Chased", "Follow-up"],
        data.outstanding.map(function (r) {
          return [r.date, r.client, r.business, r.provider, gbp(r.predicted), r.days, r.status, r.chasedOn, r.followUpDue];
        }), 4) +
      "<h2>Paid vs predicted — variance flags</h2>" +
      tableHtml(["Date", "Client", "Provider", "Predicted", "Paid", "Shortfall", "Variance", "Paid via"],
        data.variance.map(function (r) {
          return [r.date, r.client, r.provider, gbp(r.predicted), gbp(r.paid), gbp(r.shortfall), r.variancePct + "%", r.via];
        }), 3) +
      "<h2>Monthly income</h2>" +
      tableHtml(["Month", "Statement income", "Non-indemnity (NI)", "Recurring (R)"],
        data.monthly.map(function (r) { return [r.month, gbp(r.income), gbp(r.ni), gbp(r.r)]; }), 1) +
      "</body></html>";
    win.document.write(html);
    win.document.close();
  }

  // Excel report: the same rows, formatted server-side by openpyxl.
  function downloadXlsxReport() {
    var status = document.getElementById("refresh-status");
    var data = buildReportData();
    fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "dashboard" },
      body: JSON.stringify(data),
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.blob();
    }).then(function (blob) {
      downloadBlob(blob, "MortgageOasis-Report-" + isoToday() + ".xlsx");
    }).catch(function (err) {
      if (status) {
        status.className = "refresh-status err";
        status.textContent = "Excel report needs the local app (run-dashboard) — use the PDF report instead";
      }
      console.error(err);
    });
  }

  // Ask the local server (Workstream A) to pull the latest Tracker + statements
  // from Google, then reload the data into the dashboard. No client data passes
  // through anything but the local machine and Google.
  function runRefresh() {
    var btn = document.getElementById("refresh-btn");
    var status = document.getElementById("refresh-status");
    if (btn.disabled) return;
    btn.disabled = true;
    status.className = "refresh-status";
    status.textContent = "Refreshing from Google…";
    fetch("/api/refresh", { method: "POST", headers: { "X-Requested-With": "dashboard" } })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok || !res.body.ok) throw new Error((res.body && res.body.error) || "Refresh failed");
        return loadData().then(function () {
          renderAll();
          status.className = "refresh-status ok";
          status.textContent = "Updated " + (res.body.summary || "");
        });
      })
      .catch(function (err) {
        status.className = "refresh-status err";
        status.textContent = String(err.message || err);
        // A plain static server (no /api/refresh) can't refresh — say so plainly.
        if (/Unexpected token|JSON|501|405|404/.test(String(err))) {
          status.textContent = "Refresh needs the local app (run-dashboard) — see README";
        }
      })
      .then(function () { btn.disabled = false; });
  }

  function loadData() {
    return Promise.all([
      fetch("../data/tracker.json", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch("../data/statements.json", { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
    ]).then(function (payloads) {
      state.tracker = payloads[0];
      state.statements = payloads[1];
      buildMatches();
    });
  }

  loadData().then(function () {
    initShell();
    renderAll();
  }).catch(function (err) {
    console.error(err);
    document.getElementById("load-error").hidden = false;
  });
})();
