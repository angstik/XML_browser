// Service worker : met l'application en cache pour un fonctionnement hors ligne.
// La version et la liste des fichiers ci-dessous sont renseignées par build.mjs.
const VERSION = "__VERSION__";
const PREFIX = "xml-browser-v";
const CACHE = PREFIX + VERSION;
const ASSETS = __ASSETS__;

self.addEventListener("install", (event) => {
  // cache: "reload" contourne le cache HTTP pour prendre les fichiers de cette version.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// La page demande l'activation d'une nouvelle version quand l'utilisateur clique « Installer ».
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // version.json sert à détecter une mise à jour : toujours le réseau, jamais le cache.
  if (url.pathname.endsWith("/version.json")) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req))
  );
});
