// Calculs de l'écran Analyse : prévision par jour et repérage des jours hors enveloppe.
// Fonctions pures, sans accès à la page. Exposé en global : window.Analysis.
//
// Modèle de prévision, par client, sur une série journalière (un point par jour du calendrier) :
//   1. effet du jour de la semaine : moyenne du jour / moyenne générale ;
//   2. série corrigée de cet effet ; tendance linéaire par la méthode de Theil-Sen
//      (médiane des pentes), peu sensible aux jours aberrants ;
//   3. prévision = tendance × effet du jour de la semaine ;
//   4. dispersion : écart absolu médian des résidus (× 1,4826), proportionnelle à la racine de
//      l'effet du jour de la semaine (bruit de comptage : un jour deux fois plus chargé varie
//      √2 fois plus, pas deux fois plus). Pour un nombre, elle vaut au moins √prévision.
// L'enveloppe est prévision ± K × dispersion. Un historique trop court (moins de MIN_DAYS jours
// actifs) se contente de la moyenne par jour de la semaine.
// L'agrégat additionne les prévisions des clients ; les dispersions s'ajoutent en variance.
(function () {
  "use strict";

  const DAY = 86400000;
  const K = 2.5;            // largeur de l'enveloppe, en dispersions robustes
  const MIN_DAYS = 14;      // jours actifs nécessaires pour estimer une tendance
  const MAX_POINTS = 400;   // au-delà, la pente est estimée sur un sous-échantillon régulier

  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  function median(a) {
    if (!a.length) return 0;
    const s = Float64Array.from(a).sort();
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  const weekday = (startUtc, t) => new Date(startUtc + t * DAY).getUTCDay();

  // values : observations journalières à partir de startUtc ; horizon : jours prévus au-delà.
  // floor : dispersion minimale, dans l'unité de la série.
  function fit(values, startUtc, horizon, floor, counts) {
    const n = values.length, len = n + horizon;
    const e = new Float64Array(len), sd = new Float64Array(len);
    const byWd = [[], [], [], [], [], [], []];
    values.forEach((v, t) => byWd[weekday(startUtc, t)].push(v));
    const overall = mean(values);
    const active = values.filter((v) => v > 0).length;

    if (active < MIN_DAYS || overall <= 0) {
      // Historique court : moyenne et écart-type par jour de la semaine.
      const m = byWd.map(mean);
      const s = byWd.map((a, w) => Math.sqrt(mean(a.map((v) => (v - m[w]) ** 2))));
      for (let t = 0; t < len; t++) {
        const w = weekday(startUtc, t);
        e[t] = m[w];
        sd[t] = Math.max(s[w], floor, 0.1 * m[w], counts ? Math.sqrt(m[w]) : 0);
      }
      return { model: active ? "moyenne" : "aucun", e, sd };
    }

    const factor = byWd.map((a) => (a.length ? mean(a) / overall : 1));
    const pts = [];
    values.forEach((v, t) => { const f = factor[weekday(startUtc, t)]; if (f > 0) pts.push([t, v / f]); });
    const step = Math.max(1, Math.ceil(pts.length / MAX_POINTS));
    const sample = pts.filter((_, i) => i % step === 0);
    const slopes = [];
    for (let i = 0; i < sample.length; i++) {
      for (let j = i + 1; j < sample.length; j++) slopes.push((sample[j][1] - sample[i][1]) / (sample[j][0] - sample[i][0]));
    }
    const b = median(slopes);
    const a = median(pts.map(([t, y]) => y - b * t));

    for (let t = 0; t < len; t++) e[t] = Math.max(0, a + b * t) * factor[weekday(startUtc, t)];
    // Résidus ramenés à l'échelle d'un jour « moyen », puis remis à l'échelle de chaque jour.
    const z = [];
    values.forEach((v, t) => { const f = factor[weekday(startUtc, t)]; if (f > 0) z.push((v - e[t]) / Math.sqrt(f)); });
    const mz = median(z);
    const s = 1.4826 * median(z.map((v) => Math.abs(v - mz)));
    for (let t = 0; t < len; t++) {
      const f = factor[weekday(startUtc, t)];
      sd[t] = Math.max(s * Math.sqrt(f), floor, 0.1 * e[t], counts ? Math.sqrt(e[t]) : 0);
    }
    return { model: "tendance", e, sd };
  }

  // Enveloppe et repérage : un jour observé hors de [bas ; haut] est douteux.
  function envelope(actual, e, sd) {
    const lo = new Float64Array(e.length), hi = new Float64Array(e.length), flags = [];
    for (let t = 0; t < e.length; t++) {
      lo[t] = Math.max(0, e[t] - K * sd[t]);
      hi[t] = e[t] + K * sd[t];
      if (t < actual.length && (actual[t] < lo[t] || actual[t] > hi[t])) {
        flags.push({ t, actual: actual[t], expected: e[t], lo: lo[t], hi: hi[t], z: sd[t] ? (actual[t] - e[t]) / sd[t] : 0 });
      }
    }
    return { lo, hi, flags };
  }

  // Jours consécutifs regroupés en plages : [{ from, to }] (indices inclus).
  function ranges(indices) {
    const out = [];
    for (const i of indices) {
      const last = out[out.length - 1];
      if (last && i === last.to + 1) last.to = i; else out.push({ from: i, to: i });
    }
    return out;
  }

  window.Analysis = { fit, envelope, ranges, K, MIN_DAYS, DAY };
})();
