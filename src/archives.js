// Lecture des archives ZIP, TAR et GZIP (dont .tar.gz), sans bibliothèque :
// le format est décodé ici, la décompression est celle du navigateur (DecompressionStream).
// Exposé en global : window.Archives = { zip, tar, gz, isTar }
// Chaque lecteur offre each(buffer, onFile, archiveName) et one(buffer, rawName).
(function () {
  "use strict";

  const utf8 = new TextDecoder("utf-8");
  const latin1 = new TextDecoder("latin1");

  async function inflate(bytes, format) {
    if (typeof DecompressionStream !== "function") throw new Error("ce navigateur ne sait pas décompresser ce format");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // ---- ZIP ----------------------------------------------------------------
  const u64 = (view, o) => Number(view.getBigUint64(o, true));

  // Lit le répertoire central : la liste fiable des fichiers de l'archive.
  function zipEntries(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22, min = Math.max(0, bytes.length - 65557); i >= min; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("fin d'archive ZIP introuvable");
    let count = view.getUint16(eocd + 10, true);
    let cdOffset = view.getUint32(eocd + 16, true);
    // ZIP64 : les vraies valeurs sont dans l'enregistrement de fin étendu.
    if ((count === 0xffff || cdOffset === 0xffffffff) && eocd >= 20 && view.getUint32(eocd - 20, true) === 0x07064b50) {
      const z = u64(view, eocd - 20 + 8);
      if (view.getUint32(z, true) !== 0x06064b50) throw new Error("archive ZIP64 illisible");
      count = u64(view, z + 32);
      cdOffset = u64(view, z + 48);
    }
    const entries = [];
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
      if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new Error("répertoire central ZIP endommagé");
      const flags = view.getUint16(p + 8, true);
      const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
      const e = {
        flags, method: view.getUint16(p + 10, true), crc: view.getUint32(p + 16, true),
        compSize: view.getUint32(p + 20, true), size: view.getUint32(p + 24, true),
        offset: view.getUint32(p + 42, true),
      };
      const rawName = bytes.subarray(p + 46, p + 46 + nameLen);
      e.name = (flags & 0x800 ? utf8 : latin1).decode(rawName);
      // Champ supplémentaire ZIP64 : tailles et position sur 64 bits.
      for (let x = p + 46 + nameLen, end = x + extraLen; x + 4 <= end;) {
        const id = view.getUint16(x, true), len = view.getUint16(x + 2, true);
        if (id === 0x0001) {
          let q = x + 4;
          if (e.size === 0xffffffff) { e.size = u64(view, q); q += 8; }
          if (e.compSize === 0xffffffff) { e.compSize = u64(view, q); q += 8; }
          if (e.offset === 0xffffffff) e.offset = u64(view, q);
        }
        x += 4 + len;
      }
      entries.push(e);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function zipData(buffer, e) {
    if (e.flags & 1) throw new Error("fichier chiffré");
    const view = new DataView(buffer);
    if (view.getUint32(e.offset, true) !== 0x04034b50) throw new Error("en-tête local ZIP endommagé");
    const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
    const packed = new Uint8Array(buffer, start, e.compSize);
    let data;
    if (e.method === 0) data = packed;
    else if (e.method === 8) data = await inflate(packed, "deflate-raw");
    else throw new Error("méthode de compression ZIP non gérée (" + e.method + ")");
    if (crc32(data) !== e.crc) throw new Error("contenu endommagé (contrôle CRC)");
    return data;
  }

  const zip = {
    async each(buffer, onFile) {
      for (const e of zipEntries(buffer)) {
        if (e.name.endsWith("/")) continue;                       // dossier
        let bytes = null, error = null;
        try { bytes = await zipData(buffer, e); } catch (err) { error = err; }
        await onFile({ name: e.name.replace(/\\/g, "/"), rawName: e.name, size: e.size, bytes, error });
      }
    },
    async one(buffer, rawName) {
      const e = zipEntries(buffer).find((x) => x.name === rawName);
      if (!e) throw new Error("fichier absent de l'archive");
      return zipData(buffer, e);
    },
  };

  // ---- TAR ----------------------------------------------------------------
  const field = (h, o, n) => { let end = o; while (end < o + n && h[end] !== 0) end++; return utf8.decode(h.subarray(o, end)); };
  function tarNumber(h, o, n) {
    if (h[o] & 0x80) {                                            // extension GNU : nombre binaire
      let v = 0;
      for (let i = o + 1; i < o + n; i++) v = v * 256 + h[i];
      return v;
    }
    const s = field(h, o, n).trim();
    return s ? parseInt(s, 8) : 0;
  }
  // Un bloc d'en-tête TAR se reconnaît à sa somme de contrôle.
  function isTar(head) {
    if (head.length < 512) return false;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : head[i];
    const stored = parseInt(field(head, 148, 8).trim(), 8);
    return sum !== 256 && stored === sum;                         // 256 = bloc entièrement vide
  }

  function* tarEntries(bytes) {
    let off = 0, longName = null, paxPath = null;
    while (off + 512 <= bytes.length) {
      const h = bytes.subarray(off, off + 512);
      if (!isTar(h)) break;                                       // blocs de fin (zéros) ou données invalides
      const size = tarNumber(h, 124, 12);
      const type = h[156] === 0 ? "0" : String.fromCharCode(h[156]);
      const start = off + 512;
      const data = bytes.subarray(start, start + size);
      off = start + Math.ceil(size / 512) * 512;
      if (type === "L") { longName = utf8.decode(data).replace(/\0+$/, ""); continue; }   // nom long GNU
      if (type === "x") {                                                                 // en-tête pax
        const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(utf8.decode(data));
        paxPath = m ? m[1] : null;
        continue;
      }
      if (type === "g") continue;
      const prefix = field(h, 257, 5) === "ustar" ? field(h, 345, 155) : "";
      const base = field(h, 0, 100);
      const name = paxPath || longName || (prefix ? prefix + "/" + base : base);
      longName = paxPath = null;
      if (type !== "0" && type !== "7") continue;                 // dossiers, liens, périphériques
      yield { name, bytes: data.length === size ? data : null, size };
    }
  }

  const tar = {
    async each(buffer, onFile) {
      for (const e of tarEntries(new Uint8Array(buffer))) {
        await onFile({ name: e.name.replace(/^\.\//, ""), rawName: e.name, size: e.size, bytes: e.bytes, error: e.bytes ? null : new Error("archive tronquée") });
      }
    },
    async one(buffer, rawName) {
      for (const e of tarEntries(new Uint8Array(buffer))) {
        if (e.name === rawName) { if (e.bytes) return e.bytes; break; }
      }
      throw new Error("fichier absent de l'archive");
    },
  };

  // ---- GZIP : une archive TAR compressée, ou un fichier seul ---------------
  const gz = {
    async each(buffer, onFile, archiveName) {
      const data = await inflate(new Uint8Array(buffer), "gzip");
      if (isTar(data.subarray(0, 512))) return tar.each(data.buffer, onFile);
      const inner = (archiveName || "contenu").replace(/\.gz$/i, "");
      await onFile({ name: inner, rawName: "", size: data.length, bytes: data, error: null });
    },
    async one(buffer, rawName) {
      const data = await inflate(new Uint8Array(buffer), "gzip");
      return rawName === "" ? data : tar.one(data.buffer, rawName);
    },
  };

  window.Archives = { zip, tar, gz, isTar };
})();
