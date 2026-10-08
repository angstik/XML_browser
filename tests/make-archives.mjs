// Fabrique des archives ZIP et TAR minimales pour les tests.
import { deflateRawSync, crc32 } from "node:zlib";

const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** ZIP : fichiers compressés (deflate), ou stockés si `store`. @param {{name: string, data: Uint8Array}[]} files */
export function makeZip(files, { store = false } = {}) {
  const local = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    const packed = store ? f.data : new Uint8Array(deflateRawSync(f.data));
    const common = [...u16(20), ...u16(0x0800), ...u16(store ? 0 : 8), ...u16(0), ...u16(0x21),
      ...u32(crc32(f.data)), ...u32(packed.length), ...u32(f.data.length), ...u16(name.length), ...u16(0)];
    const head = Uint8Array.from([...u32(0x04034b50), ...common, ...name]);
    local.push(head, packed);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
    offset += head.length + packed.length;
  }
  const cd = concat(central);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cd.length), ...u32(offset), ...u16(0)]);
  return concat([...local, cd, end]);
}

/** TAR au format ustar. @param {{name: string, data: Uint8Array}[]} files */
export function makeTar(files) {
  const blocks = [];
  for (const f of files) {
    const h = new Uint8Array(512);
    const put = (text, at) => h.set(new TextEncoder().encode(text), at);
    put(f.name, 0);
    put("0000644\0", 100); put("0000000\0", 108); put("0000000\0", 116);
    put(f.data.length.toString(8).padStart(11, "0") + "\0", 124);
    put("00000000000\0", 136);
    put("        ", 148);                       // somme de contrôle : espaces pendant le calcul
    h[156] = 48;                                // fichier ordinaire
    put("ustar\0" + "00", 257);
    const sum = h.reduce((a, b) => a + b, 0);
    put(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    const body = new Uint8Array(Math.ceil(f.data.length / 512) * 512);
    body.set(f.data);
    blocks.push(h, body);
  }
  blocks.push(new Uint8Array(1024));            // deux blocs vides de fin
  return concat(blocks);
}
