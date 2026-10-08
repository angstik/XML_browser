// Graphes par jour : deux graphes à barres groupées (dispense, refund), une mesure par graphe.
// Deux mesures d'échelles différentes = deux graphes, jamais un double axe.
// Exposé en global : window.DayCharts.render(root, { days, charts, series, fmtDate, title, fileName })
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
    if (!(max > 0)) return { max: 1, step: 1 };
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

  // ---- Axe du temps -------------------------------------------------------
  const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
  const DAY = 86400000;
  const MAX_FILL = 1100;                       // au-delà (environ 3 ans), on ne comble plus les jours vides
  const monthFmt = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" });
  const toUtc = (iso) => { const m = ISO.exec(iso); return Date.UTC(+m[1], +m[2] - 1, +m[3]); };
  const toIso = (t) => new Date(t).toISOString().slice(0, 10);

  // Axe continu : chaque jour du calendrier entre le premier et le dernier a sa place,
  // même sans donnée. Les entrées sans date valide sont placées à la fin.
  function timeline(days) {
    const dated = days.filter((d) => ISO.test(d.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
    const other = days.filter((d) => !ISO.test(d.date));
    if (dated.length < 2) return dated.concat(other);
    const first = toUtc(dated[0].date), last = toUtc(dated[dated.length - 1].date);
    if ((last - first) / DAY > MAX_FILL) return dated.concat(other);
    const byDate = new Map(dated.map((d) => [d.date, d]));
    const out = [];
    for (let t = first; t <= last; t += DAY) {
      const iso = toIso(t);
      out.push(byDate.get(iso) || { date: iso, empty: true });
    }
    return out.concat(other);
  }

  // Début de mois : le 1er, ou à défaut le premier jour affiché d'un nouveau mois.
  function monthStart(slots, i) {
    const d = slots[i].date;
    if (!ISO.test(d)) return null;
    const prev = i > 0 ? slots[i - 1].date : null;
    const starts = d.slice(8) === "01" || (prev !== null && ISO.test(prev) && prev.slice(0, 7) !== d.slice(0, 7));
    return starts ? monthFmt.format(new Date(toUtc(d.slice(0, 8) + "01"))) : null;
  }

  const M = { left: 60, right: 16, top: 34, bottom: 28, plot: 150 };

  // Un graphe = un axe vertical fixe + une zone de tracé qui défile horizontalement.
  function drawChart(host, slots, chart, series, width, hover, fmtDate) {
    const n = slots.length;
    const avail = Math.max(120, width - M.left);
    const slot = Math.max(26, (avail - M.right) / Math.max(1, n));      // toute la largeur disponible
    const w = Math.max(avail, n * slot + M.right);
    const h = M.top + M.plot + M.bottom;
    const y0 = M.top + M.plot;

    let max = 0;
    for (const d of slots) for (const s of series) max = Math.max(max, d[chart.keys[s.id]] || 0);
    const scale = niceScale(max, chart.integer);
    const y = (v) => y0 - (v / scale.max) * M.plot;

    const axis = svg("svg", { width: M.left, height: h, viewBox: "0 0 " + M.left + " " + h, "aria-hidden": "true" });
    const plot = svg("svg", { width: w, height: h, viewBox: "0 0 " + w + " " + h, role: "img", "aria-label": chart.title });

    // Grille et graduations : traits fins et pleins, en retrait.
    for (let v = 0; v <= scale.max + 1e-9; v += scale.step) {
      const yy = Math.round(y(v)) + 0.5;
      plot.appendChild(svg("line", { x1: 0, x2: w - M.right, y1: yy, y2: yy, class: v === 0 ? "viz-axis" : "viz-grid" }));
      axis.appendChild(svg("text", { x: M.left - 8, y: yy + 4, class: "viz-tick", "text-anchor": "end" }, chart.fmtTick(v)));
    }

    const pad = Math.max(8, slot * 0.28);
    const bw = Math.max(4, Math.min(24, Math.floor((slot - 2 - pad) / 2)));
    const group = bw * 2 + 2;                     // 2 px de vide entre les deux colonnes
    const every = Math.max(1, Math.ceil(48 / slot));
    const bars = [], bands = [];

    slots.forEach((d, i) => {
      const sx = i * slot;
      const band = svg("rect", { x: sx, y: M.top - 6, width: slot, height: M.plot + 6, class: "viz-band" });
      plot.appendChild(band);
      bands.push(band);

      // Trait vertical au 1er du mois à 0 h : bord gauche de la case du 1er.
      const month = monthStart(slots, i);
      if (month) {
        const mx = Math.round(sx) + 0.5;
        plot.appendChild(svg("line", { x1: mx, x2: mx, y1: 4, y2: y0, class: "viz-month" }));
        plot.appendChild(svg("text", { x: mx + 5, y: 14, class: "viz-month-label" }, month));
      }

      series.forEach((s, k) => {
        const v = d[chart.keys[s.id]];
        if (!(v > 0)) return;
        const bx = sx + (slot - group) / 2 + k * (bw + 2);
        const by = Math.min(y(v), y0 - 1);        // une valeur non nulle reste visible
        plot.appendChild(column(bx, by, bw, y0, "viz-bar " + s.cls));
        bars.push({ i, k, x: bx, y: by, w: bw, v });
      });
      if (i % every === 0) {
        plot.appendChild(svg("text", { x: sx + slot / 2, y: y0 + 17, class: "viz-tick", "text-anchor": "middle" }, fmtDate(d.date, true)));
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
      if (box.x1 < 0 || box.x2 > w - 2 || box.y1 < 16) return;
      const hitBar = bars.some((b) => b !== best && b.x < box.x2 && b.x + b.w > box.x1 && b.y < box.y2);
      const hitLabel = placed.some((p) => p.x1 < box.x2 && p.x2 > box.x1 && p.y1 < box.y2 && p.y2 > box.y1);
      if (hitBar || hitLabel) return;
      placed.push(box);
      plot.appendChild(svg("text", { x: best.x + best.w / 2, y: best.y - 6, class: "viz-label", "text-anchor": "middle" }, text));
    });

    // Zones de survol : toute la colonne du jour, bien plus large que les barres.
    slots.forEach((d, i) => {
      const hit = svg("rect", { x: i * slot, y: 0, width: slot, height: h, class: "viz-hit" });
      hit.addEventListener("pointerenter", (e) => hover(i, e));
      hit.addEventListener("pointermove", (e) => hover(i, e));
      hit.addEventListener("pointerleave", () => hover(-1));
      plot.appendChild(hit);
    });

    const fig = el("div", "viz-chart");
    fig.appendChild(el("h3", "viz-title", chart.title));
    const row = el("div", "viz-row");
    const scroller = el("div", "viz-scroll");
    row.appendChild(axis);
    scroller.appendChild(plot);
    row.appendChild(scroller);
    fig.appendChild(row);
    host.appendChild(fig);
    return { bands, scroller, axis, plot, title: chart.title, height: h, width: w };
  }

  // ---- Export en image ----------------------------------------------------
  const STYLE_PROPS = ["fill", "stroke", "stroke-width", "font-family", "font-size", "font-weight"];

  // Copie d'un SVG avec ses styles calculés écrits en attributs : il reste lisible hors de la page.
  function standalone(source) {
    const clone = source.cloneNode(true);
    const a = [source, ...source.querySelectorAll("*")], b = [clone, ...clone.querySelectorAll("*")];
    a.forEach((node, i) => {
      const cs = getComputedStyle(node);
      for (const p of STYLE_PROPS) b[i].setAttribute(p, cs.getPropertyValue(p));
    });
    clone.querySelectorAll(".viz-hit, .viz-band").forEach((n) => n.remove());
    return clone;
  }

  // Assemble titre, légende et graphes dans un seul SVG, sur fond clair, puis le convertit en PNG.
  function exportImage(root, drawn, series, title, fileName) {
    root.classList.add("viz-export");            // couleurs du thème clair le temps de la copie
    const P = 20;
    let font, ink, muted, parts, swatches;
    try {
      const cs = getComputedStyle(root);
      font = cs.fontFamily; ink = cs.getPropertyValue("--ink").trim(); muted = cs.getPropertyValue("--muted").trim();
      swatches = series.map((s) => getComputedStyle(root.querySelector(".viz-key i." + s.cls)).backgroundColor);
      parts = drawn.map((d) => ({ d, axis: standalone(d.axis), plot: standalone(d.plot) }));
    } finally {
      root.classList.remove("viz-export");
    }
    const W = P + Math.max(...drawn.map((d) => 60 + d.width)) + P;
    let y = P + 18;
    const out = svg("svg", { xmlns: NS, width: W, viewBox: "0 0 " + W + " 0" });
    const text = (t, x, yy, size, weight, color) => out.appendChild(svg("text", { x, y: yy, "font-family": font, "font-size": size, "font-weight": weight, fill: color }, t));
    text(title, P, y, 16, 650, ink);
    y += 26;
    let x = P;
    series.forEach((s, i) => {
      out.appendChild(svg("rect", { x, y: y - 10, width: 10, height: 10, rx: 2, fill: swatches[i] }));
      text(s.label, x + 16, y, 13, 400, ink);
      x += 16 + s.label.length * 7.5 + 22;
    });
    y += 18;
    for (const p of parts) {
      text(p.d.title, P, y + 12, 13, 600, muted);
      y += 18;
      p.axis.setAttribute("x", P); p.axis.setAttribute("y", y);
      p.plot.setAttribute("x", P + 60); p.plot.setAttribute("y", y);
      out.appendChild(p.axis); out.appendChild(p.plot);
      y += p.d.height + 10;
    }
    const H = y + P - 10;
    out.setAttribute("height", H);
    out.setAttribute("viewBox", "0 0 " + W + " " + H);
    out.insertBefore(svg("rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff" }), out.firstChild);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // Double définition pour la netteté, dans la limite de taille des images du navigateur.
        const scale = Math.max(0.5, Math.min(2, 16000 / W, 16000 / H));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("image trop grande pour ce navigateur")); return; }
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = fileName;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          resolve({ width: canvas.width, height: canvas.height });
        }, "image/png");
      };
      img.onerror = () => reject(new Error("conversion en image impossible"));
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(out));
    });
  }

  // ---- Rendu --------------------------------------------------------------
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
    const exportBtn = el("button", "viz-export-btn", "Exporter en image");
    exportBtn.type = "button";
    exportBtn.title = "Image PNG des deux graphes, sur toute leur longueur";
    head.appendChild(exportBtn);
    const toggle = el("button", "viz-toggle", "Afficher le tableau des jours");
    toggle.type = "button";
    head.appendChild(toggle);
    root.appendChild(head);

    if (!days.length) {
      root.appendChild(el("p", "viz-empty", "Aucun jour à afficher."));
      toggle.hidden = true; exportBtn.hidden = true;
      return;
    }

    const slots = timeline(days);
    const plots = el("div", "viz-plots");
    const tip = el("div", "viz-tip");
    tip.hidden = true;
    root.appendChild(plots);
    root.appendChild(tip);

    // Une seule infobulle pour les deux graphes : les quatre valeurs du jour survolé.
    let drawn = [];
    function hover(i, e) {
      drawn.forEach((d) => d.bands.forEach((b, k) => b.classList.toggle("on", k === i)));
      if (i < 0) { tip.hidden = true; return; }
      const d = slots[i];
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
        for (const c of charts) grid.appendChild(el("b", null, c.fmtValue(d[c.keys[s.id]] || 0)));
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
      const left = drawn.length ? drawn[0].scroller.scrollLeft : 0;
      plots.textContent = "";
      drawn = charts.map((c) => drawChart(plots, slots, c, series, width, hover, fmtDate));
      // Défilement horizontal commun : faire défiler un graphe entraîne l'autre.
      for (const d of drawn) {
        d.scroller.scrollLeft = left;
        d.scroller.addEventListener("scroll", () => {
          for (const o of drawn) if (o !== d && o.scroller.scrollLeft !== d.scroller.scrollLeft) o.scroller.scrollLeft = d.scroller.scrollLeft;
        });
      }
    }
    draw();
    if (window.ResizeObserver) {
      root._vizObserver = new ResizeObserver(draw);
      root._vizObserver.observe(plots);
    }

    // Vue tableau : toutes les valeurs des graphes, lisibles sans survol (jours avec données seulement).
    const tableWrap = el("div", "viz-table");
    tableWrap.hidden = true;
    const table = el("table");
    const thead = el("thead"), trh = el("tr");
    trh.appendChild(el("th", null, "Jour"));
    for (const s of series) for (const c of charts) trh.appendChild(el("th", null, s.label + " : " + c.short.charAt(0).toLowerCase() + c.short.slice(1)));
    thead.appendChild(trh); table.appendChild(thead);
    const tbody = el("tbody");
    const sum = {};
    for (const d of slots) {
      if (d.empty) continue;
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
    function show(asTable) {
      root.dataset.view = asTable ? "table" : "plots";
      tableWrap.hidden = !asTable;
      plots.hidden = asTable;
      exportBtn.hidden = asTable;
      toggle.textContent = asTable ? "Afficher les graphes" : "Afficher le tableau des jours";
      if (!asTable) { lastWidth = -1; draw(); }
    }
    toggle.addEventListener("click", () => show(tableWrap.hidden));
    if (root.dataset.view === "table") show(true);

    exportBtn.addEventListener("click", () => {
      exportBtn.disabled = true;
      exportImage(root, drawn, series, cfg.title || "", cfg.fileName || "graphes.png")
        .then((size) => { if (cfg.onExport) cfg.onExport(null, size); })
        .catch((err) => { if (cfg.onExport) cfg.onExport(err); })
        .then(() => { exportBtn.disabled = false; });
    });
  }

  window.DayCharts = { render };
})();
