// Graphe par jour : un seul graphe, les montants en barres (axe de gauche) et les volumes
// en courbes (axe de droite), pour les dispenses et les refunds.
// Chaque axe porte son unité et le type de tracé qui s'y lit ; les deux échelles ont le même
// nombre de graduations, pour partager la même grille.
// Exposé en global : window.DayCharts.render(root, { days, measures, series, fmtDate, title, fileName })
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

  // Plus petit pas « rond » supérieur ou égal à x : 1 / 2 / 5 (ou 2,5 pour les montants) × 10^k.
  function niceStep(x, integer) {
    if (!(x > 0)) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(x)));
    const f = x / pow;
    // 2,5 n'est proposé pour un nombre entier que s'il donne un pas entier (25, 250...).
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 && (!integer || pow >= 10) ? 2.5 : f <= 5 ? 5 : 10) * pow;
    return integer ? Math.max(1, Math.round(step)) : step;
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

  const M = { left: 64, right: 56, top: 34, bottom: 28, plot: 230, end: 12 };

  // Deux axes verticaux fixes (montants à gauche, volumes à droite) et un tracé qui défile entre les deux.
  function drawChart(host, slots, bar, line, series, width, hover, fmtDate) {
    const n = slots.length;
    const avail = Math.max(120, width - M.left - M.right);
    const slot = Math.max(26, (avail - M.end) / Math.max(1, n));        // toute la largeur disponible
    const w = Math.max(avail, n * slot + M.end);
    const h = M.top + M.plot + M.bottom;
    const y0 = M.top + M.plot;

    let maxBar = 0, maxLine = 0;
    for (const d of slots) for (const s of series) {
      maxBar = Math.max(maxBar, d[bar.keys[s.id]] || 0);
      maxLine = Math.max(maxLine, d[line.keys[s.id]] || 0);
    }
    // Même nombre de graduations des deux côtés : une seule grille sert aux deux échelles.
    const barStep = niceStep(maxBar / 4, false);
    const ticks = Math.max(1, Math.ceil(maxBar / barStep - 1e-9));
    const lineStep = niceStep(maxLine / ticks, true);
    const yBar = (v) => y0 - (v / (barStep * ticks)) * M.plot;
    const yLine = (v) => y0 - (v / (lineStep * ticks)) * M.plot;

    const left = svg("svg", { width: M.left, height: h, viewBox: "0 0 " + M.left + " " + h, "aria-hidden": "true" });
    const right = svg("svg", { width: M.right, height: h, viewBox: "0 0 " + M.right + " " + h, "aria-hidden": "true" });
    const plot = svg("svg", { width: w, height: h, viewBox: "0 0 " + w + " " + h, role: "img", "aria-label": bar.axis + " en barres, " + line.axis.toLowerCase() + " en courbes, par jour" });

    // Grille et graduations : traits fins et pleins, en retrait.
    for (let k = 0; k <= ticks; k++) {
      const yy = Math.round(y0 - (k / ticks) * M.plot) + 0.5;
      plot.appendChild(svg("line", { x1: 0, x2: w, y1: yy, y2: yy, class: k === 0 ? "viz-axis" : "viz-grid" }));
      left.appendChild(svg("text", { x: M.left - 8, y: yy + 4, class: "viz-tick", "text-anchor": "end" }, bar.fmtTick(k * barStep)));
      right.appendChild(svg("text", { x: 8, y: yy + 4, class: "viz-tick" }, line.fmtTick(k * lineStep)));
    }

    const pad = Math.max(8, slot * 0.28);
    const bw = Math.max(4, Math.min(24, Math.floor((slot - 2 - pad) / 2)));
    const group = bw * 2 + 2;                     // 2 px de vide entre les deux colonnes
    const every = Math.max(1, Math.ceil(48 / slot));
    const bands = [];

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
        const v = d[bar.keys[s.id]];
        if (!(v > 0)) return;
        const bx = sx + (slot - group) / 2 + k * (bw + 2);
        plot.appendChild(column(bx, Math.min(yBar(v), y0 - 1), bw, y0, "viz-bar " + s.cls));   // une valeur non nulle reste visible
      });
      if (i % every === 0) {
        plot.appendChild(svg("text", { x: sx + slot / 2, y: y0 + 17, class: "viz-tick", "text-anchor": "middle" }, fmtDate(d.date, true)));
      }
    });

    // Courbes des volumes, par-dessus les barres. La courbe s'interrompt sur les jours sans donnée ;
    // un liseré de la couleur du fond la détache des barres qu'elle croise.
    series.forEach((s) => {
      let path = "", open = false;
      const points = [];
      slots.forEach((d, i) => {
        if (d.empty) { open = false; return; }
        const x = i * slot + slot / 2, y = yLine(d[line.keys[s.id]] || 0);
        path += (open ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
        open = true;
        points.push([x, y]);
      });
      if (!points.length) return;
      plot.appendChild(svg("path", { d: path, class: "viz-line-halo" }));
      plot.appendChild(svg("path", { d: path, class: "viz-line " + s.cls }));
      const r = slot >= 34 ? 4 : 3;
      for (const [x, y] of points) plot.appendChild(svg("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r, class: "viz-dot " + s.cls }));
    });

    // Zones de survol : toute la colonne du jour, bien plus large que les tracés.
    slots.forEach((d, i) => {
      const hit = svg("rect", { x: i * slot, y: 0, width: slot, height: h, class: "viz-hit" });
      hit.addEventListener("pointerenter", (e) => hover(i, e));
      hit.addEventListener("pointermove", (e) => hover(i, e));
      hit.addEventListener("pointerleave", () => hover(-1));
      plot.appendChild(hit);
    });

    // Titre de chaque axe, au-dessus de lui, avec le type de tracé qui s'y lit.
    const axes = el("div", "viz-axes");
    const titleLeft = el("span", "viz-axis-title");
    titleLeft.appendChild(el("i", "k-bar"));
    titleLeft.appendChild(document.createTextNode(bar.axis + " : barres"));
    const titleRight = el("span", "viz-axis-title");
    titleRight.appendChild(el("i", "k-line"));
    titleRight.appendChild(document.createTextNode(line.axis + " : courbes"));
    axes.appendChild(titleLeft); axes.appendChild(titleRight);
    host.appendChild(axes);

    const row = el("div", "viz-row");
    const scroller = el("div", "viz-scroll");
    row.appendChild(left);
    scroller.appendChild(plot);
    row.appendChild(scroller);
    row.appendChild(right);
    host.appendChild(row);
    return { bands, scroller, left, right, plot, height: h, width: w, axisTitles: [bar.axis + " : barres", line.axis + " : courbes"] };
  }

  // ---- Export en image ----------------------------------------------------
  const STYLE_PROPS = ["fill", "stroke", "stroke-width", "stroke-linejoin", "stroke-linecap", "font-family", "font-size", "font-weight"];

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

  // Assemble titre, légende et graphe dans un seul SVG, sur fond clair, puis le convertit en PNG.
  function exportImage(root, drawn, keys, title, fileName) {
    root.classList.add("viz-export");            // couleurs du thème clair le temps de la copie
    const P = 20;
    let font, ink, muted, colors, left, plot, right;
    try {
      const cs = getComputedStyle(root);
      font = cs.fontFamily; ink = cs.getPropertyValue("--ink").trim(); muted = cs.getPropertyValue("--muted").trim();
      colors = keys.map((k) => getComputedStyle(k.swatch).backgroundColor);
      left = standalone(drawn.left); plot = standalone(drawn.plot); right = standalone(drawn.right);
    } finally {
      root.classList.remove("viz-export");
    }
    const W = P + M.left + drawn.width + M.right + P;
    let y = P + 18;
    const out = svg("svg", { xmlns: NS, width: W, viewBox: "0 0 " + W + " 0" });
    const text = (t, x, yy, size, weight) => out.appendChild(svg("text", { x, y: yy, "font-family": font, "font-size": size, "font-weight": weight, fill: ink }, t));
    text(title, P, y, 16, 650);
    y += 26;
    let x = P;
    keys.forEach((k, i) => {
      if (k.kind === "bar") out.appendChild(svg("rect", { x, y: y - 10, width: 10, height: 10, rx: 2, fill: colors[i] }));
      else {
        out.appendChild(svg("line", { x1: x - 2, x2: x + 14, y1: y - 5, y2: y - 5, stroke: colors[i], "stroke-width": 2 }));
        out.appendChild(svg("circle", { cx: x + 6, cy: y - 5, r: 3.5, fill: colors[i] }));
      }
      text(k.label, x + 20, y, 13, 400);
      x += 20 + k.label.length * 7.2 + 24;
    });
    y += 30;
    // Titres des axes : à gauche pour les barres, à droite pour les courbes.
    out.appendChild(svg("text", { x: P, y, "font-family": font, "font-size": 11, "font-weight": 600, fill: muted }, drawn.axisTitles[0]));
    out.appendChild(svg("text", { x: W - P, y, "text-anchor": "end", "font-family": font, "font-size": 11, "font-weight": 600, fill: muted }, drawn.axisTitles[1]));
    y += 4;
    left.setAttribute("x", P); left.setAttribute("y", y);
    plot.setAttribute("x", P + M.left); plot.setAttribute("y", y);
    right.setAttribute("x", P + M.left + drawn.width); right.setAttribute("y", y);
    out.appendChild(left); out.appendChild(plot); out.appendChild(right);
    const H = y + drawn.height + P;
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
    const { days, measures, series, fmtDate } = cfg;
    const bar = measures.find((m) => m.mark === "bar"), line = measures.find((m) => m.mark === "line");
    root.textContent = "";
    if (root._vizObserver) { root._vizObserver.disconnect(); root._vizObserver = null; }

    // Légende : une entrée par tracé. Le texte reste en encre, la pastille ou le trait porte la couleur.
    const head = el("div", "viz-head");
    const legend = el("div", "viz-legend");
    const keys = [];
    for (const m of [bar, line]) {
      for (const s of series) {
        const item = el("span", "viz-key");
        const swatch = el("i", "k-" + m.mark + " " + s.cls);
        item.appendChild(swatch);
        const label = s.label + ", " + m.short.charAt(0).toLowerCase() + m.short.slice(1);
        item.appendChild(document.createTextNode(label));
        legend.appendChild(item);
        keys.push({ kind: m.mark, label, swatch });
      }
    }
    head.appendChild(legend);
    const exportBtn = el("button", "viz-export-btn", "Exporter en image");
    exportBtn.type = "button";
    exportBtn.title = "Image PNG du graphe, sur toute sa longueur";
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

    // Infobulle : les quatre valeurs du jour survolé.
    let drawn = null;
    function hover(i, e) {
      if (drawn) drawn.bands.forEach((b, k) => b.classList.toggle("on", k === i));
      if (i < 0) { tip.hidden = true; return; }
      const d = slots[i];
      tip.textContent = "";
      tip.appendChild(el("div", "viz-tip-date", fmtDate(d.date, false)));
      const grid = el("div", "viz-tip-grid");
      grid.appendChild(el("span"));
      for (const m of measures) grid.appendChild(el("span", "viz-tip-col", m.short));
      for (const s of series) {
        const name = el("span", "viz-tip-name");
        name.appendChild(el("i", s.cls));
        name.appendChild(document.createTextNode(s.label));
        grid.appendChild(name);
        for (const m of measures) grid.appendChild(el("b", null, m.fmtValue(d[m.keys[s.id]] || 0)));
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
      const scrolled = drawn ? drawn.scroller.scrollLeft : 0;
      plots.textContent = "";
      drawn = drawChart(plots, slots, bar, line, series, width, hover, fmtDate);
      drawn.scroller.scrollLeft = scrolled;
    }
    draw();
    if (window.ResizeObserver) {
      root._vizObserver = new ResizeObserver(draw);
      root._vizObserver.observe(plots);
    }

    // Vue tableau : toutes les valeurs du graphe, lisibles sans survol (jours avec données seulement).
    const tableWrap = el("div", "viz-table");
    tableWrap.hidden = true;
    const table = el("table");
    const thead = el("thead"), trh = el("tr");
    trh.appendChild(el("th", null, "Jour"));
    for (const s of series) for (const m of measures) trh.appendChild(el("th", null, s.label + " : " + m.short.charAt(0).toLowerCase() + m.short.slice(1)));
    thead.appendChild(trh); table.appendChild(thead);
    const tbody = el("tbody");
    const sum = {};
    for (const d of slots) {
      if (d.empty) continue;
      const tr = el("tr");
      tr.appendChild(el("td", null, fmtDate(d.date, false)));
      for (const s of series) for (const m of measures) {
        const key = m.keys[s.id];
        sum[key] = (sum[key] || 0) + d[key];
        tr.appendChild(el("td", null, m.fmtValue(d[key])));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    const tfoot = el("tfoot"), trf = el("tr");
    trf.appendChild(el("td", null, "Total"));
    for (const s of series) for (const m of measures) trf.appendChild(el("td", null, m.fmtValue(sum[m.keys[s.id]] || 0)));
    tfoot.appendChild(trf); table.appendChild(tfoot);
    tableWrap.appendChild(table);
    root.appendChild(tableWrap);

    // Le choix graphe / tableau est conservé quand on change de client.
    function show(asTable) {
      root.dataset.view = asTable ? "table" : "plots";
      tableWrap.hidden = !asTable;
      plots.hidden = asTable;
      exportBtn.hidden = asTable;
      toggle.textContent = asTable ? "Afficher le graphe" : "Afficher le tableau des jours";
      if (!asTable) { lastWidth = -1; draw(); }
    }
    toggle.addEventListener("click", () => show(tableWrap.hidden));
    if (root.dataset.view === "table") show(true);

    exportBtn.addEventListener("click", () => {
      exportBtn.disabled = true;
      exportImage(root, drawn, keys, cfg.title || "", cfg.fileName || "graphe.png")
        .then((size) => { if (cfg.onExport) cfg.onExport(null, size); })
        .catch((err) => { if (cfg.onExport) cfg.onExport(err); })
        .then(() => { exportBtn.disabled = false; });
    });
  }

  window.DayCharts = { render };
})();
