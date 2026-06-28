// Hand-rolled service worker for the Bridge PWA app shell.
// - Precache the shell (index.html + static public assets) on install.
// - Runtime-cache built assets (hashed JS/CSS) on first fetch.
// - Network-first for navigations, falling back to cached index.html offline.
// - NEVER touch /api or /ws requests (the app is online-only for data).

const CACHE = "bridge-shell-v1";

const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache data/socket endpoints.
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/ws")) return;

  // Navigations: network-first, fall back to cached app shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("/index.html", copy));
          return res;
        })
        .catch(() =>
          caches
            .match("/index.html")
            .then((cached) => cached || caches.match("/"))
        )
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
