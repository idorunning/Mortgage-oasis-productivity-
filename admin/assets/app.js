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
  };

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
    var dp = abs >= 1000 ? 0 : (opts.dp != null ? opts.dp : 2);
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
    if (c.commissionWritten != null) return "outstanding";
    return "none";
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

  function tipRows(title, rows) {
    return '<div class="tip-title">' + title + "</div>" + rows.map(function (r) {
      return '<div class="tip-row"><span class="swatch" style="width:8px;height:8px;border-radius:2px;background:' +
        r.color + '"></span>' + r.name + "<b>" + r.value + "</b></div>";
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

    var maxVal = 0;
    cfg.series.forEach(function (s) {
      s.values.forEach(function (v) { if (v != null && v > maxVal) maxVal = v; });
    });
    var yMax = niceCeil(maxVal || 1);

    var svg = svgEl("svg", { viewBox: "0 0 " + width + " " + height, width: width, height: height, role: "img" });
    wrap.appendChild(svg);

    // gridlines + ticks (4 divisions)
    for (var t = 0; t <= 4; t++) {
      var yv = yMax * t / 4;
      var y = pad.top + plotH - (plotH * t / 4);
      svg.appendChild(svgEl("line", {
        x1: pad.left, x2: pad.left + plotW, y1: y, y2: y,
        stroke: t === 0 ? css("--baseline") : css("--grid"), "stroke-width": 1,
      }));
      var tick = svgEl("text", {
        x: pad.left - 8, y: y + 4, "text-anchor": "end",
        fill: css("--muted"), "font-size": 11,
      });
      tick.textContent = yv >= 1000 ? (yv / 1000) + "K" : String(Math.round(yv));
      svg.appendChild(tick);
    }

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
        if (v == null || v <= 0) return;
        var h = Math.max(2, plotH * v / yMax);
        var x = startX + si * (barW + 2);
        var y0 = pad.top + plotH - h;
        var r = Math.min(4, h / 2);
        var path = "M" + x + "," + (pad.top + plotH) +
          " L" + x + "," + (y0 + r) +
          " Q" + x + "," + y0 + " " + (x + r) + "," + y0 +
          " L" + (x + barW - r) + "," + y0 +
          " Q" + (x + barW) + "," + y0 + " " + (x + barW) + "," + (y0 + r) +
          " L" + (x + barW) + "," + (pad.top + plotH) + " Z";
        var bar = svgEl("path", { d: path, fill: css(s.cssVar) });
        svg.appendChild(bar);
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
        { name: "Paid", cssVar: "--series-1", values: sMonths.map(function (m) { return Math.max(0, byStmtMonth[m] || 0); }) },
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
     ["outstanding", "Awaiting commission"], ["none", "No commission recorded"]].forEach(function (p) {
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
        : status === "outstanding"
          ? el("span", { class: "badge wait", text: "Awaiting" })
          : el("span", { text: "—" });
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
        el("td", {}, [badge]),
      ]));
    });
    table.appendChild(tbody);
    card.appendChild(el("div", { class: "table-scroll" }, [table]));
    card.appendChild(el("p", { class: "table-note", text: "Hover a client for the property address. Data comes straight from the Tracker sheet's Business Register tabs." }));
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
        { name: "Paid", cssVar: "--series-1", values: months.map(function (m) { return Math.max(0, byMonth[m] || 0); }) },
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

  function renderAll() {
    renderOverview();
    renderTracker();
    renderStatements();
    var meta = document.getElementById("data-meta");
    meta.textContent = "Tracker: " + state.tracker.cases.length + " cases · Statements: " +
      state.statements.statements.length + " · Data extracted " +
      (state.tracker.generatedAt || "").slice(0, 10) +
      " — refresh via scripts/ (see README)";
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
  }

  Promise.all([
    fetch("../data/tracker.json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
    fetch("../data/statements.json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
  ]).then(function (payloads) {
    state.tracker = payloads[0];
    state.statements = payloads[1];
    initShell();
    renderAll();
  }).catch(function (err) {
    console.error(err);
    document.getElementById("load-error").hidden = false;
  });
})();
