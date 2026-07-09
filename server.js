const express = require("express");
const cors_proxy = require("cors-anywhere");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { isAllowedProxyTarget, normalizeProxyTarget } = require("./api/proxy-allowlist.js");
const marketApi = require("./lib/market-api.js");
const webClient = require("./lib/web-client.js");
const { mergeLayerLabel } = require("./lib/web-core.js");
const tickerUtil = require("./lib/ticker-util.js");

/** Load gitignored .env into process.env (no dotenv dep). */
function loadDotEnv() {
  try {
    const p = path.join(__dirname, ".env");
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (k && process.env[k] == null) process.env[k] = v;
    }
  } catch {
    /* ignore */
  }
}
loadDotEnv();

function resolveJinaKey(bodyKey) {
  return String(bodyKey || process.env.JINA_API_KEY || "").trim();
}

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

  /**
   * Refresh universe.
   * Body: { mode?: "quick"|"sample"|"full", validate?: boolean, maxValidate?: number }
   * Default = quick (seed only) so browser never hangs with Failed to fetch.
   */
  app.post("/api/market/universe/refresh", async (req, res) => {
    // Long-running full validate may need client patience; disable socket timeout for this req
    try {
      req.setTimeout?.(0);
      res.setTimeout?.(0);
    } catch {
      /* */
    }
    try {
      const b = req.body || {};
      let mode = b.mode || null;
      if (!mode) {
        if (b.validate === false || b.validate === "false") mode = "quick";
        else if (b.validate === true && (b.maxValidate === 0 || b.maxValidate === "0")) mode = "full";
        else if (b.validate === true) mode = "sample";
        else mode = "quick"; // safe default
      }
      const maxValidate =
        b.maxValidate != null ? parseInt(b.maxValidate, 10) : mode === "sample" ? 80 : 0;
      const validate = mode !== "quick";
      console.log(`[universe/refresh] mode=${mode} validate=${validate} max=${maxValidate}`);
      const result = await marketApi.refreshUniverse({ validate, maxValidate, mode });
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
      const parsed = tickerUtil.parseTicker(req.params.code || "");
      if (!parsed.ok) {
        return res.status(400).json({ error: parsed.error, ticker: parsed.ticker });
      }
      const force = req.query.force === "1";
      const pack = await marketApi.getTickerPack(parsed.ticker, { force });
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
   * Jina Search (s.jina.ai). Body: { query, max_results?, jinaApiKey? }
   * Key: body.jinaApiKey || process.env.JINA_API_KEY
   */
  app.post("/api/web/search", async (req, res) => {
    try {
      const b = req.body || {};
      const query = b.query || "";
      if (!query) return res.status(400).json({ error: "query required" });
      const jinaApiKey = resolveJinaKey(b.jinaApiKey);
      const out = await webClient.searchViaJina({
        query,
        max_results: b.max_results || 5,
        jinaApiKey
      });
      res.json(out);
    } catch (e) {
      console.error("[web/search]", e);
      res.status(500).json({ error: String(e.message || e), results: [], ok: false });
    }
  });

  /**
   * Fetch page via Jina Reader (r.jina.ai). Optional allowNativeRaw.
   * Body: { url, max_characters?, jinaApiKey?, allowNativeRaw? }
   */
  app.post("/api/web/fetch", async (req, res) => {
    try {
      const b = req.body || {};
      const url = b.url || "";
      if (!url) return res.status(400).json({ error: "url required" });
      const out = await webClient.fetchPage({
        url,
        max_characters: b.max_characters != null ? b.max_characters : 6000,
        jinaApiKey: resolveJinaKey(b.jinaApiKey),
        allowNativeRaw: !!b.allowNativeRaw
      });
      res.json(out);
    } catch (e) {
      console.error("[web/fetch]", e);
      res.status(500).json({ ok: false, error: String(e.message || e), text: "" });
    }
  });

  /**
   * Multi-query research pack: Jina search → free news gap-fill; optional page fetches.
   * Native model tools run in the browser (hybridResearchSearch), not here.
   */
  app.post("/api/web/research", async (req, res) => {
    try {
      const b = req.body || {};
      const queries = Array.isArray(b.queries) ? b.queries : b.query ? [b.query] : [];
      if (!queries.length) return res.status(400).json({ error: "queries required" });
      const jinaApiKey = resolveJinaKey(b.jinaApiKey);
      const fetchPages = !!b.fetchPages;
      const fetchLimit = Math.min(5, Math.max(0, parseInt(b.fetchLimit || "4", 10)));
      const maxPerQuery = Math.min(8, Math.max(1, parseInt(b.max_results || "4", 10)));

      const pack = await webClient.researchPack({
        queries,
        max_results: maxPerQuery,
        jinaApiKey,
        fetchPages: fetchPages && fetchLimit > 0,
        fetchLimit,
        max_characters: b.max_characters || 6000
      });

      const allHits = [...(pack.results || [])];
      let usedFreeNews = false;
      const layerErrors = [...(pack.errors || [])];

      // Gap-fill with free Google News RSS when Jina thin/empty
      if (allHits.length < 2) {
        for (const query of queries.slice(0, 12)) {
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

      const seen = new Set();
      const results = allHits.filter((r) => {
        const k = (r.url || "") + "|" + String(r.title || "").slice(0, 60);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      // If we still need pages and only news hits existed, fetch now
      let pages = pack.pages || [];
      let usedJinaFetch = !!pack.usedJinaFetch;
      if (fetchPages && fetchLimit > 0 && pages.length === 0 && results.length) {
        const more = await webClient.fetchTopFromHits({
          hits: results,
          limit: fetchLimit,
          max_characters: b.max_characters || 6000,
          jinaApiKey
        });
        pages = more.pages;
        usedJinaFetch = more.usedJinaFetch;
      }

      const layer = mergeLayerLabel({
        usedNative: false,
        usedJinaSearch: !!pack.usedJinaSearch,
        usedJinaFetch,
        usedFreeNews
      });

      res.json({
        ok: results.length > 0 || pages.length > 0,
        results,
        pages,
        layer,
        usedJinaSearch: !!pack.usedJinaSearch,
        usedFreeNews,
        usedJinaFetch,
        hasJinaKey: !!jinaApiKey,
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
