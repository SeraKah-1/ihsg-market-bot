/* IHSG Market Bot — PWA shell offline */
const CACHE_VERSION = "ihsg-shell-v2";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/js/app.js",
  "/js/state.js",
  "/js/config.js",
  "/js/firebase.js",
  "/js/agent-memory.js",
  "/js/offline-store.js",
  "/js/storage-store.js",
  "/js/storage-ui.js",
  "/js/ai.js",
  "/js/orchestrate.js",
  "/js/render-report.js",
  "/js/report-theme.js",
  "/js/indicators-pack.js",
  "/js/metric-gloss.js",
  "/js/sanitize.js",
  "/js/universe-browser.js",
  "/js/thinking-config.js",
  "/js/rate-limiter.js",
  "/js/agents/constitution.js",
  "/js/agents/researcher.js",
  "/js/agents/analysis.js",
  "/js/agents/writer.js",
  "/js/agents/deep-dive.js",
  "/js/agents/stance-rules.js",
  "/js/search/capability.js",
  "/js/search/native-search.js",
  "/js/search/reasoning.js",
  "/js/search/agentic-web.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        Promise.all(
          SHELL.map((url) =>
            cache.add(url).catch((err) => {
              console.warn("SW cache skip", url, err);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isNavigation(req) {
  return (
    req.mode === "navigate" ||
    (req.method === "GET" && req.headers.get("accept")?.includes("text/html"))
  );
}

function isSameOriginAsset(url) {
  return url.origin === self.location.origin;
}

function isNetworkOnly(url) {
  const h = url.hostname || "";
  return (
    h.includes("googleapis.com") ||
    h.includes("firebaseio.com") ||
    h.includes("firebase") ||
    h.includes("gstatic.com") ||
    h.includes("jina.ai") ||
    url.pathname.startsWith("/api/") ||
    url.port === "8081" ||
    url.port === "20128"
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  if (isNetworkOnly(url)) return;

  if (
    isSameOriginAsset(url) &&
    (isNavigation(req) ||
      url.pathname.startsWith("/js/") ||
      url.pathname.endsWith(".css") ||
      SHELL.includes(url.pathname))
  ) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) {
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          if (isNavigation(req)) {
            const shell = await caches.match("/index.html");
            if (shell) return shell;
          }
          return new Response("Offline — buka ulang saat online untuk update shell.", {
            status: 503,
            statusText: "Offline",
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          });
        })
    );
  }
});
