/**
 * Node client: 9Router /v1/search + /v1/web/fetch with free Jina fetch fallback.
 * Used by Express /api/web/* routes.
 */
const https = require("https");
const http = require("http");
const {
  SEARCH_MODEL_CANDIDATES,
  FETCH_MODEL_CANDIDATES,
  buildSearchBody,
  buildFetchBody,
  normalizeSearchResponse,
  normalizeFetchResponse,
  jinaReaderUrl,
  pickTopUrls
} = require("./ninerouter-web-core.js");

function httpJson(method, url, { headers = {}, body = null, timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const payload = body != null ? JSON.stringify(body) : null;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          Accept: "application/json,text/plain,*/*",
          "User-Agent": "IHSGMarketBot/1.0",
          ...(payload
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
            : {}),
          ...headers
        },
        timeout: timeoutMs
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          const status = res.statusCode || 0;
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = { _raw: raw.slice(0, 4000) };
          }
          resolve({ status, json, raw });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function routerBase(endpoint) {
  let e = String(endpoint || "").replace(/\/+$/, "");
  e = e.replace(/\/chat\/completions$/, "");
  if (!e.endsWith("/v1")) {
    if (e.includes("/v1/")) e = e.replace(/\/v1\/.*$/, "/v1");
    else e = e + "/v1";
  }
  return e;
}

/**
 * Try 9Router search with model candidates; soft-fail.
 */
async function searchVia9Router({
  endpoint,
  apiKey,
  query,
  max_results = 5,
  search_type = "news",
  model = null
}) {
  const base = routerBase(endpoint);
  const models = model
    ? [model, ...SEARCH_MODEL_CANDIDATES.filter((m) => m !== model)]
    : SEARCH_MODEL_CANDIDATES;
  const errors = [];
  for (const m of models) {
    try {
      const body = buildSearchBody({ model: m, query, max_results, search_type });
      const { status, json, raw } = await httpJson("POST", `${base}/search`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        body,
        timeoutMs: 20000
      });
      if (status === 404 || status === 405) {
        errors.push(`${m}: endpoint ${status}`);
        // no search route at all
        if (status === 404) break;
        continue;
      }
      if (status === 401 || status === 403) {
        errors.push(`${m}: auth ${status}`);
        break;
      }
      if (status >= 400) {
        const msg = json?.error?.message || raw.slice(0, 120);
        errors.push(`${m}: ${status} ${msg}`);
        // try next model/provider
        continue;
      }
      const norm = normalizeSearchResponse(json, query);
      if (norm.results.length) {
        return { ok: true, ...norm, triedModel: m, errors };
      }
      errors.push(`${m}: empty results`);
    } catch (e) {
      errors.push(`${m}: ${e.message || e}`);
    }
  }
  return { ok: false, provider: null, query, results: [], errors, triedModel: null };
}

/**
 * 9Router fetch, then free Jina Reader.
 */
async function fetchPage({
  endpoint,
  apiKey,
  url,
  max_characters = 6000,
  model = null,
  allowJinaFree = true
}) {
  const base = routerBase(endpoint);
  const models = model
    ? [model, ...FETCH_MODEL_CANDIDATES.filter((m) => m !== model)]
    : FETCH_MODEL_CANDIDATES;
  const errors = [];

  for (const m of models) {
    try {
      const body = buildFetchBody({ model: m, url, max_characters });
      const { status, json, raw } = await httpJson("POST", `${base}/web/fetch`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        body,
        timeoutMs: 30000
      });
      if (status === 404 || status === 405) {
        errors.push(`9r-fetch ${m}: ${status}`);
        if (status === 404) break;
        continue;
      }
      if (status === 401 || status === 403) {
        errors.push(`9r-fetch auth ${status}`);
        break;
      }
      if (status >= 400) {
        errors.push(`9r-fetch ${m}: ${status} ${json?.error?.message || raw.slice(0, 80)}`);
        continue;
      }
      const norm = normalizeFetchResponse(json, url);
      if (norm.ok) {
        return { ...norm, layer: "9r-fetch", triedModel: m, errors };
      }
      errors.push(`9r-fetch ${m}: ${norm.error || "empty"}`);
    } catch (e) {
      errors.push(`9r-fetch ${m}: ${e.message || e}`);
    }
  }

  if (allowJinaFree) {
    try {
      const jurl = jinaReaderUrl(url);
      const { status, raw } = await httpJson("GET", jurl, {
        headers: { Accept: "text/plain" },
        timeoutMs: 25000
      });
      // jina returns plain text/markdown, not always JSON
      let text = "";
      if (status >= 200 && status < 300) {
        // httpJson may have put body in raw
        text = raw || "";
        if (text.startsWith("{") && text.includes("_raw")) {
          try {
            text = JSON.parse(text)._raw || text;
          } catch {
            /* */
          }
        }
      }
      // Re-fetch as text properly if JSON wrapper
      if (!text || text.length < 20) {
        text = await httpGetText(jurl, 25000);
      }
      text = String(text || "").trim().slice(0, max_characters || 6000);
      if (text.length > 40) {
        return {
          ok: true,
          url,
          title: "",
          text,
          provider: "jina-free",
          layer: "jina-free",
          error: null,
          errors
        };
      }
      errors.push("jina-free: short/empty");
    } catch (e) {
      errors.push(`jina-free: ${e.message || e}`);
    }
  }

  return {
    ok: false,
    url,
    title: "",
    text: "",
    provider: null,
    layer: "none",
    error: errors.slice(-3).join("; "),
    errors
  };
}

function httpGetText(url, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.get(
      url,
      {
        headers: { "User-Agent": "IHSGMarketBot/1.0", Accept: "text/plain,*/*" },
        timeout: timeoutMs
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve(raw));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

/**
 * Batch fetch top URLs (cap).
 */
async function fetchTopFromHits({
  endpoint,
  apiKey,
  hits,
  limit = 4,
  max_characters = 6000,
  fetchModel = null
}) {
  const urls = pickTopUrls(hits, limit);
  const pages = [];
  let used9r = false;
  let usedJina = false;
  for (const url of urls) {
    const page = await fetchPage({
      endpoint,
      apiKey,
      url,
      max_characters,
      model: fetchModel
    });
    if (page.ok) {
      pages.push({
        url: page.url,
        title: page.title,
        text: page.text,
        provider: page.provider,
        layer: page.layer
      });
      if (page.layer === "9r-fetch") used9r = true;
      if (page.layer === "jina-free") usedJina = true;
    }
  }
  return { pages, urls, used9rFetch: used9r, usedJina };
}

module.exports = {
  searchVia9Router,
  fetchPage,
  fetchTopFromHits,
  routerBase,
  SEARCH_MODEL_CANDIDATES,
  FETCH_MODEL_CANDIDATES
};
