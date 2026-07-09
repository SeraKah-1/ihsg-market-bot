/**
 * Pure helpers for 9Router web search/fetch + free fallbacks.
 * No network — request bodies, normalize responses, pick URLs, Jina free URL.
 * @see https://github.com/decolua/9router skills 9router-web-search / web-fetch
 */

/** Default search model ids — try in order (combo/free-friendly first). */
const SEARCH_MODEL_CANDIDATES = [
  "search-combo",
  "searxng",
  "searxng/search",
  "tavily",
  "tavily/search",
  "brave-search",
  "brave",
  "youcom",
  "jina"
];

/** Default fetch model ids — jina often free/cheap. */
const FETCH_MODEL_CANDIDATES = [
  "fetch-combo",
  "jina-reader",
  "jina",
  "jina/fetch",
  "tavily",
  "firecrawl",
  "exa"
];

function buildSearchBody({
  model = "search-combo",
  query,
  max_results = 5,
  search_type = "news",
  domain_filter = null
} = {}) {
  if (!query || typeof query !== "string") {
    throw new Error("query required");
  }
  const body = {
    model: String(model),
    query: String(query).trim(),
    max_results: Math.max(1, Math.min(20, Number(max_results) || 5)),
    search_type: search_type === "web" ? "web" : "news"
  };
  if (domain_filter) body.domain_filter = domain_filter;
  return body;
}

function buildFetchBody({
  model = "jina-reader",
  url,
  format = "markdown",
  max_characters = 6000
} = {}) {
  if (!url || typeof url !== "string") {
    throw new Error("url required");
  }
  return {
    model: String(model),
    url: String(url).trim(),
    format: format === "html" || format === "text" ? format : "markdown",
    max_characters: Math.max(0, Number(max_characters) || 6000)
  };
}

/**
 * Normalize 9Router /v1/search JSON → agent-facing hits.
 */
function normalizeSearchResponse(data, query = "") {
  const results = [];
  if (!data || typeof data !== "object") {
    return { provider: null, query, results, errors: ["empty_response"], rawUsage: null };
  }
  if (data.error) {
    const msg =
      typeof data.error === "string"
        ? data.error
        : data.error.message || JSON.stringify(data.error);
    return { provider: null, query, results, errors: [msg], rawUsage: null };
  }
  const list = Array.isArray(data.results)
    ? data.results
    : Array.isArray(data.data)
      ? data.data
      : Array.isArray(data)
        ? data
        : [];

  for (const r of list) {
    if (!r) continue;
    if (typeof r === "string") {
      results.push({
        title: r.slice(0, 120),
        url: "",
        snippet: r,
        sourceTier: "media",
        provider: data.provider || "9router",
        query,
        score: null
      });
      continue;
    }
    const title = r.title || r.name || "";
    const url = r.url || r.link || r.href || "";
    const snippet = r.snippet || r.content || r.description || r.text || "";
    if (!title && !url && !snippet) continue;
    results.push({
      title: String(title),
      url: String(url),
      snippet: String(snippet).slice(0, 800),
      sourceTier: "media",
      provider: (r.citation && r.citation.provider) || data.provider || "9router",
      query,
      score: r.score != null ? r.score : r.position != null ? 1 / (1 + r.position) : null,
      published_at: r.published_at || null
    });
  }

  const errors = Array.isArray(data.errors)
    ? data.errors.map((e) => (typeof e === "string" ? e : e.message || JSON.stringify(e)))
    : [];

  return {
    provider: data.provider || null,
    query: data.query || query,
    results,
    errors,
    rawUsage: data.usage || null,
    answer: data.answer || null
  };
}

/**
 * Normalize 9Router /v1/web/fetch JSON → { title, url, text, provider }.
 */
function normalizeFetchResponse(data, url = "") {
  if (!data || typeof data !== "object") {
    return { ok: false, url, title: "", text: "", provider: null, error: "empty_response" };
  }
  if (data.error) {
    const msg =
      typeof data.error === "string"
        ? data.error
        : data.error.message || JSON.stringify(data.error);
    return { ok: false, url, title: "", text: "", provider: null, error: msg };
  }
  const content = data.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (content && typeof content === "object") {
    text = content.text || content.markdown || content.raw_content || content.html || "";
  }
  if (!text && data.text) text = data.text;
  if (!text && data.markdown) text = data.markdown;
  text = String(text || "").trim();
  return {
    ok: text.length > 0,
    url: data.url || url,
    title: data.title || "",
    text: text.slice(0, 12000),
    provider: data.provider || null,
    error: text.length ? null : "no_content",
    usage: data.usage || null
  };
}

/** Free Jina Reader URL (no key). */
function jinaReaderUrl(targetUrl) {
  const u = String(targetUrl || "").trim();
  if (!u.startsWith("http")) throw new Error("url must be http(s)");
  return "https://r.jina.ai/" + u;
}

/**
 * Pick top unique http(s) URLs from search hits for fetch.
 */
function pickTopUrls(hits, limit = 4) {
  const out = [];
  const seen = new Set();
  for (const h of hits || []) {
    const url = (h && h.url) || "";
    if (!/^https?:\/\//i.test(url)) continue;
    // skip obvious junk
    if (/google\.com\/search|facebook\.com|twitter\.com|x\.com\/i/i.test(url)) continue;
    const key = url.split("#")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Decide layer label for UI/logs.
 */
function mergeLayerLabel({ used9rSearch, used9rFetch, usedFreeNews, usedJina, usedNative }) {
  const parts = [];
  if (used9rSearch) parts.push("9r-search");
  if (used9rFetch) parts.push("9r-fetch");
  if (usedJina) parts.push("jina-free");
  if (usedFreeNews) parts.push("news-rss");
  if (usedNative) parts.push("native-tools");
  return parts.length ? parts.join("+") : "none";
}

module.exports = {
  SEARCH_MODEL_CANDIDATES,
  FETCH_MODEL_CANDIDATES,
  buildSearchBody,
  buildFetchBody,
  normalizeSearchResponse,
  normalizeFetchResponse,
  jinaReaderUrl,
  pickTopUrls,
  mergeLayerLabel
};
