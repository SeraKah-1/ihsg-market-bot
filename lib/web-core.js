/**
 * Pure helpers for own web search/fetch stack (no 9Router).
 *
 * Patterns inspired by public agent skill docs (query → hits; url → markdown)
 * but implementations talk directly to:
 *   - Jina Search  https://s.jina.ai/?q=
 *   - Jina Reader  https://r.jina.ai/{url}
 *   - free Google News RSS (via market-api)
 *
 * Layer order (product):
 *   1) native model tools (xAI web_search / Gemini google_search) — browser/agent
 *   2) Jina authenticated search + fetch — server
 *   3) Google News RSS — last resort
 */

function jinaReaderUrl(targetUrl) {
  const u = String(targetUrl || "").trim();
  if (!u.startsWith("http")) throw new Error("url must be http(s)");
  return "https://r.jina.ai/" + u;
}

function jinaSearchUrl(query, { gl = "ID", hl = "id" } = {}) {
  const q = String(query || "").trim();
  if (!q) throw new Error("query required");
  const params = new URLSearchParams({ q });
  if (gl) params.set("gl", gl);
  if (hl) params.set("hl", hl);
  return "https://s.jina.ai/?" + params.toString();
}

/**
 * Normalize Jina s.jina.ai JSON → agent-facing hits.
 * Shape: { code, status, data: [{ title, url, description, content }] }
 * Also accepts flat { results: [...] } or raw array for tests.
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
  // Jina error-ish
  if (data.code && data.code >= 400) {
    const msg = data.message || data.status || `code ${data.code}`;
    return { provider: "jina-search", query, results, errors: [String(msg)], rawUsage: null };
  }

  let list = [];
  if (Array.isArray(data.data)) list = data.data;
  else if (Array.isArray(data.results)) list = data.results;
  else if (Array.isArray(data)) list = data;

  for (const r of list) {
    if (!r) continue;
    if (typeof r === "string") {
      results.push({
        title: r.slice(0, 120),
        url: "",
        snippet: r,
        sourceTier: "media",
        provider: "jina-search",
        query,
        score: null
      });
      continue;
    }
    const title = r.title || r.name || "";
    const url = r.url || r.link || r.href || "";
    const snippet =
      r.description || r.snippet || r.content || r.text || r.summary || "";
    if (!title && !url && !snippet) continue;
    results.push({
      title: String(title),
      url: String(url),
      snippet: String(snippet).slice(0, 800),
      sourceTier: "media",
      provider: r.provider || "jina-search",
      query,
      score: r.score != null ? r.score : r.position != null ? 1 / (1 + r.position) : null,
      published_at: r.publishedTime || r.published_at || null
    });
  }

  const errors = Array.isArray(data.errors)
    ? data.errors.map((e) => (typeof e === "string" ? e : e.message || JSON.stringify(e)))
    : [];

  return {
    provider: data.provider || (results.length ? "jina-search" : null),
    query: data.query || query,
    results,
    errors,
    rawUsage: data.meta?.usage || data.usage || null,
    answer: data.answer || null
  };
}

/**
 * Normalize Jina r.jina.ai JSON or plain markdown text.
 * JSON: { code, data: { title, url, content, description } }
 */
function normalizeFetchResponse(data, url = "") {
  // plain string body
  if (typeof data === "string") {
    const text = data.trim();
    return {
      ok: text.length > 0,
      url,
      title: "",
      text: text.slice(0, 12000),
      provider: "jina-reader",
      error: text.length ? null : "no_content"
    };
  }
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
  if (data.code && data.code >= 400) {
    return {
      ok: false,
      url,
      title: "",
      text: "",
      provider: "jina-reader",
      error: String(data.message || data.status || data.code)
    };
  }

  // Jina JSON envelope
  const d = data.data && typeof data.data === "object" ? data.data : data;
  const content = d.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (content && typeof content === "object") {
    text = content.text || content.markdown || content.raw_content || content.html || "";
  }
  if (!text && d.text) text = d.text;
  if (!text && d.markdown) text = d.markdown;
  if (!text && data._raw) text = data._raw;
  text = String(text || "").trim();

  return {
    ok: text.length > 0,
    url: d.url || data.url || url,
    title: d.title || data.title || "",
    text: text.slice(0, 12000),
    provider: data.provider || "jina-reader",
    error: text.length ? null : "no_content",
    usage: d.usage || data.meta?.usage || data.usage || null
  };
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
 * Layer label for UI/logs.
 */
function mergeLayerLabel({
  usedNative = false,
  usedJinaSearch = false,
  usedJinaFetch = false,
  usedFreeNews = false
} = {}) {
  const parts = [];
  if (usedNative) parts.push("native-tools");
  if (usedJinaSearch) parts.push("jina-search");
  if (usedJinaFetch) parts.push("jina-fetch");
  if (usedFreeNews) parts.push("news-rss");
  return parts.length ? parts.join("+") : "none";
}

module.exports = {
  jinaReaderUrl,
  jinaSearchUrl,
  normalizeSearchResponse,
  normalizeFetchResponse,
  pickTopUrls,
  mergeLayerLabel
};
