/* charts.js — tiny dependency-free SVG chart kit (donut, bars, vbars, line, timeline).
   Each function clears `el` and renders. Tooltips use native <title>. */
(function (global) {
  const NS = "http://www.w3.org/2000/svg";
  const PALETTE = ["#B79AD8", "#E79BC9", "#9DB8E6", "#8FCBB4", "#E6C173",
    "#EE9A8C", "#CDBCEC", "#D98FBE", "#A8C8E6", "#9C7FC9", "#F2B8C8", "#A9B0B8"];
  const GRID = "#ECE3F1", AXIS = "#897C94", LABEL = "#3A2B47", STROKE = "#FFFFFF";

  const el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in (a || {})) e.setAttribute(k, a[k]); return e; };
  const txt = (s) => document.createTextNode(s == null ? "" : String(s));
  const gbp = (v) => "£" + Math.round(v).toLocaleString("en-GB");
  const clear = (c) => { c.innerHTML = ""; };

  function svg(c, w, h) {
    clear(c);
    const s = el("svg", { viewBox: `0 0 ${w} ${h}`, class: "chart", width: "100%" });
    c.appendChild(s); return s;
  }
  function tip(parent, s) { const t = el("title"); t.appendChild(txt(s)); parent.appendChild(t); }

  function legend(container, items) {
    const l = document.createElement("div"); l.className = "legend";
    items.forEach((it, i) => {
      const span = document.createElement("span");
      span.innerHTML = `<i style="background:${it.color || PALETTE[i % PALETTE.length]}"></i>${it.label}`;
      l.appendChild(span);
    });
    container.appendChild(l);
  }

  // ---- donut ----
  function donut(c, data, opts = {}) {
    const total = data.reduce((a, d) => a + d.value, 0) || 1;
    const s = svg(c, 320, 200); const cx = 100, cy = 100, r = 80, ir = 48;
    let ang = -Math.PI / 2;
    data.forEach((d, i) => {
      const frac = d.value / total, a2 = ang + frac * 2 * Math.PI;
      const big = frac > 0.5 ? 1 : 0;
      const p = el("path", {
        d: `M${cx + r * Math.cos(ang)},${cy + r * Math.sin(ang)} A${r},${r} 0 ${big} 1 ${cx + r * Math.cos(a2)},${cy + r * Math.sin(a2)} L${cx + ir * Math.cos(a2)},${cy + ir * Math.sin(a2)} A${ir},${ir} 0 ${big} 0 ${cx + ir * Math.cos(ang)},${cy + ir * Math.sin(ang)} Z`,
        fill: PALETTE[i % PALETTE.length], stroke: "#FFFFFF", "stroke-width": 1
      });
      tip(p, `${d.label}: ${d.value} (${Math.round(frac * 100)}%)`);
      if (opts.onClick) { p.style.cursor = "pointer"; p.addEventListener("click", () => opts.onClick(d)); }
      s.appendChild(p); ang = a2;
    });
    const c1 = el("text", { x: cx, y: cy - 2, "text-anchor": "middle", "font-size": 22, fill: "#3A2B47", "font-weight": 700 });
    c1.appendChild(txt(total)); s.appendChild(c1);
    const c2 = el("text", { x: cx, y: cy + 16, "text-anchor": "middle" }); c2.appendChild(txt(opts.centerLabel || "total")); s.appendChild(c2);
    legend(c, data.map((d, i) => ({ label: `${d.label} (${d.value})`, color: PALETTE[i % PALETTE.length] })));
  }

  // ---- horizontal bars ----
  function hbars(c, data, opts = {}) {
    if (!data.length) { c.innerHTML = '<div class="muted">No data</div>'; return; }
    const max = Math.max(...data.map(d => d.value)) || 1;
    const rowH = 26, w = 360, padL = 130, h = data.length * rowH + 10;
    const s = svg(c, w, h);
    data.forEach((d, i) => {
      const y = i * rowH + 6, bw = (w - padL - 50) * d.value / max;
      const lab = el("text", { x: padL - 8, y: y + 12, "text-anchor": "end" }); lab.appendChild(txt(d.label)); s.appendChild(lab);
      const bar = el("rect", { x: padL, y, width: Math.max(bw, 1), height: 14, rx: 4, fill: opts.color || PALETTE[i % PALETTE.length] });
      tip(bar, `${d.label}: ${opts.money ? gbp(d.value) : d.value}`);
      if (opts.onClick) { bar.style.cursor = "pointer"; bar.addEventListener("click", () => opts.onClick(d)); }
      s.appendChild(bar);
      const v = el("text", { x: padL + bw + 6, y: y + 12 }); v.appendChild(txt(opts.money ? gbp(d.value) : d.value)); s.appendChild(v);
    });
  }

  // ---- vertical bars / timeline ----
  function vbars(c, data, opts = {}) {
    if (!data.length) { c.innerHTML = '<div class="muted">No data</div>'; return; }
    const max = Math.max(...data.map(d => d.value)) || 1;
    const w = 640, h = 220, padB = 40, padT = 12, padL = 10;
    const bw = (w - padL * 2) / data.length;
    const s = svg(c, w, h);
    data.forEach((d, i) => {
      const bh = (h - padB - padT) * d.value / max;
      const x = padL + i * bw, y = h - padB - bh;
      const r = el("rect", { x: x + 3, y, width: Math.max(bw - 6, 1), height: Math.max(bh, 1), rx: 4, fill: d.color || opts.color || PALETTE[0] });
      tip(r, `${d.label}: ${opts.money ? gbp(d.value) : d.value}` + (d.note ? ` (${d.note})` : ""));
      if (opts.onClick) { r.style.cursor = "pointer"; r.addEventListener("click", () => opts.onClick(d)); }
      s.appendChild(r);
      if (d.value) { const v = el("text", { x: x + bw / 2, y: y - 4, "text-anchor": "middle", "font-size": 10 }); v.appendChild(txt(opts.money ? gbp(d.value) : d.value)); s.appendChild(v); }
      if (i % (opts.labelEvery || 1) === 0) {
        const lab = el("text", { x: x + bw / 2, y: h - padB + 14, "text-anchor": "middle", "font-size": 10, transform: opts.rotate ? `rotate(40 ${x + bw / 2} ${h - padB + 14})` : "" });
        lab.appendChild(txt(d.label)); s.appendChild(lab);
      }
    });
  }

  // ---- multi-series line ----
  function line(c, series, opts = {}) {
    const labels = opts.labels || [];
    const allY = series.flatMap(s => s.points);
    const max = Math.max(1, ...allY), w = 640, h = 230, padB = 40, padT = 12, padL = 46, padR = 12;
    const n = labels.length || (series[0] ? series[0].points.length : 0);
    const X = i => padL + (w - padL - padR) * (n <= 1 ? 0.5 : i / (n - 1));
    const Y = v => h - padB - (h - padB - padT) * v / max;
    const s = svg(c, w, h);
    [0, .25, .5, .75, 1].forEach(f => {
      const y = Y(max * f);
      s.appendChild(el("line", { x1: padL, y1: y, x2: w - padR, y2: y, stroke: "#ECE3F1", "stroke-width": 1 }));
      const t = el("text", { x: padL - 6, y: y + 3, "text-anchor": "end" }); t.appendChild(txt(opts.money ? gbp(max * f) : Math.round(max * f))); s.appendChild(t);
    });
    series.forEach((ser, si) => {
      const col = ser.color || PALETTE[si % PALETTE.length];
      const d = ser.points.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
      s.appendChild(el("path", { d, fill: "none", stroke: col, "stroke-width": 2.5, "stroke-linejoin": "round" }));
      ser.points.forEach((v, i) => { const dot = el("circle", { cx: X(i), cy: Y(v), r: 2.6, fill: col }); tip(dot, `${labels[i] || i}: ${opts.money ? gbp(v) : v}`); s.appendChild(dot); });
    });
    labels.forEach((lb, i) => {
      if (i % (opts.labelEvery || Math.ceil(n / 12)) !== 0) return;
      const t = el("text", { x: X(i), y: h - padB + 14, "text-anchor": "middle", "font-size": 10, transform: `rotate(40 ${X(i)} ${h - padB + 14})` });
      t.appendChild(txt(lb)); s.appendChild(t);
    });
    legend(c, series.map((ser, i) => ({ label: ser.name, color: ser.color || PALETTE[i % PALETTE.length] })));
  }

  // ---- radar (compare entities across normalised axes) ----
  function radar(c, axes, series, opts = {}) {
    const w = 360, h = 320, cx = w / 2, cy = 150, R = 110, n = axes.length;
    const s = svg(c, w, h);
    const ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;
    const pt = (i, r) => [cx + R * r * Math.cos(ang(i)), cy + R * r * Math.sin(ang(i))];
    [0.25, 0.5, 0.75, 1].forEach(g => {
      const d = axes.map((_, i) => { const [x, y] = pt(i, g); return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ") + "Z";
      s.appendChild(el("path", { d, fill: "none", stroke: "#ECE3F1", "stroke-width": 1 }));
    });
    axes.forEach((ax, i) => {
      const [x, y] = pt(i, 1);
      s.appendChild(el("line", { x1: cx, y1: cy, x2: x, y2: y, stroke: "#ECE3F1" }));
      const [lx, ly] = pt(i, 1.16);
      const t = el("text", { x: lx, y: ly + 3, "text-anchor": Math.abs(lx - cx) < 6 ? "middle" : (lx > cx ? "start" : "end"), "font-size": 10 });
      t.appendChild(txt(ax)); s.appendChild(t);
    });
    series.forEach((ser, si) => {
      const col = ser.color || PALETTE[si % PALETTE.length];
      const d = ser.values.map((v, i) => { const [x, y] = pt(i, Math.max(0, Math.min(1, v))); return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ") + "Z";
      const p = el("path", { d, fill: col, "fill-opacity": 0.14, stroke: col, "stroke-width": 2 });
      tip(p, ser.name); s.appendChild(p);
      ser.values.forEach((v, i) => { const [x, y] = pt(i, Math.max(0, Math.min(1, v))); s.appendChild(el("circle", { cx: x, cy: y, r: 2.4, fill: col })); });
    });
    legend(c, series.map((ser, i) => ({ label: ser.name, color: ser.color || PALETTE[i % PALETTE.length] })));
  }

  // ---- scatter / quadrant (volume vs quality, bubble = £) ----
  function scatter(c, points, opts = {}) {
    if (!points.length) { c.innerHTML = '<div class="muted">No data</div>'; return; }
    const w = 560, h = 320, padL = 52, padB = 42, padT = 14, padR = 14;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const xmax = Math.max(1, ...xs), ymax = Math.max(1, ...ys);
    const sizeMax = Math.max(1, ...points.map(p => p.size || 0));
    const X = v => padL + (w - padL - padR) * v / xmax;
    const Y = v => h - padB - (h - padB - padT) * v / ymax;
    const s = svg(c, w, h);
    if (opts.xMid != null) s.appendChild(el("line", { x1: X(opts.xMid), y1: padT, x2: X(opts.xMid), y2: h - padB, stroke: "#ECE3F1", "stroke-dasharray": "4 4" }));
    if (opts.yMid != null) s.appendChild(el("line", { x1: padL, y1: Y(opts.yMid), x2: w - padR, y2: Y(opts.yMid), stroke: "#ECE3F1", "stroke-dasharray": "4 4" }));
    s.appendChild(el("line", { x1: padL, y1: h - padB, x2: w - padR, y2: h - padB, stroke: "#ECE3F1" }));
    s.appendChild(el("line", { x1: padL, y1: padT, x2: padL, y2: h - padB, stroke: "#ECE3F1" }));
    const xl = el("text", { x: (w + padL) / 2, y: h - 6, "text-anchor": "middle" }); xl.appendChild(txt(opts.xlabel || "")); s.appendChild(xl);
    const yl = el("text", { x: 12, y: (h - padB + padT) / 2, "text-anchor": "middle", transform: `rotate(-90 12 ${(h - padB + padT) / 2})` }); yl.appendChild(txt(opts.ylabel || "")); s.appendChild(yl);
    points.forEach((p, i) => {
      const r = 5 + 16 * Math.sqrt((p.size || 0) / sizeMax);
      const col = p.color || PALETTE[i % PALETTE.length];
      const cir = el("circle", { cx: X(p.x), cy: Y(p.y), r, fill: col, "fill-opacity": 0.55, stroke: col, "stroke-width": 1.5 });
      tip(cir, `${p.label}: ${opts.xlabel} ${p.x}, ${opts.ylabel} ${p.y}`);
      if (opts.onClick) { cir.style.cursor = "pointer"; cir.addEventListener("click", () => opts.onClick(p)); }
      s.appendChild(cir);
      const t = el("text", { x: X(p.x), y: Y(p.y) - r - 3, "text-anchor": "middle", "font-size": 10, fill: "#3A2B47" }); t.appendChild(txt(p.label)); s.appendChild(t);
    });
  }

  // ---- inline sparkline (returns an <svg> for table cells) ----
  function sparkline(values, opts = {}) {
    const w = opts.w || 90, h = opts.h || 24, max = Math.max(1, ...values), n = values.length;
    const s = el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, style: "vertical-align:middle" });
    if (n > 1) {
      const X = i => 2 + (w - 4) * i / (n - 1), Y = v => h - 2 - (h - 4) * v / max;
      s.appendChild(el("path", { d: values.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" "), fill: "none", stroke: opts.color || "#B79AD8", "stroke-width": 1.6 }));
      const lx = X(n - 1), ly = Y(values[n - 1]);
      s.appendChild(el("circle", { cx: lx, cy: ly, r: 2, fill: opts.color || "#B79AD8" }));
    }
    return s;
  }

  // ---- horizontal stacked bars (case mix per row) ----
  function hstack(c, rows, keys, opts = {}) {
    if (!rows.length) { c.innerHTML = '<div class="muted">No data</div>'; return; }
    const max = Math.max(1, ...rows.map(r => keys.reduce((a, k) => a + (r[k.key] || 0), 0)));
    const rowH = 26, w = 420, padL = 110, h = rows.length * rowH + 10;
    const s = svg(c, w, h);
    rows.forEach((r, i) => {
      const y = i * rowH + 6; let x = padL;
      const lab = el("text", { x: padL - 8, y: y + 12, "text-anchor": "end" }); lab.appendChild(txt(r.label)); s.appendChild(lab);
      keys.forEach((k, ki) => {
        const bw = (w - padL - 12) * (r[k.key] || 0) / max;
        if (bw <= 0) return;
        const rect = el("rect", { x, y, width: bw, height: 14, fill: k.color || PALETTE[ki % PALETTE.length] });
        tip(rect, `${r.label} — ${k.label}: ${r[k.key]}`); s.appendChild(rect); x += bw;
      });
    });
    legend(c, keys.map(k => ({ label: k.label, color: k.color })));
  }

  global.Charts = { donut, hbars, vbars, line, radar, scatter, sparkline, hstack, PALETTE, gbp };
})(window);
