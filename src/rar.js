// Lecture d'archives RAR dans le navigateur.
// node-unrar-js : le code unrar officiel compilé en WebAssembly (extraction seule).
// Chargé à la demande, uniquement quand une archive RAR est rencontrée.
import { createExtractorFromData } from "node-unrar-js";

let wasmPromise = null;
function wasm() {
  if (!wasmPromise) {
    wasmPromise = fetch("unrar.wasm")
      .then((r) => {
        if (!r.ok) throw new Error("unrar.wasm introuvable (" + r.status + ")");
        return r.arrayBuffer();
      })
      .catch((e) => { wasmPromise = null; throw e; });
  }
  return wasmPromise;
}

async function open(buffer) {
  return createExtractorFromData({ data: buffer, wasmBinary: await wasm() });
}

// L'extracteur garde chaque fichier extrait en mémoire : on le libère dès qu'il a été traité.
function release(extractor, rawName) {
  try { delete extractor.dataFiles["*Extracted*/" + rawName]; } catch (e) { /* détail interne, sans conséquence */ }
}

window.RarReader = {
  // Signature « Rar!\x1a\x07 » (RAR 4 et RAR 5).
  isRar(b) {
    return b.length >= 6 && b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21 && b[4] === 0x1a && b[5] === 0x07;
  },

  // Parcourt l'archive dans l'ordre et appelle onFile pour chaque fichier (hors dossiers).
  async each(buffer, onFile) {
    const extractor = await open(buffer);
    const { files } = extractor.extract();
    for (const f of files) {
      const h = f.fileHeader;
      if (h.flags.directory) continue;
      const bytes = f.extraction || null;
      release(extractor, h.name);
      await onFile({ name: h.name.replace(/\\/g, "/"), rawName: h.name, size: h.unpSize, bytes });
    }
  },

  // Extrait un seul fichier, par son nom tel qu'il figure dans l'archive.
  async one(buffer, rawName) {
    const extractor = await open(buffer);
    const { files } = extractor.extract({ files: [rawName] });
    for (const f of files) if (f.extraction) return f.extraction;
    throw new Error("fichier absent de l'archive");
  },
};
