const express = require("express");
const cors_proxy = require("cors-anywhere");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { isAllowedProxyTarget, normalizeProxyTarget } = require("./api/proxy-allowlist.js");
const marketApi = require("./lib/market-api.js");

const FRONTEND_PORT = process.env.PORT || 3010;
const PROXY_PORT = process.env.PROXY_PORT || 8081;

const proxyServer = cors_proxy.createServer({
  originWhitelist: [],
  requireHeader: [],
  removeHeaders: ["cookie", "cookie2"],
  httpProxyOptions: { secure: false }
});

function extractCorsAnywhereTarget(reqUrl) {
  const raw = reqUrl || "/";
  const q = raw.match(/[?&]url=([^&]+)/);
  if (q) {
    try {
      return decodeURIComponent(q[1]);
    } catch {
      return q[1];
    }
  }
  return raw.replace(/^\/+/, "");
}

function handleAllowlistedProxy(req, res) {
  const rawTarget = extractCorsAnywhereTarget(req.url);
  const normalized = normalizeProxyTarget(rawTarget);
  if (!normalized) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid target URL" }));
    return;
  }
  if (!isAllowedProxyTarget(normalized)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Target host is not on the proxy allowlist",
        host: (() => {
          try {
            return new URL(normalized).hostname;
          } catch {
            return null;
          }
        })()
      })
    );
    return;
  }
  req.url = "/" + normalized;
  proxyServer.emit("request", req, res);
}

module.exports = {
  handleAllowlistedProxy,
  extractCorsAnywhereTarget,
  PROXY_PORT,
  FRONTEND_PORT
};

if (require.main === module) {
  const nakedProxy = http.createServer(handleAllowlistedProxy);
  nakedProxy.on("error", (err) => {
    console.warn(`[CORS Proxy] skip :${PROXY_PORT} — ${err.code || err.message}`);
  });
  nakedProxy.listen(PROXY_PORT, "0.0.0.0", () => {
    console.log(`[CORS Proxy] http://localhost:${PROXY_PORT}`);
  });

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  function extractProxyTarget(req) {
    const fromPath = (req.url || "").replace(/^\/cors-proxy\/?/, "");
    if (fromPath && fromPath !== "/") return decodeURIComponent(fromPath);
    if (req.query && req.query.url) return req.query.url;
    return "";
  }

  app.all(/^\/cors-proxy\/(.*)/, (req, res) => {
    const rawTarget = extractProxyTarget(req);
    req.url = "/" + (rawTarget || "");
    handleAllowlistedProxy(req, res);
  });

  app.all(/^\/api\/cors-proxy.*/, async (req, res) => {
    const handler = require("./api/cors-proxy.js");
    if (!req.query) req.query = {};
    if (!req.query.url) {
      const m = (req.url || "").match(/[?&]url=([^&]+)/);
      if (m) req.query.url = decodeURIComponent(m[1]);
    }
    return handler(req, res);
  });

  // ── Market data APIs (server-side Yahoo, disk cache) ──
  app.get("/api/market/universe", (req, res) => {
    try {
      res.json(marketApi.getUniverse());
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/market/universe/refresh", async (req, res) => {
    try {
      const validate = req.body?.validate !== false;
      const maxValidate = req.body?.maxValidate != null ? parseInt(req.body.maxValidate, 10) : 0;
      const result = await marketApi.refreshUniverse({ validate, maxValidate });
      res.json(result);
    } catch (e) {
      console.error("[universe/refresh]", e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.get("/api/market/ohlcv", async (req, res) => {
    try {
      const day = req.query.day || marketApi.todayWIB();
      const force = req.query.force === "1" || req.query.force === "true";
      const max = req.query.max ? parseInt(req.query.max, 10) : undefined;
      const result = await marketApi.getOhlcvDay({ day, force, max, onProgress: null });
      res.json(result);
    } catch (e) {
      console.error("[ohlcv]", e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/market/ohlcv", async (req, res) => {
    try {
      const day = (req.body && req.body.day) || marketApi.todayWIB();
      const force = !!(req.body && req.body.force);
      const max = req.body && req.body.max;
      const result = await marketApi.getOhlcvDay({ day, force, max });
      res.json(result);
    } catch (e) {
      console.error("[ohlcv]", e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.get("/api/market/shortlist", async (req, res) => {
    try {
      const day = req.query.day || marketApi.todayWIB();
      const force = req.query.force === "1";
      const k = parseInt(req.query.k || "8", 10);
      const ohlcv = await marketApi.getOhlcvDay({ day, force });
      const shortlist = marketApi.buildShortlist(ohlcv, k);
      res.json(shortlist);
    } catch (e) {
      console.error("[shortlist]", e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  /** Single-ticker pack for deep dive (1y context + IHSG regime) */
  app.get("/api/market/ticker/:code", async (req, res) => {
    try {
      const code = String(req.params.code || "")
        .toUpperCase()
        .replace(/\.JK$/i, "");
      if (!/^[A-Z]{3,4}$/.test(code)) {
        return res.status(400).json({ error: "ticker invalid (3-4 huruf)" });
      }
      const force = req.query.force === "1";
      const pack = await marketApi.getTickerPack(code, { force });
      res.json(pack);
    } catch (e) {
      console.error("[ticker]", e);
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.get("/api/search/ddg", async (req, res) => {
    try {
      const q = req.query.q || "";
      if (!q) return res.status(400).json({ error: "q required" });
      const results = await marketApi.ddgSearch(q, parseInt(req.query.n || "5", 10));
      res.json({ query: q, results });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/runs", (req, res) => {
    try {
      const run = req.body;
      if (!run || !run.runId) return res.status(400).json({ error: "runId required" });
      const saved = marketApi.saveRun(run);
      res.json({ ok: true, path: saved });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.get("/api/runs", (req, res) => {
    try {
      res.json(marketApi.listRuns());
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.get("/api/runs/:id", (req, res) => {
    try {
      const run = marketApi.loadRun(req.params.id);
      if (!run) return res.status(404).json({ error: "not found" });
      res.json(run);
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.get("/api/memory/compact", (req, res) => {
    try {
      const n = parseInt(req.query.n || "10", 10);
      res.json({ items: marketApi.loadCompactMemory(n) });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.post("/api/memory/compact", (req, res) => {
    try {
      marketApi.appendCompactMemory(req.body);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ ok: true, service: "ihsg-market-bot", time: new Date().toISOString() });
  });

  app.use(express.static(path.join(__dirname, "frontend")));

  app.listen(FRONTEND_PORT, "0.0.0.0", () => {
    console.log(`[IHSG Market Bot] http://localhost:${FRONTEND_PORT}`);
    // ensure data dirs
    for (const d of ["data/cache", "data/runs", "data/memory", "data/universe"]) {
      fs.mkdirSync(path.join(__dirname, d), { recursive: true });
    }
  });
}
