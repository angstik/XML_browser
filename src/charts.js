// Graphes par jour : deux graphes à barres groupées (dispense, refund), une mesure par graphe.
// Deux mesures d'échelles différentes = deux graphes, jamais un double axe.
// Exposé en global : window.DayCharts.render(root, { days, charts, series, fmtDate })
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // Échelle « ronde » : au plus 5 graduations, pas de 1 / 2 / 5 (ou 2,5 pour les montants).
  function niceScale(max, integer) {
    if (!(max > 0)) return { max: integer ? 1 : 1, step: 1 };
    const rough = max / 4;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const f = rough / pow;
    let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 && !integer ? 2.5 : f <= 5 ? 5 : 10) * pow;
    if (integer && step < 1) step = 1;
    return { max: Math.ceil(max / step - 1e-9) * step, step };
  }

  // Colonne à sommet arrondi (4 px), base carrée sur la ligne de base.
  function column(x, y, w, y0, cls) {
    const h = y0 - y;
    const r = Math.max(0, Math.min(4, w / 2, h));
    const d = "M" + x + "," + y0 + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y
      + "H" + (x + w - r) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + "V" + y0 + "Z";
    return svg("path", { d, class: cls });
  }

  const M = { left: 60, right: 16, top: 20, bottom: 28, plot: 150 };

  function drawChart(host, days, chart, series, width, hover, fmtDate) {
    const n = days.length;
    const slot = Math.min(140, Math.max(26, (width - M.left - M.right) / Math.max(1, n)));
    const w = Math.max(width, M.left + n * slot + M.right);
    const h = M.top + M.plot + M.bottom;
    const y0 = M.top + M.plot;
    const root = svg("svg", { width: w, height: h, viewBox: "0 0 " + w + " " + h, role: "img", "aria-label": chart.title });

    let max = 0;
    for (const d of days) for (const s of series) max = Math.max(max, d[chart.keys[s.id]]);
    const scale = niceScale(max, chart.integer);
    const y = (v) => y0 - (v / scale.max) * M.plot;

    // Grille et graduations : traits fins et pleins, en retrait.
    for (let v = 0; v <= scale.max + 1e-9; v += scale.step) {
      const yy = Math.round(y(v)) + 0.5;
      root.appendChild(svg("line", { x1: M.left, x2: w - M.right, y1: yy, y2: yy, class: v === 0 ? "viz-axis" : "viz-grid" }));
      root.appendChild(svg("text", { x: M.left - 8, y: yy + 4, class: "viz-tick", "text-anchor": "end" }, chart.fmtTick(v)));
    }

    const pad = Math.max(8, slot * 0.28);
    const bw = Math.max(4, Math.min(24, Math.floor((slot - 2 - pad) / 2)));
    const group = bw * 2 + 2;                     // 2 px de vide entre les deux colonnes
    const every = Math.max(1, Math.ceil(48 / slot));
    const bars = [], bands = [];

    days.forEach((d, i) => {
      const sx = M.left + i * slot;
      const band = svg("rect", { x: sx, y: M.top - 6, width: slot, height: M.plot + 6, class: "viz-band" });
      root.appendChild(band);
      bands.push(band);
      series.forEach((s, k) => {
        const v = d[chart.keys[s.id]];
        if (!(v > 0)) return;
        const bx = sx + (slot - group) / 2 + k * (bw + 2);
        const by = Math.min(y(v), y0 - 1);        // une valeur non nulle reste visible
        root.appendChild(column(bx, by, bw, y0, "viz-bar " + s.cls));
        bars.push({ i, k, x: bx, y: by, w: bw, v });
      });
      if (i % every === 0) {
        root.appendChild(svg("text", { x: sx + slot / 2, y: y0 + 17, class: "viz-tick", "text-anchor": "middle" }, fmtDate(d.date, true)));
      }
    });

    // Étiquettes directes : seulement le maximum de chaque série, et seulement si rien ne les gêne.
    const placed = [];
    series.forEach((s, k) => {
      let best = null;
      for (const b of bars) if (b.k === k && (!best || b.v > best.v)) best = b;
      if (!best || n < 2) return;
      const text = chart.fmtValue(best.v);
      const tw = text.length * 6.4 + 4;
      const box = { x1: best.x + best.w / 2 - tw / 2, x2: best.x + best.w / 2 + tw / 2, y1: best.y - 18, y2: best.y - 3 };
      if (box.x1 < M.left || box.x2 > w - 2 || box.y1 < 2) return;
      const hitBar = bars.some((b) => b !== best && b.x < box.x2 && b.x + b.w > box.x1 && b.y < box.y2);
      const hitLabel = placed.some((p) => p.x1 < box.x2 && p.x2 > box.x1 && p.y1 < box.y2 && p.y2 > box.y1);
      if (hitBar || hitLabel) return;
      placed.push(box);
      root.appendChild(svg("text", { x: best.x + best.w / 2, y: best.y - 6, class: "viz-label", "text-anchor": "middle" }, text));
    });

    // Zones de survol : toute la colonne du jour, bien plus large que les barres.
    days.forEach((d, i) => {
      const hit = svg("rect", { x: M.left + i * slot, y: 0, width: slot, height: h, class: "viz-hit" });
      hit.addEventListener("pointerenter", (e) => hover(i, e));
      hit.addEventListener("pointermove", (e) => hover(i, e));
      hit.addEventListener("pointerleave", () => hover(-1));
      root.appendChild(hit);
    });

    const fig = el("div", "viz-chart");
    fig.appendChild(el("h3", "viz-title", chart.title));
    const scroller = el("div", "viz-scroll");
    scroller.appendChild(root);
    fig.appendChild(scroller);
    host.appendChild(fig);
    return bands;
  }

  function render(root, cfg) {
    const { days, charts, series, fmtDate } = cfg;
    root.textContent = "";
    if (root._vizObserver) { root._vizObserver.disconnect(); root._vizObserver = null; }

    // Légende : toujours présente dès qu'il y a deux séries. Le texte reste en encre, la pastille porte la couleur.
    const head = el("div", "viz-head");
    const legend = el("div", "viz-legend");
    for (const s of series) {
      const item = el("span", "viz-key");
      item.appendChild(el("i", s.cls));
      item.appendChild(document.createTextNode(s.label));
      legend.appendChild(item);
    }
    head.appendChild(legend);
    const toggle = el("button", null, "Afficher le tableau des jours");
    toggle.type = "button";
    head.appendChild(toggle);
    root.appendChild(head);

    if (!days.length) {
      root.appendChild(el("p", "viz-empty", "Aucun jour à afficher."));
      toggle.hidden = true;
      return;
    }

    const plots = el("div", "viz-plots");
    const tip = el("div", "viz-tip");
    tip.hidden = true;
    root.appendChild(plots);
    root.appendChild(tip);

    // Une seule infobulle pour les deux graphes : les quatre valeurs du jour survolé.
    let allBands = [];
    function hover(i, e) {
      allBands.forEach((bands) => bands.forEach((b, k) => b.classList.toggle("on", k === i)));
      if (i < 0) { tip.hidden = true; return; }
      const d = days[i];
      tip.textContent = "";
      tip.appendChild(el("div", "viz-tip-date", fmtDate(d.date, false)));
      const grid = el("div", "viz-tip-grid");
      grid.appendChild(el("span"));
      for (const c of charts) grid.appendChild(el("span", "viz-tip-col", c.short));
      for (const s of series) {
        const name = el("span", "viz-tip-name");
        name.appendChild(el("i", s.cls));
        name.appendChild(document.createTextNode(s.label));
        grid.appendChild(name);
        for (const c of charts) grid.appendChild(el("b", null, c.fmtValue(d[c.keys[s.id]])));
      }
      tip.appendChild(grid);
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
      if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 14;
      tip.style.left = Math.max(8, x) + "px";
      tip.style.top = Math.max(8, y) + "px";
    }

    let lastWidth = -1;
    function draw() {
      const width = Math.floor(plots.clientWidth);
      if (!width || width === lastWidth) return;
      lastWidth = width;
      plots.textContent = "";
      allBands = charts.map((c) => drawChart(plots, days, c, series, width, hover, fmtDate));
    }
    draw();
    if (window.ResizeObserver) {
      root._vizObserver = new ResizeObserver(draw);
      root._vizObserver.observe(plots);
    }

    // Vue tableau : toutes les valeurs des graphes, lisibles sans survol.
    const tableWrap = el("div", "viz-table");
    tableWrap.hidden = true;
    const table = el("table");
    const thead = el("thead"), trh = el("tr");
    trh.appendChild(el("th", null, "Jour"));
    for (const s of series) for (const c of charts) trh.appendChild(el("th", null, s.label + " : " + c.short.charAt(0).toLowerCase() + c.short.slice(1)));
    thead.appendChild(trh); table.appendChild(thead);
    const tbody = el("tbody");
    const sum = {};
    for (const d of days) {
      const tr = el("tr");
      tr.appendChild(el("td", null, fmtDate(d.date, false)));
      for (const s of series) for (const c of charts) {
        const key = c.keys[s.id];
        sum[key] = (sum[key] || 0) + d[key];
        tr.appendChild(el("td", null, c.fmtValue(d[key])));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    const tfoot = el("tfoot"), trf = el("tr");
    trf.appendChild(el("td", null, "Total"));
    for (const s of series) for (const c of charts) trf.appendChild(el("td", null, c.fmtValue(sum[c.keys[s.id]] || 0)));
    tfoot.appendChild(trf); table.appendChild(tfoot);
    tableWrap.appendChild(table);
    root.appendChild(tableWrap);

    // Le choix graphes / tableau est conservé quand on change de client.
    function show(table) {
      root.dataset.view = table ? "table" : "plots";
      tableWrap.hidden = !table;
      plots.hidden = table;
      toggle.textContent = table ? "Afficher les graphes" : "Afficher le tableau des jours";
      if (!table) { lastWidth = -1; draw(); }
    }
    toggle.addEventListener("click", () => show(tableWrap.hidden));
    if (root.dataset.view === "table") show(true);
  }

  window.DayCharts = { render };
})();
