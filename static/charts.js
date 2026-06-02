/* charts.js — tiny dependency-free SVG chart kit (donut, bars, vbars, line, timeline).
   Each function clears `el` and renders. Tooltips use native <title>. */
(function (global) {
  const NS = "http://www.w3.org/2000/svg";
  const PALETTE = ["#3da9fc", "#22d3a6", "#fbbf24", "#f87171", "#a78bfa",
    "#f472b6", "#34d399", "#60a5fa", "#fb923c", "#2dd4bf", "#c084fc", "#94a3b8"];

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
        fill: PALETTE[i % PALETTE.length], stroke: "#16202e", "stroke-width": 1
      });
      tip(p, `${d.label}: ${d.value} (${Math.round(frac * 100)}%)`);
      if (opts.onClick) { p.style.cursor = "pointer"; p.addEventListener("click", () => opts.onClick(d)); }
      s.appendChild(p); ang = a2;
    });
    const c1 = el("text", { x: cx, y: cy - 2, "text-anchor": "middle", "font-size": 22, fill: "#e8eef6", "font-weight": 700 });
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
      s.appendChild(el("line", { x1: padL, y1: y, x2: w - padR, y2: y, stroke: "#243245", "stroke-width": 1 }));
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

  global.Charts = { donut, hbars, vbars, line, PALETTE, gbp };
})(window);
