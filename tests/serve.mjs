// Petit serveur statique pour dist/ : npm run serve, puis http://localhost:8080/
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".wasm": "application/wasm",
  ".png": "image/png", ".svg": "image/svg+xml",
};

export function startServer(root, port = 0) {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (path.endsWith("/")) path += "index.html";
      const file = join(root, normalize(path).replace(/^(\.\.[\\/])+/, ""));
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "max-age=600" });
      res.end(body);
    } catch (e) {
      res.writeHead(404); res.end("introuvable");
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, url: "http://127.0.0.1:" + server.address().port + "/" })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startServer(new URL("../dist/", import.meta.url).pathname, 8080);
  console.log("XML Browser servi sur " + url.replace("127.0.0.1", "localhost"));
}
