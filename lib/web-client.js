/**
 * Server web client: Jina Search + Jina Reader (authenticated preferred).
 * No 9Router dependency.
 */
const https = require("https");
const http = require("http");
const {
  jinaReaderUrl,
  jinaSearchUrl,
  normalizeSearchResponse,
  normalizeFetchResponse,
  pickTopUrls
} = require("./web-core.js");

function httpRequest(method, url, { headers = {}, body = null, timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const payload = body != null ? (typeof body === "string" ? body : JSON.stringify(body)) : null;
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
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload)
              }
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
            json = null;
          }
          resolve({ status, json, raw, headers: res.headers });
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

function authHeaders(jinaApiKey) {
  const h = { Accept: "application/json" };
  if (jinaApiKey) h.Authorization = `Bearer ${String(jinaApiKey).trim()}`;
  return h;
}

/**
 * Search via s.jina.ai (needs API key for production rate limits).
 */
async function searchViaJina({
  query,
  max_results = 5,
  jinaApiKey = "",
  gl = "ID",
  hl = "id"
}) {
  const errors = [];
  if (!query || !String(query).trim()) {
    return { ok: false, provider: null, query: "", results: [], errors: ["query required"] };
  }
  try {
    const url = jinaSearchUrl(query, { gl, hl });
    const { status, json, raw } = await httpRequest("GET", url, {
      headers: authHeaders(jinaApiKey),
      timeoutMs: 25000
    });
    if (status === 401 || status === 403) {
      return {
        ok: false,
        provider: "jina-search",
        query,
        results: [],
        errors: [`jina auth ${status}`],
        layer: "none"
      };
    }
    if (status >= 400) {
      const msg = json?.message || json?.error || raw.slice(0, 160);
      return {
        ok: false,
        provider: "jina-search",
        query,
        results: [],
        errors: [`jina ${status}: ${msg}`],
        layer: "none"
      };
    }
    const norm = normalizeSearchResponse(json || { _raw: raw }, query);
    // cap
    norm.results = norm.results.slice(0, Math.max(1, Math.min(20, Number(max_results) || 5)));
    if (norm.results.length) {
      return { ok: true, ...norm, layer: "jina-search", errors };
    }
    errors.push("jina-search: empty results");
    return { ok: false, ...norm, layer: "none", errors };
  } catch (e) {
    return {
      ok: false,
      provider: "jina-search",
      query,
      results: [],
      errors: [`jina-search: ${e.message || e}`],
      layer: "none"
    };
  }
}

/**
 * Fetch page via r.jina.ai — best option for LLM-friendly markdown.
 * Prefer authenticated key (higher RPM / trust pool).
 * Optional raw native fetch only as soft last resort for simple static pages.
 */
async function fetchPage({
  url,
  max_characters = 6000,
  jinaApiKey = "",
  allowNativeRaw = false
}) {
  const errors = [];
  if (!url || !String(url).trim()) {
    return {
      ok: false,
      url: "",
      title: "",
      text: "",
      provider: null,
      layer: "none",
      error: "url required",
      errors
    };
  }

  // 1) Jina Reader (primary for fetch)
  try {
    const jurl = jinaReaderUrl(url);
    const { status, json, raw } = await httpRequest("GET", jurl, {
      headers: {
        ...authHeaders(jinaApiKey),
        Accept: "application/json"
      },
      timeoutMs: 35000
    });
    if (status >= 200 && status < 300) {
      let norm;
      if (json) {
        norm = normalizeFetchResponse(json, url);
      } else {
        norm = normalizeFetchResponse(raw, url);
      }
      if (norm.ok) {
        const text = norm.text.slice(0, max_characters || 6000);
        return {
          ...norm,
          text,
          layer: jinaApiKey ? "jina-fetch" : "jina-fetch-anon",
          provider: jinaApiKey ? "jina-reader" : "jina-reader-anon",
          errors
        };
      }
      errors.push(`jina-reader: ${norm.error || "empty"}`);
    } else {
      errors.push(`jina-reader: HTTP ${status} ${raw.slice(0, 100)}`);
    }
  } catch (e) {
    errors.push(`jina-reader: ${e.message || e}`);
  }

  // 2) Optional bare HTTP GET — only static/simple pages; often blocked / noisy HTML
  if (allowNativeRaw) {
    try {
      const { status, raw } = await httpRequest("GET", url, {
        headers: {
          Accept: "text/html,text/plain,*/*",
          "User-Agent": "IHSGMarketBot/1.0"
        },
        timeoutMs: 20000
      });
      if (status >= 200 && status < 300 && raw && raw.length > 80) {
        // crude strip tags for tiny fallback
        let text = raw
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, max_characters || 6000);
        if (text.length > 80) {
          return {
            ok: true,
            url,
            title: "",
            text,
            provider: "native-raw",
            layer: "native-raw",
            error: null,
            errors
          };
        }
      }
      errors.push(`native-raw: HTTP ${status} short/empty`);
    } catch (e) {
      errors.push(`native-raw: ${e.message || e}`);
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

/**
 * Batch fetch top URLs from search hits.
 */
async function fetchTopFromHits({
  hits,
  limit = 4,
  max_characters = 6000,
  jinaApiKey = "",
  allowNativeRaw = false
}) {
  const urls = pickTopUrls(hits, limit);
  const pages = [];
  let usedJina = false;
  let usedNativeRaw = false;
  for (const u of urls) {
    const page = await fetchPage({
      url: u,
      max_characters,
      jinaApiKey,
      allowNativeRaw
    });
    if (page.ok) {
      pages.push({
        url: page.url,
        title: page.title,
        text: page.text,
        provider: page.provider,
        layer: page.layer
      });
      if (String(page.layer || "").includes("jina")) usedJina = true;
      if (page.layer === "native-raw") usedNativeRaw = true;
    }
  }
  return { pages, urls, usedJinaFetch: usedJina, usedNativeRaw };
}

/**
 * Multi-query research: Jina search → optional page fetches.
 * News RSS is filled by server route / caller (market-api).
 */
async function researchPack({
  queries,
  max_results = 4,
  jinaApiKey = "",
  fetchPages = false,
  fetchLimit = 0,
  max_characters = 6000
}) {
  const allHits = [];
  const layerErrors = [];
  let usedJinaSearch = false;

  for (const query of (queries || []).slice(0, 12)) {
    const s = await searchViaJina({
      query,
      max_results,
      jinaApiKey
    });
    if (s.ok && s.results.length) {
      usedJinaSearch = true;
      for (const r of s.results) allHits.push({ ...r, query });
    } else if (s.errors?.length) {
      layerErrors.push(...s.errors.slice(0, 2));
    }
  }

  const seen = new Set();
  const results = allHits.filter((r) => {
    const k = (r.url || "") + "|" + String(r.title || "").slice(0, 60);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let pages = [];
  let usedJinaFetch = false;
  if (fetchPages && fetchLimit > 0 && results.length) {
    const pack = await fetchTopFromHits({
      hits: results,
      limit: fetchLimit,
      max_characters,
      jinaApiKey
    });
    pages = pack.pages;
    usedJinaFetch = pack.usedJinaFetch;
  }

  return {
    ok: results.length > 0 || pages.length > 0,
    results,
    pages,
    usedJinaSearch,
    usedJinaFetch,
    errors: layerErrors.slice(0, 8)
  };
}

module.exports = {
  searchViaJina,
  fetchPage,
  fetchTopFromHits,
  researchPack,
  // aliases kept so old test names can migrate cleanly
  searchVia9Router: async () => ({
    ok: false,
    provider: null,
    query: "",
    results: [],
    errors: ["9router_disabled"]
  })
};
