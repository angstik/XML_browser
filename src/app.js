(function () {
  "use strict";

  const APP_VERSION = "__APP_VERSION__";     // remplacé par build.mjs (version.json)

  // ---- Structure attendue (fichiers ReconcilePayLoad) ---------------------
  const REC = "Dispense";                    // un flux
  const REF = "SuccessfulRefund";            // un refund
  const DATE_TAG = "InvoiceDate";            // date retenue pour ventiler les lignes
  const PARTNER_TAG = "PartnerID";           // identifiant client
  const ACCOUNT_TAG = "PaymentAccountNumber";// nom du client
  const PREVIEW_TAGS = ["InvoiceID", "InvoiceDate", "TotalAmount"];
  const NB_COLORS = 8;                       // couleurs des fichiers à doublons, en rotation
  const SHORT_LEN = 5;                       // longueur des noms courts
  const NO_CLIENT = "(sans client)";
  const NO_DATE = "(sans date)";

  const $ = (id) => document.getElementById(id);
  const fmtInt = new Intl.NumberFormat("fr-FR");
  const fmtDec = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtTick = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  const money = (c) => fmtDec.format(c / 100);
  const plural = (n, one, many) => fmtInt.format(n) + " " + (n > 1 ? many : one);
  const cmpText = (a, b) => String(a).localeCompare(String(b), "fr", { numeric: true });
  const errText = (e) => (e && (e.reason || e.message)) || String(e);
  const tick = () => new Promise((r) => setTimeout(r, 0));

  const COLS = [
    { key: "path", label: "Fichier", type: "text" },
    { key: "client", label: "Client", type: "text", title: "PaymentAccountNumber (PartnerID) de l'en-tête du bloc. Un fichier à plusieurs clients est traité comme autant de fichiers." },
    { key: "dateDisp", label: "Date dispense", type: "text", title: "InvoiceDate, renseignée si la ligne contient des enregistrements Dispense à cette date" },
    { key: "dateRef", label: "Date refund", type: "text", title: "InvoiceDate, renseignée si la ligne contient des enregistrements SuccessfulRefund à cette date" },
    { key: "fileDate", label: "Date fichier", type: "text", title: "Header / FileDate" },
    { key: "nFlux", label: "Flux", type: "int", title: "InvoiceID distincts des enregistrements Dispense" },
    { key: "items", label: "Items", type: "int", title: "Somme des Quantity des enregistrements Dispense (1 si Quantity est absent)" },
    { key: "ttc", label: "TTC", type: "money", title: "Somme des TotalAmount des enregistrements Dispense" },
    { key: "tva", label: "TVA", type: "money", title: "Somme des Tax/Fee dont le Name est TVA" },
    { key: "ht", label: "HT", type: "money", title: "TTC − TVA" },
    { key: "refN", label: "Refunds", type: "int", title: "Nombre d'enregistrements SuccessfulRefund" },
    { key: "refTtc", label: "Refunds TTC", type: "money", title: "Somme des TotalAmount des enregistrements SuccessfulRefund" },
    { key: "net", label: "Net TTC", type: "money", title: "TTC − Refunds TTC" },
    { key: "check", label: "Contrôle", type: "check", title: "Comparaison des totaux recalculés avec le trailer du bloc" },
  ];

  const state = {
    source: null,      // { name, entries:[{path,name,depth,getFile}], handle? }
    files: [],         // fichiers reconnus : { entry, res, color }
    rows: [],          // lignes (fichier × client × date) après sélection client / date
    view: [],          // lignes affichées (filtre texte, tri)
    ignored: [],
    sort: { key: "path", dir: 1 },
    sel: 0,
    filter: "",
    client: null,      // clé du client sélectionné, ou null
    dmin: "",          // période sélectionnée : première date incluse (AAAA-MM-JJ), ou ""
    dmax: "",          // dernière date incluse, ou ""
    short: false,      // noms de fichier raccourcis
    gen: 0,
    usePickerApi: typeof window.showDirectoryPicker === "function",
    open: null,        // ligne ouverte dans la visionneuse
  };

  // Préférence d'affichage, propre à ce navigateur.
  function pref(key, value) {
    try {
      if (value === undefined) return localStorage.getItem("xmlb." + key);
      localStorage.setItem("xmlb." + key, value);
    } catch (e) { /* stockage indisponible : la préférence n'est simplement pas mémorisée */ }
    return null;
  }

  // ---- Octets, texte, XML -------------------------------------------------
  function decode(bytes) {
    let enc = "utf-8";
    if (bytes[0] === 0xff && bytes[1] === 0xfe) enc = "utf-16le";
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) enc = "utf-16be";
    else {
      const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
      const m = head.match(/encoding\s*=\s*["']([\w.:-]+)["']/i);
      if (m) enc = m[1];
    }
    try { return new TextDecoder(enc).decode(bytes); }
    catch (e) { return new TextDecoder("utf-8").decode(bytes); }
  }

  function looksLikeXml(bytes) {
    if (!bytes.length) return false;
    const s = new TextDecoder("latin1").decode(bytes.subarray(0, 256)).replace(/\u0000/g, "").replace(/^[\u00ef\u00bb\u00bf\u00ff\u00fe]+/, "");
    return s.trimStart().startsWith("<");
  }

  const isRar = (b) => b.length >= 6 && b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21 && b[4] === 0x1a && b[5] === 0x07;

  // Le module RAR (WebAssembly) n'est chargé que si une archive est rencontrée.
  let rarPromise = null;
  function rarReader() {
    if (window.RarReader) return Promise.resolve(window.RarReader);
    if (!rarPromise) {
      rarPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "rar.js";
        s.onload = () => resolve(window.RarReader);
        s.onerror = () => { rarPromise = null; reject(new Error("module RAR introuvable")); };
        document.head.appendChild(s);
      });
    }
    return rarPromise;
  }
  function rarReason(e) {
    const r = errText(e);
    if (/PASSWORD/i.test(r)) return "archive protégée par mot de passe";
    if (/EOPEN|VOLUME/i.test(r)) return "archive en plusieurs volumes ou incomplète";
    return "archive RAR illisible (" + r + ")";
  }

  // Type d'archive, d'après les premiers octets du fichier et son nom.
  // ZIP et GZIP servent de conteneur à bien d'autres formats (docx, xlsx...) : l'extension est exigée.
  function archiveKind(name, head) {
    const n = name.toLowerCase();
    if (isRar(head)) return "rar";
    if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5) && /\.zip$/.test(n)) return "zip";
    if (head[0] === 0x1f && head[1] === 0x8b && /\.(gz|tgz)$/.test(n)) return "gz";
    if (window.Archives.isTar(head) && (/\.tar$/.test(n) || (head[257] === 0x75 && head[258] === 0x73 && head[259] === 0x74 && head[260] === 0x61 && head[261] === 0x72))) return "tar";
    return null;
  }
  const KIND_LABEL = { rar: "RAR", zip: "ZIP", tar: "TAR", gz: "GZIP" };
  const archiveReader = (kind) => (kind === "rar" ? rarReader() : Promise.resolve(window.Archives[kind]));

  async function bytesOf(entry) {
    if (entry.getBytes) return entry.getBytes();
    return new Uint8Array(await (await entry.getFile()).arrayBuffer());
  }

  function kids(el) {
    const m = {};
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (!(c.localName in m)) m[c.localName] = c;
    }
    return m;
  }
  const txt = (el) => (el ? el.textContent.trim() : "");
  function cents(s) {
    if (!s) return null;
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  function taxes(el) {
    let tva = 0, other = 0;
    const list = el.getElementsByTagName("Tax");
    for (let i = 0; i < list.length; i++) {
      const k = kids(list[i]);
      const fee = cents(txt(k.Fee));
      if (fee === null) continue;
      if (/^tva$/i.test(txt(k.Name))) tva += fee; else other += fee;
    }
    return { tva, other };
  }
  function newAgg() {
    return { inv: new Set(), noId: 0, dispN: 0, items: 0, ttc: 0, tva: 0, other: 0, refN: 0, refTtc: 0, refTva: 0, bad: 0 };
  }

  const clientKey = (partner, account) => partner + "\u0001" + account;
  function clientLabel(partner, account) {
    if (account && partner) return account + " (" + partner + ")";
    return account || partner || NO_CLIENT;
  }

  // Bloc d'un élément : premier ancêtre ayant un enfant Header. Son en-tête donne le client.
  function blockResolver() {
    const byParent = new Map(), byBlock = new Map();
    const none = { el: null, partner: "", account: "", fileDate: "", fileId: "" };
    function find(start) {
      for (let p = start; p; p = p.parentElement) {
        for (let c = p.firstElementChild; c; c = c.nextElementSibling) {
          if (c.localName !== "Header") continue;
          let info = byBlock.get(p);
          if (!info) {
            const hk = kids(c);
            info = { el: p, partner: txt(hk[PARTNER_TAG]), account: txt(hk[ACCOUNT_TAG]), fileDate: txt(hk.FileDate), fileId: txt(hk.FileID) };
            byBlock.set(p, info);
          }
          return info;
        }
      }
      return none;
    }
    return function (el) {
      const parent = el.parentElement;
      let info = byParent.get(parent);
      if (!info) { info = find(parent); byParent.set(parent, info); }
      return info;
    };
  }

  // Renvoie null si le XML ne contient aucun enregistrement reconnu.
  // Sinon : une « unité » par client présent dans le fichier.
  function analyze(doc) {
    const recs = doc.getElementsByTagName(REC);
    const refs = doc.getElementsByTagName(REF);
    if (!recs.length && !refs.length) return null;

    const blockOf = blockResolver();
    const units = new Map();   // clé client → unité
    const unitFor = (el, k) => {
      const b = blockOf(el);
      // Un PartnerID porté par l'enregistrement lui-même prime sur celui de l'en-tête.
      const partner = (k && txt(k[PARTNER_TAG])) || b.partner;
      const key = clientKey(partner, b.account);
      let u = units.get(key);
      if (!u) {
        u = { key, partner, account: b.account, label: clientLabel(partner, b.account), fileDate: b.fileDate, fileId: b.fileId,
          dates: new Map(), n: { dN: 0, dS: 0, rN: 0, rS: 0 }, exp: { dN: 0, dS: 0, rN: 0, rS: 0 }, has: {}, trailers: 0 };
        units.set(key, u);
      }
      return u;
    };
    const agg = (u, date) => { let a = u.dates.get(date); if (!a) { a = newAgg(); u.dates.set(date, a); } return a; };

    for (let i = 0; i < recs.length; i++) {
      const k = kids(recs[i]);
      const u = unitFor(recs[i], k), a = agg(u, txt(k[DATE_TAG]));
      a.dispN++; u.n.dN++;
      const id = txt(k.InvoiceID);
      if (id) a.inv.add(id); else a.noId++;
      const qRaw = txt(k.Quantity), q = Number(qRaw.replace(",", "."));
      a.items += qRaw !== "" && Number.isFinite(q) ? q : 1;
      const t = cents(txt(k.TotalAmount));
      if (t === null) a.bad++; else { a.ttc += t; u.n.dS += t; }
      const tx = taxes(recs[i]);
      a.tva += tx.tva; a.other += tx.other;
    }
    for (let i = 0; i < refs.length; i++) {
      const k = kids(refs[i]);
      const u = unitFor(refs[i], k), a = agg(u, txt(k[DATE_TAG]));
      a.refN++; u.n.rN++;
      const t = cents(txt(k.TotalAmount));
      if (t === null) a.bad++; else { a.refTtc += t; u.n.rS += t; }
      a.refTva += taxes(refs[i]).tva;
    }

    // Contrôle avec les trailers : par client quand chaque trailer est dans un bloc à en-tête,
    // sinon sur le fichier entier.
    let trailers = doc.getElementsByTagName("trailer");
    if (!trailers.length) trailers = doc.getElementsByTagName("Trailer");
    const whole = { n: { dN: 0, dS: 0, rN: 0, rS: 0 }, exp: { dN: 0, dS: 0, rN: 0, rS: 0 }, has: {}, trailers: 0 };
    units.forEach((u) => { for (const k in whole.n) whole.n[k] += u.n[k]; });
    let perClient = trailers.length > 0;
    for (let i = 0; i < trailers.length; i++) {
      const k = kids(trailers[i]);
      const b = blockOf(trailers[i]);
      const u = b.el ? units.get(clientKey(b.partner, b.account)) : null;
      if (!u) perClient = false;
      for (const target of u ? [u, whole] : [whole]) {
        target.trailers++;
        const add = (key, tag, conv) => {
          const raw = txt(k[tag]); if (raw === "") return;
          const v = conv(raw); if (v === null || Number.isNaN(v)) return;
          target.exp[key] += v; target.has[key] = true;
        };
        add("dN", "TotalDispenseRecords", Number);
        add("dS", "SumDispenseTotalAmount", cents);
        add("rN", "TotalSuccessfulRefundRecords", Number);
        add("rS", "SumSuccessfulRefundTotalAmount", cents);
      }
    }
    const verdict = (t) => {
      if (!t.trailers) return { state: "none", details: ["Pas de trailer"] };
      const d = [];
      if (t.has.dN && t.exp.dN !== t.n.dN) d.push("Dispense : " + t.n.dN + " lus, " + t.exp.dN + " au trailer");
      if (t.has.dS && t.exp.dS !== t.n.dS) d.push("TTC Dispense : " + money(t.n.dS) + " lus, " + money(t.exp.dS) + " au trailer");
      if (t.has.rN && t.exp.rN !== t.n.rN) d.push("Refunds : " + t.n.rN + " lus, " + t.exp.rN + " au trailer");
      if (t.has.rS && t.exp.rS !== t.n.rS) d.push("TTC refunds : " + money(t.n.rS) + " lus, " + money(t.exp.rS) + " au trailer");
      return d.length ? { state: "ko", details: d } : { state: "ok", details: ["Nombres et montants identiques au trailer"] };
    };
    const wholeCheck = verdict(whole);
    if (!perClient && units.size > 1 && wholeCheck.details.length) wholeCheck.details.push("(contrôle sur le fichier entier)");
    units.forEach((u) => { u.check = perClient ? verdict(u) : wholeCheck; });

    const list = [...units.values()].sort((a, b) => cmpText(a.label, b.label));
    return { units: list, nRows: list.reduce((n, u) => n + u.dates.size, 0) };
  }

  // Une date est-elle dans la période sélectionnée ? Sans date, elle n'est dans aucune période.
  function inRange(d) {
    if (!state.dmin && !state.dmax) return true;
    if (!d) return false;
    return (!state.dmin || d >= state.dmin) && (!state.dmax || d <= state.dmax);
  }
  function rangeText() {
    if (state.dmin && state.dmax) return state.dmin === state.dmax ? "le " + state.dmin : "du " + state.dmin + " au " + state.dmax;
    if (state.dmin) return "à partir du " + state.dmin;
    if (state.dmax) return "jusqu'au " + state.dmax;
    return "toutes dates";
  }

  // Lignes (fichier × client × date) compte tenu du client et de la période sélectionnés.
  function buildRows() {
    const rows = [];
    for (const f of state.files) {
      const res = f.res;
      for (const u of res.units) {
        if (state.client !== null && u.key !== state.client) continue;
        const dates = [...u.dates.keys()].sort();
        for (const d of dates) {
          if (!inRange(d)) continue;
          const a = u.dates.get(d);
          rows.push({
            file: f, entry: f.entry, path: f.entry.path, unit: u,
            client: u.label, clientKey: u.key,
            date: d,
            dateDisp: a.dispN ? (d || NO_DATE) : "",
            dateRef: a.refN ? (d || NO_DATE) : "",
            fileDate: u.fileDate, fileId: u.fileId,
            nFlux: a.inv.size + a.noId, items: a.items,
            ttc: a.ttc, tva: a.tva, ht: a.ttc - a.tva, other: a.other,
            refN: a.refN, refTtc: a.refTtc, net: a.ttc - a.refTtc,
            bad: a.bad, check: u.check,
            // Doublon : le fichier donne plusieurs lignes (plusieurs dates ou plusieurs clients).
            dup: res.nRows > 1, color: f.color,
            nDates: dates.length, nClients: res.units.length,
          });
        }
      }
    }
    state.rows = rows;
  }

  // ---- Chargement ---------------------------------------------------------
  async function load() {
    const src = state.source;
    if (!src) return;
    const gen = ++state.gen;
    const recursive = $("recursive").checked;
    const entries = src.entries.filter((e) => recursive || e.depth === 0)
      .sort((a, b) => cmpText(a.path, b.path));

    const files = [], ignored = [];
    const progress = (i, label) => {
      $("progressBar").style.width = ((i / Math.max(1, entries.length)) * 100).toFixed(1) + "%";
      $("progressText").textContent = label;
    };

    // Analyse un fichier (du disque ou d'une archive) à partir de ses octets.
    function ingest(entry, bytes) {
      if (!looksLikeXml(bytes)) { ignored.push({ path: entry.path, reason: "pas un fichier XML" }); return; }
      const doc = new DOMParser().parseFromString(decode(bytes), "application/xml");
      if (doc.getElementsByTagName("parsererror").length) { ignored.push({ path: entry.path, reason: "XML mal formé" }); return; }
      const res = analyze(doc);
      if (!res) { ignored.push({ path: entry.path, reason: "aucun enregistrement " + REC + " ou " + REF }); return; }
      files.push({ entry, res, color: -1 });
    }

    // Une archive (RAR, ZIP, TAR, GZIP) se comporte comme un répertoire :
    // chaque fichier qu'elle contient est analysé.
    async function ingestArchive(kind, archive, file, i) {
      let reader;
      try { reader = await archiveReader(kind); }
      catch (e) { ignored.push({ path: archive.path, reason: "lecture " + KIND_LABEL[kind] + " indisponible (" + errText(e) + ")" }); return; }
      let n = 0;
      try {
        const buffer = await file.arrayBuffer();
        await reader.each(buffer, async (f) => {
          if (gen !== state.gen) return;
          n++;
          const entry = {
            path: archive.path + "/" + f.name, name: f.name.split("/").pop(), depth: archive.depth,
            getBytes: async () => (await archiveReader(kind)).one(await (await archive.getFile()).arrayBuffer(), f.rawName),
          };
          progress(i, "Archive " + archive.path + " : " + f.name);
          if (!f.bytes) ignored.push({ path: entry.path, reason: f.error ? "non extrait (" + errText(f.error) + ")" : "non extrait de l'archive" });
          else {
            try { ingest(entry, f.bytes); }
            catch (e) { ignored.push({ path: entry.path, reason: "lecture impossible (" + errText(e) + ")" }); }
          }
          await tick();
        }, archive.name);
        if (!n) ignored.push({ path: archive.path, reason: "archive vide" });
      } catch (e) {
        ignored.push({ path: archive.path, reason: kind === "rar" ? rarReason(e) : "archive " + KIND_LABEL[kind] + " illisible (" + errText(e) + ")" });
      }
    }

    $("progress").hidden = false;
    for (let i = 0; i < entries.length; i++) {
      if (gen !== state.gen) return;
      const e = entries[i];
      progress(i, "Lecture " + (i + 1) + " / " + entries.length + " : " + e.path);
      try {
        const file = await e.getFile();
        const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
        const kind = archiveKind(e.name, head);
        if (kind) await ingestArchive(kind, e, file, i);
        else ingest(e, new Uint8Array(await file.arrayBuffer()));
      } catch (err) {
        ignored.push({ path: e.path, reason: "lecture impossible (" + errText(err) + ")" });
      }
    }
    if (gen !== state.gen) return;
    $("progress").hidden = true;

    // Une couleur par fichier à doublons, dans l'ordre des noms.
    files.sort((a, b) => cmpText(a.entry.path, b.entry.path));
    let nDup = 0;
    for (const f of files) f.color = f.res.nRows > 1 ? nDup++ % NB_COLORS : -1;

    state.files = files;
    state.ignored = ignored;
    state.sel = 0;
    $("dirName").textContent = src.name || "";
    fillSelectors();
    buildRows();
    render();
    if (state.rows.length) $("tableWrap").focus();
  }

  async function entriesFromHandle(dir) {
    const out = [];
    async function walk(h, prefix, depth) {
      for await (const [name, child] of h.entries()) {
        if (child.kind === "file") out.push({ path: prefix + name, name, depth, getFile: () => child.getFile() });
        else if (child.kind === "directory") await walk(child, prefix + name + "/", depth + 1);
      }
    }
    await walk(dir, "", 0);
    return out;
  }

  function entriesFromInput(files) {
    let rootName = "";
    const out = [];
    for (const f of files) {
      const parts = (f.webkitRelativePath || f.name).split("/");
      if (parts.length > 1) rootName = parts.shift();
      out.push({ path: parts.join("/"), name: f.name, depth: parts.length - 1, getFile: async () => f });
    }
    if (!rootName) rootName = out.length === 1 ? out[0].name : plural(out.length, "fichier", "fichiers");
    return { name: rootName, entries: out };
  }

  async function entriesFromDrop(roots) {
    const out = [];
    const readAll = (reader) => new Promise((res, rej) => {
      const all = [];
      (function next() {
        reader.readEntries((batch) => { if (!batch.length) res(all); else { all.push(...batch); next(); } }, rej);
      })();
    });
    async function walk(entry, prefix, depth) {
      if (entry.isFile) {
        out.push({ path: prefix + entry.name, name: entry.name, depth, getFile: () => new Promise((res, rej) => entry.file(res, rej)) });
      } else if (entry.isDirectory) {
        for (const child of await readAll(entry.createReader())) await walk(child, prefix + entry.name + "/", depth + 1);
      }
    }
    if (roots.length === 1 && roots[0].isDirectory) {
      for (const child of await readAll(roots[0].createReader())) await walk(child, "", 0);
      return { name: roots[0].name, entries: out };
    }
    for (const r of roots) await walk(r, "", 0);
    return { name: out.length === 1 ? out[0].name : "", entries: out };
  }

  async function pick() {
    if (state.usePickerApi) {
      try {
        const dir = await window.showDirectoryPicker({ mode: "read" });
        await setHandle(dir);
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
        state.usePickerApi = false;
        toast("Sélecteur de répertoire indisponible ici. Cliquez de nouveau sur « Choisir un répertoire ».");
        return;
      }
    }
    $("dirInput").value = "";
    $("dirInput").click();
  }

  async function setHandle(dir) {
    state.source = { name: dir.name, entries: await entriesFromHandle(dir), handle: dir };
    $("refresh").hidden = false;
    await load();
  }

  // ---- Sélection par client et par période ---------------------------------
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const monthLabel = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  // Premier et dernier jour d'un mois « AAAA-MM ».
  function monthBounds(ym) {
    const [y, m] = ym.split("-").map(Number);
    return [ym + "-01", ym + "-" + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")];
  }

  function fillSelectors() {
    const byClient = new Map(), byMonth = new Map(), labels = new Map();
    const bump = (map, key, f) => { let s = map.get(key); if (!s) { s = new Set(); map.set(key, s); } s.add(f); };
    let first = "", last = "";
    for (const f of state.files) {
      for (const u of f.res.units) {
        bump(byClient, u.key, f);
        labels.set(u.key, u.label);
        u.dates.forEach((_a, d) => {
          if (!ISO_DATE.test(d)) return;
          bump(byMonth, d.slice(0, 7), f);
          if (!first || d < first) first = d;
          if (!last || d > last) last = d;
        });
      }
    }
    if (state.client !== null && !byClient.has(state.client)) state.client = null;

    const fill = (sel, map, all, label, current) => {
      sel.textContent = "";
      const head = el("option", null, all);
      head.value = ""; sel.appendChild(head);
      [...map.keys()].sort((a, b) => cmpText(label(a), label(b))).forEach((k) => {
        const o = el("option", null, label(k) + "  (" + plural(map.get(k).size, "fichier", "fichiers") + ")");
        o.value = "v:" + k;
        if (current === k) o.selected = true;
        sel.appendChild(o);
      });
    };
    fill($("selClient"), byClient, "Tous (" + fmtInt.format(byClient.size) + ")", (k) => labels.get(k), state.client);
    // Les mois sont listés dans l'ordre du calendrier ; le libellé est en clair, la valeur reste « AAAA-MM ».
    const sel = $("selMonth");
    sel.textContent = "";
    const head = el("option", null, "Mois complet…");
    head.value = ""; sel.appendChild(head);
    [...byMonth.keys()].sort().forEach((ym) => {
      const o = el("option", null, monthLabel.format(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1, 1))) + "  (" + plural(byMonth.get(ym).size, "fichier", "fichiers") + ")");
      o.value = ym; sel.appendChild(o);
    });
    // Les champs de date sont bornés aux dates présentes dans les fichiers.
    for (const id of ["dateMin", "dateMax"]) { $(id).min = first; $(id).max = last; }
    syncRangeInputs();
  }

  // Reflète la période dans les champs, et le mois dans la liste si la période est un mois entier.
  function syncRangeInputs() {
    $("dateMin").value = state.dmin;
    $("dateMax").value = state.dmax;
    let month = "";
    if (state.dmin && state.dmax && state.dmin.slice(0, 7) === state.dmax.slice(0, 7)) {
      const b = monthBounds(state.dmin.slice(0, 7));
      if (b[0] === state.dmin && b[1] === state.dmax) month = state.dmin.slice(0, 7);
    }
    $("selMonth").value = [...$("selMonth").options].some((o) => o.value === month) ? month : "";
  }

  function applySelection() {
    const c = $("selClient").value;
    state.client = c === "" ? null : c.slice(2);
    let lo = $("dateMin").value, hi = $("dateMax").value;
    if (lo && hi && lo > hi) { const t = lo; lo = hi; hi = t; }      // bornes saisies à l'envers
    state.dmin = lo; state.dmax = hi;
    syncRangeInputs();
    state.sel = 0;
    buildRows();
    render();
  }

  function renderSynth(t) {
    const active = state.client !== null || !!state.dmin || !!state.dmax;
    $("selbar").classList.toggle("active", active);
    $("selClear").hidden = !active;
    const box = $("synth");
    box.textContent = "";
    if (!active) return;
    const item = (label, value) => {
      const s = el("span", "s-item");
      s.appendChild(el("span", null, label));
      s.appendChild(el("b", null, value));
      box.appendChild(s);
    };
    item("Fichiers", fmtInt.format(t.files));
    if (state.client === null) item("Clients", fmtInt.format(t.clients));
    if (!(state.dmin && state.dmin === state.dmax)) item("Dates", fmtInt.format(t.dates));
    item("Flux", fmtInt.format(t.nFlux));
    item("Items", fmtInt.format(t.items));
    item("TTC", money(t.ttc));
    item("TVA", money(t.tva));
    item("HT", money(t.ht));
    item("Refunds", fmtInt.format(t.refN) + " (" + money(t.refTtc) + ")");
    item("Net TTC", money(t.net));
  }

  // ---- Rendu du tableau ---------------------------------------------------
  function cellText(col, r) {
    const v = r[col.key];
    switch (col.type) {
      case "int": return fmtInt.format(v);
      case "money": return money(v);
      case "check": return r.check.state === "ok" ? "OK" : r.check.state === "ko" ? "Écart" : "Sans trailer";
      default: return v;
    }
  }

  // Nom affiché : entier, ou les derniers caractères du nom (sans le chemin) si « Noms courts ».
  function displayName(path) {
    if (!state.short) return path;
    const base = path.split("/").pop();
    return base.length > SHORT_LEN ? "…" + base.slice(-SHORT_LEN) : base;
  }

  function sortValue(col, r) {
    if (col.type === "check") return { ko: 0, none: 1, ok: 2 }[r.check.state];
    return r[col.key];
  }

  function computeView() {
    const q = state.filter.trim().toLowerCase();
    let rows = state.rows;
    if (q) rows = rows.filter((r) => (r.path + " " + r.date + " " + r.fileDate + " " + r.client).toLowerCase().includes(q));
    const col = COLS.find((c) => c.key === state.sort.key) || COLS[0];
    const dir = state.sort.dir;
    const dateCol = col.key === "dateDisp" || col.key === "dateRef";
    rows = rows.slice().sort((a, b) => {
      const va = sortValue(col, a), vb = sortValue(col, b);
      // Colonnes de date : les lignes sans date de ce type restent en fin de liste.
      if (dateCol && (va === "") !== (vb === "")) return va === "" ? 1 : -1;
      const c = col.type === "text" ? cmpText(va, vb) : va - vb;
      if (c) return c * dir;
      return cmpText(a.path, b.path) || cmpText(a.client, b.client) || cmpText(a.date, b.date);
    });
    state.view = rows;
  }

  function totals(rows) {
    const t = { nFlux: 0, items: 0, ttc: 0, tva: 0, ht: 0, refN: 0, refTtc: 0, net: 0 };
    const clients = new Set(), files = new Set(), ko = new Set(), dates = new Set();
    for (const r of rows) {
      for (const k in t) t[k] += r[k];
      const unit = r.path + "\u0001" + r.clientKey;   // un fichier à deux clients compte pour deux
      files.add(unit);
      if (r.unit.partner || r.unit.account) clients.add(r.clientKey);
      dates.add(r.date);
      if (r.check.state === "ko") ko.add(unit);
    }
    t.clients = clients.size; t.files = files.size; t.dates = dates.size; t.ko = ko.size;
    return t;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function dupTags(r) {
    const tags = [];
    if (r.nClients > 1) tags.push(r.nClients + " clients");
    if (r.nDates > 1) tags.push(r.nDates + " dates");
    return tags;
  }

  function render() {
    computeView();
    const has = state.files.length > 0;
    $("empty").hidden = has;
    $("tableWrap").hidden = !has;
    $("hint").hidden = !has;
    $("selbar").hidden = !has;

    if (!has) {
      $("emptyDetail").textContent = state.source
        ? "Aucun fichier de réconciliation reconnu" + ($("recursive").checked || !state.source.entries.some((e) => e.depth > 0) ? "." : " (sous-répertoires non inclus).")
        : "";
    }

    // Notes : légende et fichiers ignorés
    const anyDup = state.files.some((f) => f.color >= 0);
    $("legend").hidden = !anyDup;
    $("ignored").hidden = state.ignored.length === 0;
    $("notes").hidden = !anyDup && state.ignored.length === 0;
    $("ignoredSummary").textContent = plural(state.ignored.length, "fichier ignoré", "fichiers ignorés");
    const ul = $("ignoredList"); ul.textContent = "";
    for (const g of state.ignored) {
      const li = el("li", null, g.path + " ");
      li.appendChild(el("span", null, g.reason));
      ul.appendChild(li);
    }
    if (!has) return;

    // En-tête
    const trh = el("tr");
    for (const c of COLS) {
      const th = el("th", "t-" + c.type);
      th.scope = "col";
      if (state.sort.key === c.key) th.setAttribute("aria-sort", state.sort.dir > 0 ? "ascending" : "descending");
      const b = el("button", null, c.label);
      b.type = "button"; b.tabIndex = -1;
      if (c.title) b.title = c.title;
      b.addEventListener("click", () => {
        if (state.sort.key === c.key) state.sort.dir = -state.sort.dir;
        else state.sort = { key: c.key, dir: c.type === "text" ? 1 : -1 };
        const cur = state.view[state.sel];
        render();
        const i = state.view.indexOf(cur);
        select(i < 0 ? 0 : i, true);
        $("tableWrap").focus();
      });
      th.appendChild(b); trh.appendChild(th);
    }
    $("thead").replaceChildren(trh);

    // Corps
    const frag = document.createDocumentFragment();
    state.view.forEach((r, i) => {
      const tr = el("tr", r.dup ? "dup dc" + r.color : "");
      tr.dataset.i = i;
      for (const c of COLS) {
        const td = el("td", "t-" + c.type + " c-" + c.key, c.key === "path" ? "" : cellText(c, r));
        if (c.key === "path") {
          // Le nom se tronque, les étiquettes de doublon restent toujours visibles.
          td.classList.add("file"); td.title = r.path;
          const wrap = el("span", "fwrap");
          // Nom trop long : c'est le début qui est coupé, la fin (le nom du fichier) reste lisible.
          const name = el("span", "fname");
          name.appendChild(el("bdi", null, displayName(r.path)));
          wrap.appendChild(name);
          if (r.dup) for (const t of dupTags(r)) wrap.appendChild(el("span", "tag", t));
          td.appendChild(wrap);
        } else if (c.type === "check") {
          td.classList.add("chk-" + r.check.state); td.title = r.check.details.join("\n");
        } else if ((c.type === "int" || c.type === "money") && r[c.key] === 0) {
          td.classList.add("zero");
        }
        if (c.key === "ttc" && r.bad) td.title = r.bad + " montant(s) illisible(s) non additionné(s)";
        if (c.key === "tva" && r.other) td.title = "Autres taxes non comptées en TVA : " + money(r.other);
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    });
    $("tbody").replaceChildren(frag);

    // Total
    const t = totals(state.view);
    const trf = el("tr");
    for (const c of COLS) {
      let text = "";
      if (c.key === "path") text = state.short ? plural(t.files, "fichier", "fichiers") : "Total : " + plural(t.files, "fichier", "fichiers");
      else if (c.key === "client") text = plural(t.clients, "client", "clients");
      else if (c.type === "int") text = fmtInt.format(t[c.key]);
      else if (c.type === "money") text = money(t[c.key]);
      else if (c.type === "check") text = t.ko ? plural(t.ko, "écart", "écarts") : "";
      const td = el("td", "t-" + c.type, text);
      if (c.type === "check" && t.ko) td.classList.add("chk-ko");
      trf.appendChild(td);
    }
    $("tfoot").replaceChildren(trf);
    renderSynth(t);

    const totalRows = state.files.reduce((n, f) => n + f.res.nRows, 0);
    $("count").textContent = plural(state.view.length, "ligne", "lignes")
      + (state.view.length !== totalRows ? " sur " + fmtInt.format(totalRows) : "");
    select(Math.min(state.sel, state.view.length - 1), false);
  }

  function select(i, scroll) {
    const body = $("tbody");
    const old = body.querySelector("tr.sel");
    if (old) { old.classList.remove("sel"); old.removeAttribute("aria-selected"); }
    if (!state.view.length) { state.sel = 0; return; }
    state.sel = Math.max(0, Math.min(state.view.length - 1, i));
    const tr = body.children[state.sel];
    if (!tr) return;
    tr.classList.add("sel"); tr.setAttribute("aria-selected", "true");
    if (scroll) reveal(tr, $("tableWrap"));
  }

  // Amène la ligne dans la zone visible, entre l'en-tête et le total qui restent collés.
  function reveal(tr, wrap) {
    const w = wrap.getBoundingClientRect(), r = tr.getBoundingClientRect();
    const headCell = wrap.querySelector("thead th"), footCell = wrap.querySelector("tfoot td");
    const top = w.top + (headCell ? headCell.getBoundingClientRect().height : 0);
    const bottom = w.top + wrap.clientHeight - (footCell ? footCell.getBoundingClientRect().height : 0);
    if (r.top < top) wrap.scrollTop -= top - r.top;
    else if (r.bottom > bottom) wrap.scrollTop += r.bottom - bottom;
  }

  function pageSize() {
    const tr = $("tbody").firstElementChild;
    const h = tr ? tr.getBoundingClientRect().height : 30;
    return Math.max(1, Math.floor($("tableWrap").clientHeight / h) - 3);
  }

  // ---- Visionneuse --------------------------------------------------------
  let viewer = null;
  let dateHits = [], savedScroll = 0;

  function summaryItem(label, value, cls) {
    const s = el("span", "s-item" + (cls ? " " + cls : ""));
    s.appendChild(el("span", null, label));
    s.appendChild(el("b", null, value));
    return s;
  }

  async function openRow(r) {
    if (!r) return;
    savedScroll = $("tableWrap").scrollTop;
    state.open = r;
    $("list").hidden = true;
    $("viewer").hidden = false;

    const sum = $("summary"); sum.textContent = "";
    sum.className = "summary" + (r.dup ? " dup dc" + r.color : "");
    const name = el("span", "s-file", r.path);
    name.title = r.path;
    sum.appendChild(name);
    sum.appendChild(summaryItem("Client", r.client, r.nClients > 1 ? "hl" : ""));
    const kind = r.dateDisp && r.dateRef ? "Dispense + refund" : r.dateRef ? "Refund" : "Dispense";
    sum.appendChild(summaryItem(kind, r.date || NO_DATE, r.nDates > 1 ? "hl" : ""));
    sum.appendChild(summaryItem("Flux", fmtInt.format(r.nFlux)));
    sum.appendChild(summaryItem("Items", fmtInt.format(r.items)));
    sum.appendChild(summaryItem("TTC", money(r.ttc)));
    sum.appendChild(summaryItem("TVA", money(r.tva)));
    sum.appendChild(summaryItem("HT", money(r.ht)));
    sum.appendChild(summaryItem("Refunds", fmtInt.format(r.refN) + " (" + money(r.refTtc) + ")"));
    sum.appendChild(summaryItem("Net TTC", money(r.net)));
    sum.appendChild(summaryItem("Contrôle", cellText(COLS[COLS.length - 1], r), r.check.state === "ko" ? "red" : ""));

    if (!viewer) {
      viewer = window.XmlViewer.create($("editor"), {
        onClose: closeViewer,
        onCursor(info) {
          $("statusPath").textContent = info.path.join(" › ");
          $("statusPos").textContent = "Ligne " + fmtInt.format(info.line) + " sur " + fmtInt.format(info.lines) + ", colonne " + info.col;
        },
      });
    }
    viewer.open("", {});                       // on n'affiche pas le fichier précédent pendant la lecture
    $("statusPath").textContent = "Lecture du fichier…";
    $("statusPos").textContent = "";
    $("statusNote").textContent = "";
    try {
      let text = decode(await bytesOf(r.entry));
      if (state.open !== r) return;
      const reindented = needsIndent(text);
      if (reindented) text = indentXml(text);
      $("statusNote").textContent = reindented ? "Fichier sans retours à la ligne : affichage réindenté" : "";
      viewer.open(text, { previewTags: PREVIEW_TAGS, foldNames: [REC, REF] });

      // Navigation entre les enregistrements de la date de la ligne (utile si plusieurs dates).
      const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      dateHits = r.nDates > 1 && r.date
        ? viewer.findAll(new RegExp("<" + DATE_TAG + ">\\s*" + escRe(r.date) + "\\s*</" + DATE_TAG + ">", "g"))
        : [];
      const showNav = dateHits.length > 0;
      $("vDateNav").hidden = !showNav; $("vDateSep").hidden = !showNav;
      if (showNav) $("vDateLabel").textContent = plural(dateHits.length, "enregistrement du ", "enregistrements du ") + r.date;
      viewer.focus();
    } catch (err) {
      $("statusPath").textContent = "Lecture impossible : " + errText(err);
    }
  }

  // Un fichier livré sur une seule ligne est illisible et non repliable :
  // on le réindente pour l'affichage uniquement (le fichier n'est jamais modifié).
  function needsIndent(text) {
    if (text.length < 500) return false;
    let lines = 1;
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) lines++;
    return text.length / lines > 500;
  }
  function indentXml(text) {
    const tokens = text.trim().replace(/>\s*</g, ">\n<").split("\n");
    const out = [];
    let depth = 0;
    for (let i = 0; i < tokens.length; i++) {
      let t = tokens[i];
      const open = /^<([^\s>\/?!]+)[^>]*[^\/]?>$/.exec(t);
      const openOnly = open && !/\/>$/.test(t) && t.indexOf("</") === -1;
      if (openOnly && tokens[i + 1] === "</" + open[1] + ">") { t += tokens[++i]; out.push("    ".repeat(depth) + t); continue; }
      if (/^<\//.test(t)) depth = Math.max(0, depth - 1);
      out.push("    ".repeat(depth) + t);
      if (openOnly) depth++;
    }
    return out.join("\n");
  }

  function closeViewer() {
    if ($("viewer").hidden) return;
    state.open = null;
    $("viewer").hidden = true;
    $("list").hidden = false;
    $("tableWrap").scrollTop = savedScroll;
    select(state.sel, true);
    $("tableWrap").focus();
  }

  function dateStep(dir) {
    if (!dateHits.length) return;
    const pos = viewer.cursor();
    let i;
    if (dir > 0) { i = dateHits.findIndex((h) => h.from > pos); if (i < 0) i = 0; }
    else { i = -1; for (let k = dateHits.length - 1; k >= 0; k--) if (dateHits[k].to < pos) { i = k; break; } if (i < 0) i = dateHits.length - 1; }
    viewer.jump(dateHits[i].from, dateHits[i].to);
  }

  // ---- Synthèse par client et graphes par jour ----------------------------
  const SCOLS = [
    { key: "label", label: "Client", type: "text" },
    { key: "files", label: "Fichiers", type: "int", title: "Un fichier à plusieurs clients compte une fois par client" },
    { key: "days", label: "Jours", type: "int", title: "Dates distinctes, dispense ou refund" },
    { key: "nFlux", label: "Flux", type: "int" },
    { key: "ht", label: "HT", type: "money", title: "HT des dispenses : TTC − TVA" },
    { key: "tva", label: "TVA", type: "money" },
    { key: "ttc", label: "TTC", type: "money" },
    { key: "refN", label: "Refunds", type: "int" },
    { key: "refHt", label: "Refunds HT", type: "money", title: "HT des refunds : TTC − TVA" },
    { key: "refTtc", label: "Refunds TTC", type: "money" },
    { key: "netHt", label: "Net HT", type: "money", title: "HT − Refunds HT" },
  ];
  const SERIES = [
    { id: "d", label: "Dispense", cls: "s1" },
    { id: "r", label: "Refund", cls: "s2" },
  ];
  // Un seul graphe : les montants en barres (axe de gauche), les volumes en courbes (axe de droite).
  const MEASURES = [
    { mark: "line", short: "Nombre", axis: "Nombre", keys: { d: "dN", r: "rN" }, fmtTick: (v) => fmtInt.format(v), fmtValue: (v) => fmtInt.format(v) },
    { mark: "bar", short: "Valeur HT", axis: "Valeur HT (€)", keys: { d: "dHT", r: "rHT" }, fmtTick: (v) => fmtTick.format(v), fmtValue: (v) => fmtDec.format(v) },
  ];
  const synth = { rows: [], sel: 0 };

  // Porte sur tous les clients des fichiers chargés, dans la période sélectionnée au tableau.
  function buildSynth() {
    const mk = (key, label) => ({ key, label, units: new Set(), byDay: new Map(), nFlux: 0, ht: 0, tva: 0, ttc: 0, refN: 0, refHt: 0, refTtc: 0 });
    const all = mk(null, "Tous les clients");
    const map = new Map();
    for (const f of state.files) {
      for (const u of f.res.units) {
        let c = map.get(u.key);
        if (!c) { c = mk(u.key, u.label); map.set(u.key, c); }
        for (const t of [c, all]) {
          u.dates.forEach((a, d) => {
            if (!inRange(d)) return;
            t.units.add(f.entry.path + "\u0001" + u.key);
            let day = t.byDay.get(d);
            if (!day) { day = { date: d, dN: 0, dHT: 0, rN: 0, rHT: 0 }; t.byDay.set(d, day); }
            const n = a.inv.size + a.noId, ht = a.ttc - a.tva, rht = a.refTtc - a.refTva;
            day.dN += n; day.dHT += ht; day.rN += a.refN; day.rHT += rht;
            t.nFlux += n; t.ht += ht; t.tva += a.tva; t.ttc += a.ttc;
            t.refN += a.refN; t.refHt += rht; t.refTtc += a.refTtc;
          });
        }
      }
    }
    const rows = [all, ...[...map.values()].filter((c) => c.units.size).sort((a, b) => cmpText(a.label, b.label))];
    for (const r of rows) { r.files = r.units.size; r.days = r.byDay.size; r.netHt = r.ht - r.refHt; }
    synth.rows = rows;
  }

  function fmtDay(date, short) {
    if (!date) return NO_DATE;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    return short && m ? m[3] + "/" + m[2] : date;
  }

  function renderSynthScreen() {
    const trh = el("tr");
    for (const c of SCOLS) {
      const th = el("th", "t-" + c.type, c.label);
      th.scope = "col";
      if (c.title) th.title = c.title;
      trh.appendChild(th);
    }
    $("sHead").replaceChildren(trh);
    const frag = document.createDocumentFragment();
    synth.rows.forEach((r, i) => {
      const tr = el("tr", i === 0 ? "all" : "");
      tr.dataset.i = i;
      for (const c of SCOLS) {
        const v = r[c.key];
        const td = el("td", "t-" + c.type, c.type === "int" ? fmtInt.format(v) : c.type === "money" ? money(v) : v);
        if (c.type !== "text" && v === 0) td.classList.add("zero");
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    });
    $("sBody").replaceChildren(frag);
    selectSynth(synth.sel, false);
  }

  function selectSynth(i, scroll) {
    const body = $("sBody");
    const old = body.querySelector("tr.sel");
    if (old) old.classList.remove("sel");
    synth.sel = Math.max(0, Math.min(synth.rows.length - 1, i));
    const tr = body.children[synth.sel];
    if (!tr) return;
    tr.classList.add("sel");
    if (scroll) reveal(tr, $("sTableWrap"));

    const r = synth.rows[synth.sel];
    const days = [...r.byDay.values()].sort((a, b) => cmpText(a.date, b.date))
      .map((d) => ({ date: d.date, dN: d.dN, dHT: d.dHT / 100, rN: d.rN, rHT: d.rHT / 100 }));
    const dated = days.filter((d) => d.date);
    const span = !dated.length ? "" : dated.length === 1 ? ", le " + dated[0].date : ", du " + dated[0].date + " au " + dated[dated.length - 1].date;
    $("vizCaption").textContent = "Par jour : " + r.label + span;
    const slug = r.label.normalize("NFD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "client";
    window.DayCharts.render($("viz"), {
      days, measures: MEASURES, series: SERIES, fmtDate: fmtDay,
      title: $("vizCaption").textContent,
      fileName: "graphe-" + slug + ".png",
      onExport: (err) => toast(err ? "Export impossible : " + errText(err) : "Image enregistrée dans vos téléchargements."),
    });
  }

  function openSynth() {
    if (!state.files.length) return;
    savedScroll = $("tableWrap").scrollTop;
    buildSynth();
    const i = state.client === null ? 0 : synth.rows.findIndex((r) => r.key === state.client);
    synth.sel = i < 0 ? 0 : i;
    $("sScope").textContent = plural(synth.rows[0].files, "fichier", "fichiers") + ", " + rangeText();
    $("list").hidden = true;
    $("synthScreen").hidden = false;
    renderSynthScreen();
    $("sTableWrap").focus();
  }

  function closeSynth(clientKeyToShow) {
    if ($("synthScreen").hidden) return;
    $("synthScreen").hidden = true;
    $("list").hidden = false;
    if (clientKeyToShow !== undefined) {
      $("selClient").value = clientKeyToShow === null ? "" : "v:" + clientKeyToShow;
      applySelection();
      $("tableWrap").focus();
      return;
    }
    $("tableWrap").scrollTop = savedScroll;
    select(state.sel, true);
    $("tableWrap").focus();
  }

  // ---- Export CSV ---------------------------------------------------------
  function exportCsv() {
    const num = (v, dec) => (dec ? v.toFixed(2) : String(v)).replace(".", ",");
    const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const val = (c, r) => {
      switch (c.type) {
        case "int": return num(r[c.key], false);
        case "money": return num(r[c.key] / 100, true);
        case "check": return q(r.check.state === "ok" ? "OK" : r.check.details.join(" | "));
        default: return q(r[c.key]);
      }
    };
    const lines = [COLS.map((c) => q(c.label)).join(";")];
    for (const r of state.view) lines.push(COLS.map((c) => val(c, r)).join(";"));
    const blob = new Blob(["\ufeff" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    a.href = URL.createObjectURL(blob);
    a.download = "stats-reconciliation-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---- Noms des fichiers affichés, vers le presse-papiers --------------------
  // Un nom par fichier présent dans le tableau (sélections et filtre appliqués), séparés par des virgules.
  async function copyNames() {
    const names = [];
    const seen = new Set();
    for (const r of state.view) {
      if (seen.has(r.path)) continue;
      seen.add(r.path);
      names.push(r.path.split("/").pop());
    }
    if (!names.length) { toast("Aucun fichier affiché."); return; }
    const text = names.join(",");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else throw new Error("presse-papiers indisponible");
    } catch (e) {
      // Repli pour les navigateurs sans accès direct au presse-papiers.
      const ta = el("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) { toast("Copie impossible : presse-papiers refusé par le navigateur."); return; }
    }
    toast(plural(names.length, "nom de fichier copié", "noms de fichier copiés") + " dans le presse-papiers.");
  }

  // ---- Messages -----------------------------------------------------------
  let toastTimer = 0;
  function toast(msg, action) {
    $("toastText").textContent = msg;
    const b = $("toastAction");
    b.hidden = !action;
    if (action) { b.textContent = action.label; b.onclick = () => { $("toast").hidden = true; action.run(); }; }
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("toast").hidden = true; }, action ? 20000 : 6000);
  }

  // ---- Version et mise à jour ---------------------------------------------
  const online = /^https?:$/.test(location.protocol) && "serviceWorker" in navigator;

  function showVersion(updateReady) {
    const b = $("version");
    b.textContent = "v" + APP_VERSION + (updateReady ? " · mise à jour prête" : "");
    b.classList.toggle("has-update", !!updateReady);
  }

  async function checkUpdate() {
    if (!online) { toast("Version v" + APP_VERSION + ". La vérification des mises à jour n'est possible que depuis l'application en ligne."); return; }
    toast("Vérification de la version…");
    let remote;
    try {
      const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      remote = String((await r.json()).version);
    } catch (e) {
      toast("Vérification impossible : serveur injoignable. Version installée : v" + APP_VERSION + ".");
      return;
    }
    if (cmpText(remote, APP_VERSION) > 0) {
      toast("La version v" + remote + " est disponible (installée : v" + APP_VERSION + ").", { label: "Installer v" + remote, run: applyUpdate });
    } else {
      toast("Vous avez la dernière version (v" + APP_VERSION + ").");
    }
  }

  // Télécharge la nouvelle version, l'active, puis recharge la page.
  async function applyUpdate() {
    toast("Installation de la mise à jour…");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) { location.reload(); return; }
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
      await reg.update();
      const sw = reg.waiting || reg.installing;
      if (!sw) { location.reload(); return; }
      const activate = () => { if (sw.state === "installed") sw.postMessage("SKIP_WAITING"); };
      sw.addEventListener("statechange", activate);
      activate();
    } catch (e) {
      toast("Mise à jour impossible : " + errText(e));
    }
  }

  function registerServiceWorker() {
    if (!online) return;
    navigator.serviceWorker.register("sw.js").then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) showVersion(true);
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) showVersion(true);
        });
      });
    }).catch(() => { /* hors ligne non disponible, l'application fonctionne quand même */ });
  }

  // ---- Événements ---------------------------------------------------------
  $("pick").addEventListener("click", pick);
  $("pickArchive").addEventListener("click", () => { $("archiveInput").value = ""; $("archiveInput").click(); });
  for (const id of ["dirInput", "archiveInput"]) {
    $(id).addEventListener("change", async (e) => {
      if (!e.target.files.length) return;
      state.source = entriesFromInput(e.target.files);
      $("refresh").hidden = true;
      await load();
    });
  }
  $("refresh").addEventListener("click", async () => {
    if (state.source && state.source.handle) await setHandle(state.source.handle);
  });
  $("recursive").addEventListener("change", load);
  $("csv").addEventListener("click", exportCsv);
  $("openSynth").addEventListener("click", openSynth);
  $("version").addEventListener("click", checkUpdate);
  const selectAndFocus = () => { applySelection(); $("tableWrap").focus(); };
  $("selClient").addEventListener("change", selectAndFocus);
  // Un mois choisi dans la liste remplit les deux bornes avec son premier et son dernier jour.
  $("selMonth").addEventListener("change", (e) => {
    const b = e.target.value ? monthBounds(e.target.value) : ["", ""];
    $("dateMin").value = b[0]; $("dateMax").value = b[1];
    selectAndFocus();
  });
  // Les bornes s'appliquent pendant la saisie, sans quitter le champ.
  $("dateMin").addEventListener("change", applySelection);
  $("dateMax").addEventListener("change", applySelection);
  $("selClear").addEventListener("click", () => {
    $("selClient").value = ""; $("dateMin").value = ""; $("dateMax").value = "";
    selectAndFocus();
  });
  $("copyNames").addEventListener("click", copyNames);
  $("shortNames").addEventListener("change", (e) => {
    state.short = e.target.checked;
    pref("shortNames", state.short ? "1" : "0");
    $("list").classList.toggle("short", state.short);
    render();
    if (state.view.length) $("tableWrap").focus();
  });
  $("filter").addEventListener("input", (e) => { state.filter = e.target.value; state.sel = 0; render(); });
  $("filter").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); $("tableWrap").focus(); select(state.sel, true); }
    else if (e.key === "Escape" && !e.target.value) $("tableWrap").focus();
  });

  $("tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    select(Number(tr.dataset.i), false);
    openRow(state.view[state.sel]);
  });

  document.addEventListener("keydown", (e) => {
    const tag = e.target.tagName;
    // On laisse la frappe aux champs de saisie ; une case à cocher ne bloque pas les raccourcis.
    if (tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && e.target.type !== "checkbox")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Visionneuse : Échap revient au tableau, même pendant la lecture du fichier.
    // Dans l'éditeur, c'est lui qui traite la touche (fermeture de la recherche, puis retour).
    if (!$("viewer").hidden) {
      if (e.key === "Escape" && !e.defaultPrevented && !e.target.closest(".cm-editor")) { e.preventDefault(); closeViewer(); }
      return;
    }

    // Écran de synthèse
    if (!$("synthScreen").hidden) {
      if (e.key === "Escape") { e.preventDefault(); closeSynth(); return; }
      if (tag === "BUTTON" && (e.key === "Enter" || e.key === " ")) return;   // le bouton garde son action
      let i = synth.sel;
      switch (e.key) {
        case "ArrowDown": i++; break;
        case "ArrowUp": i--; break;
        case "Home": i = 0; break;
        case "End": i = synth.rows.length - 1; break;
        case "Enter": e.preventDefault(); closeSynth(synth.rows[synth.sel].key); return;
        default: return;
      }
      e.preventDefault();
      selectSynth(i, true);
      return;
    }

    // Tableau principal
    if ($("list").hidden || !state.files.length) return;
    const inWrap = e.target === $("tableWrap") || e.target === document.body;
    if (e.key === "/") { e.preventDefault(); $("filter").focus(); $("filter").select(); return; }
    if (e.key === "c" || e.key === "C") { e.preventDefault(); $("selClient").focus(); return; }
    if (e.key === "d" || e.key === "D") { e.preventDefault(); $("dateMin").focus(); return; }
    if (e.key === "s" || e.key === "S") { e.preventDefault(); openSynth(); return; }
    if (!inWrap || !state.view.length) return;
    let i = state.sel;
    switch (e.key) {
      case "ArrowDown": i++; break;
      case "ArrowUp": i--; break;
      case "PageDown": i += pageSize(); break;
      case "PageUp": i -= pageSize(); break;
      case "Home": i = 0; break;
      case "End": i = state.view.length - 1; break;
      case "Enter": e.preventDefault(); openRow(state.view[state.sel]); return;
      default: return;
    }
    e.preventDefault();
    select(i, true);
  });

  $("sBack").addEventListener("click", () => closeSynth());
  $("sBody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    selectSynth(Number(tr.dataset.i), false);
    $("sTableWrap").focus();
  });

  $("vBack").addEventListener("click", closeViewer);
  $("vSearch").addEventListener("click", () => viewer && viewer.openSearch());
  $("vFoldRec").addEventListener("click", () => { viewer.foldNames([REC, REF]); viewer.focus(); });
  $("vUnfold").addEventListener("click", () => { viewer.unfoldAll(); viewer.focus(); });
  $("vPrev").addEventListener("click", () => dateStep(-1));
  $("vNext").addEventListener("click", () => dateStep(1));
  for (let n = 1; n <= 5; n++) {
    const b = el("button", "lvl", String(n));
    b.type = "button"; b.title = "Replier les éléments de niveau " + n;
    b.addEventListener("click", () => { viewer.foldDepth(n); viewer.focus(); });
    $("vLevels").appendChild(b);
  }

  // Glisser-déposer d'un répertoire ou d'archives
  let dragDepth = 0;
  document.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; document.body.classList.add("dragging"); });
  document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("dragging"); } });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    dragDepth = 0; document.body.classList.remove("dragging");
    if ($("list").hidden) return;
    const items = e.dataTransfer && e.dataTransfer.items ? [...e.dataTransfer.items] : [];
    const roots = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
    if (!roots.length) return;
    try {
      state.source = await entriesFromDrop(roots);
      $("refresh").hidden = true;
      await load();
    } catch (err) {
      toast("Lecture impossible : " + errText(err));
    }
  });

  // ---- Démarrage ----------------------------------------------------------
  state.short = pref("shortNames") === "1";
  $("shortNames").checked = state.short;
  $("list").classList.toggle("short", state.short);
  showVersion(false);
  registerServiceWorker();
})();
