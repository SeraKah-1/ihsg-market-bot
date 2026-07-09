const express = require("express");
const cors_proxy = require("cors-anywhere");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { isAllowedProxyTarget, normalizeProxyTarget } = require("./api/proxy-allowlist.js");
const marketApi = require("./lib/market-api.js");
const webClient = require("./lib/ninerouter-web-client.js");

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
      res.json({ query: q, results, layer: "news-rss" });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
  });

  /**
   * 9Router POST /v1/search (same custom endpoint + key as chat).
   * Body: { endpoint, apiKey, query, max_results?, search_type?, model? }
   */
  app.post("/api/web/search", async (req, res) => {
    try {
      const b = req.body || {};
      const endpoint = b.endpoint || "";
      const apiKey = b.apiKey || "";
      const query = b.query || "";
      if (!query) return res.status(400).json({ error: "query required" });
      if (!endpoint) {
        return res.json({
          ok: false,
          results: [],
          layer: "none",
          errors: ["no_endpoint"],
          query
        });
      }
      const out = await webClient.searchVia9Router({
        endpoint,
        apiKey,
        query,
        max_results: b.max_results || 5,
        search_type: b.search_type || "news",
        model: b.model || null
      });
      res.json({
        ...out,
        layer: out.ok ? "9r-search" : "none"
      });
    } catch (e) {
      console.error("[web/search]", e);
      res.status(500).json({ error: String(e.message || e), results: [], ok: false });
    }
  });

  /**
   * Fetch page: 9Router /v1/web/fetch then free Jina.
   * Body: { endpoint, apiKey, url, max_characters?, model? }
   */
  app.post("/api/web/fetch", async (req, res) => {
    try {
      const b = req.body || {};
      const url = b.url || "";
      if (!url) return res.status(400).json({ error: "url required" });
      const out = await webClient.fetchPage({
        endpoint: b.endpoint || "http://127.0.0.1:20128/v1",
        apiKey: b.apiKey || "",
        url,
        max_characters: b.max_characters != null ? b.max_characters : 6000,
        model: b.model || null,
        allowJinaFree: b.allowJinaFree !== false
      });
      res.json(out);
    } catch (e) {
      console.error("[web/fetch]", e);
      res.status(500).json({ ok: false, error: String(e.message || e), text: "" });
    }
  });

  /**
   * Multi-query research pack: 9r search → free news; optional page fetches.
   */
  app.post("/api/web/research", async (req, res) => {
    try {
      const b = req.body || {};
      const queries = Array.isArray(b.queries) ? b.queries : b.query ? [b.query] : [];
      if (!queries.length) return res.status(400).json({ error: "queries required" });
      const endpoint = b.endpoint || "";
      const apiKey = b.apiKey || "";
      const fetchPages = !!b.fetchPages;
      const fetchLimit = Math.min(5, Math.max(0, parseInt(b.fetchLimit || "4", 10)));
      const maxPerQuery = Math.min(8, Math.max(1, parseInt(b.max_results || "4", 10)));

      const allHits = [];
      let used9rSearch = false;
      let usedFreeNews = false;
      const layerErrors = [];

      for (const query of queries.slice(0, 12)) {
        let got = false;
        if (endpoint) {
          const s = await webClient.searchVia9Router({
            endpoint,
            apiKey,
            query,
            max_results: maxPerQuery,
            search_type: b.search_type || "news",
            model: b.searchModel || null
          });
          if (s.ok && s.results.length) {
            used9rSearch = true;
            for (const r of s.results) allHits.push({ ...r, query });
            got = true;
          } else if (s.errors?.length) {
            layerErrors.push(...s.errors.slice(0, 2));
          }
        }
        if (!got) {
          try {
            const news = await marketApi.ddgSearch(query, maxPerQuery);
            if (news.length) {
              usedFreeNews = true;
              for (const r of news) {
                allHits.push({
                  title: r.title,
                  url: r.url,
                  snippet: r.snippet || "",
                  sourceTier: r.sourceTier || "media",
                  provider: r.provider || "news-rss",
                  query
                });
              }
            }
          } catch (e) {
            layerErrors.push(`news:${e.message || e}`);
          }
        }
      }

      // dedupe
      const seen = new Set();
      const results = allHits.filter((r) => {
        const k = (r.url || "") + "|" + String(r.title || "").slice(0, 60);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      let pages = [];
      let used9rFetch = false;
      let usedJina = false;
      if (fetchPages && fetchLimit > 0 && results.length) {
        const pack = await webClient.fetchTopFromHits({
          endpoint: endpoint || "http://127.0.0.1:20128/v1",
          apiKey,
          hits: results,
          limit: fetchLimit,
          max_characters: b.max_characters || 6000,
          fetchModel: b.fetchModel || null
        });
        pages = pack.pages;
        used9rFetch = pack.used9rFetch;
        usedJina = pack.usedJina;
      }

      const layers = [];
      if (used9rSearch) layers.push("9r-search");
      if (usedFreeNews) layers.push("news-rss");
      if (used9rFetch) layers.push("9r-fetch");
      if (usedJina) layers.push("jina-free");

      res.json({
        ok: results.length > 0 || pages.length > 0,
        results,
        pages,
        layer: layers.join("+") || "none",
        used9rSearch,
        usedFreeNews,
        used9rFetch,
        usedJina,
        errors: layerErrors.slice(0, 8)
      });
    } catch (e) {
      console.error("[web/research]", e);
      res.status(500).json({ ok: false, error: String(e.message || e), results: [], pages: [] });
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
