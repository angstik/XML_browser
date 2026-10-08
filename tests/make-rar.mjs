// Fabrique une archive RAR5 minimale (fichiers stockés sans compression) pour les tests.
// Format : https://www.rarlab.com/technote.htm
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function vint(n) {
  const out = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 0x80; out.push(b); } while (n > 0);
  return out;
}
const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
function header(body) {
  const sized = [...vint(body.length), ...body];
  return [...u32(crc32(Uint8Array.from(sized))), ...sized];
}

/** @param {{name: string, data: Uint8Array}[]} files */
export function makeRar(files) {
  const parts = [[0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]];
  parts.push(header([...vint(1), ...vint(0), ...vint(0)]));            // en-tête d'archive
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    parts.push(header([
      ...vint(2), ...vint(0x02), ...vint(f.data.length),               // en-tête de fichier, zone de données présente
      ...vint(0x04), ...vint(f.data.length), ...vint(0x20),            // CRC présent, taille, attributs
      ...u32(crc32(f.data)),
      ...vint(0), ...vint(0),                                          // méthode 0 (stocké), hôte Windows
      ...vint(name.length), ...name,
    ]));
    parts.push(f.data);
  }
  parts.push(header([...vint(5), ...vint(0), ...vint(0)]));            // fin d'archive
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
