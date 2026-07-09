/**
 * Native web search — xAI / OpenAI Responses API.
 *
 *   POST {customBase}/v1/responses
 *   { model, input, tools: [{ type: "web_search" }], stream:false,
 *     temperature, reasoning_effort (cascade) }
 *
 * - API key + base URL from Settings (custom router)
 * - Reasoning high→med→low→off + temperature (default 0.65)
 * - Tool profile cascade (bare web_search first)
 * - Outer hybrid: native → Jina search → Google News RSS
 */
import { resolveProviderCredentials, getProxyUrl, extractJson, modelFor, DEFAULT_TEMP } from "../ai.js";
import { appSettings, loadSettings } from "../state.js";
import {
  injectReasoningParams,
  preferredReasoningEffort,
  reasoningEffortCascade,
  shouldDropReasoningLevel,
  shouldTryNextToolProfile
} from "./reasoning.js";

/** IDX / ID finance domains — xAI allows max 5 allowed_domains */
export const IDX_SEARCH_DOMAINS = [
  "idx.co.id",
  "cnbcindonesia.com",
  "kontan.co.id",
  "bisnis.com",
  "investing.com"
];

/**
 * Build xAI / OpenAI Responses API web_search tool object per official docs:
 *   { "type": "web_search" }
 *   { "type": "web_search", "filters": { "allowed_domains": [...] } }
 */
export function buildWebSearchTool(opts = {}) {
  const tool = { type: "web_search" };
  const allowed = Array.isArray(opts.allowedDomains)
    ? opts.allowedDomains.filter(Boolean).slice(0, 5)
    : [];
  const excluded = Array.isArray(opts.excludedDomains)
    ? opts.excludedDomains.filter(Boolean).slice(0, 5)
    : [];

  if (allowed.length && excluded.length) {
    tool.filters = { allowed_domains: allowed };
  } else if (allowed.length) {
    tool.filters = { allowed_domains: allowed };
  } else if (excluded.length) {
    tool.filters = { excluded_domains: excluded };
  }

  if (opts.enableImageUnderstanding === true) {
    tool.enable_image_understanding = true;
  }
  if (opts.enableImageSearch === true) {
    tool.enable_image_search = true;
  }
  return tool;
}

export function stripWebSearchFilters(tool) {
  if (!tool || tool.type !== "web_search") return tool;
  return { type: "web_search" };
}

/**
 * Infer preferred native search tool config from model id (hint only).
 */
export function detectNativeSearchTool(model) {
  const m = String(model || "").toLowerCase();
  if (
    m.includes("grok") ||
    m.includes("xai/") ||
    m.startsWith("x-ai/") ||
    m.includes("xai-")
  ) {
    return {
      kind: "xai_web_search",
      tools: [buildWebSearchTool()] // docs-basic: bare web_search
    };
  }
  if (m.includes("gemini") || m.includes("google/")) {
    return {
      kind: "gemini_google_search",
      tools: [{ type: "google_search" }]
    };
  }
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) {
    return {
      kind: "openai_web_search",
      tools: [buildWebSearchTool()]
    };
  }
  return { kind: "generic_web_search", tools: [buildWebSearchTool()] };
}

export function modelSupportsNativeSearch(model) {
  return !!String(model || "").trim();
}

/**
 * Build Responses API URL from custom router base (settings endpoint).
 * e.g. https://api.x.ai/v1  →  https://api.x.ai/v1/responses
 *      https://my.router.com →  https://my.router.com/v1/responses
 */
export function buildResponsesUrl(endpoint) {
  const base = String(endpoint || "").replace(/\/+$/, "");
  if (!base) return "";
  if (base.endsWith("/responses")) return base;
  if (base.endsWith("/v1")) return `${base}/responses`;
  return `${base}/v1/responses`;
}

/**
 * Responses body: model + input + tools + stream:false + temp + optional reasoning.
 * stream:false wajib: banyak custom router default-stream SSE.
 * System digabung ke user content (docs contoh sering role user).
 */
export function buildNativeResponsesBody({
  model,
  system,
  user,
  tools,
  temperature = DEFAULT_TEMP,
  reasoningEffort = null
}) {
  const content =
    system && String(system).trim()
      ? `${String(system).trim()}\n\n---\n\n${String(user || "")}`
      : String(user || "");
  const body = {
    model,
    input: [{ role: "user", content }],
    tools: tools && tools.length ? tools : [{ type: "web_search" }],
    stream: false,
    temperature: temperature == null ? DEFAULT_TEMP : temperature
  };
  if (reasoningEffort) injectReasoningParams(body, model, reasoningEffort);
  return body;
}

/**
 * Detect SSE / event-stream payload (custom routers often stream Responses).
 */
export function looksLikeSse(text) {
  const t = String(text || "").trimStart();
  if (!t) return false;
  if (t.startsWith("event:") || t.startsWith("data:")) return true;
  // mid-stream sample that starts with partial JSON error message context
  if (/^event:\s*res/i.test(t) || /\nevent:\s*/.test(t.slice(0, 200))) return true;
  if (t.includes("\ndata:") && (t.includes("event:") || t.includes("response."))) return true;
  return false;
}

/**
 * Parse Responses API body: plain JSON object OR SSE event stream.
 * Prefer full object from response.completed / response.done when streaming.
 */
export function parseResponsesPayload(rawText) {
  const text = String(rawText || "");
  const trimmed = text.trim();
  if (!trimmed) {
    return { data: null, content: "", citations: [], toolTraces: [], via: "empty" };
  }

  // Plain JSON object
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed);
      const parsed = parseResponsesApi(data, false);
      return { data, ...parsed, via: "json" };
    } catch (e) {
      // fall through to SSE / salvage
    }
  }

  if (looksLikeSse(text) || trimmed.includes("data:")) {
    const sse = parseResponsesSse(text);
    return { ...sse, via: "sse" };
  }

  // Salvage: first {...} last {...} block
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const data = JSON.parse(trimmed.slice(start, end + 1));
      const parsed = parseResponsesApi(data, false);
      return { data, ...parsed, via: "json_salvage" };
    } catch {
      /* */
    }
  }

  return {
    data: null,
    content: "",
    citations: [],
    toolTraces: [],
    via: "unparsed",
    error: `unparsed_body: ${trimmed.slice(0, 80)}`
  };
}

/**
 * Assemble OpenAI/xAI-style Responses SSE into one logical response.
 */
export function parseResponsesSse(rawText) {
  const events = [];
  const blocks = String(rawText || "").split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split(/\n/);
    let eventName = "";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) continue;
    const dataStr = dataLines.join("\n");
    if (dataStr === "[DONE]" || dataStr === "DONE") {
      events.push({ event: eventName || "done", data: null, done: true });
      continue;
    }
    try {
      events.push({ event: eventName, data: JSON.parse(dataStr) });
    } catch {
      events.push({ event: eventName, data: dataStr, raw: true });
    }
  }

  let finalResponse = null;
  let textParts = [];
  const citations = [];
  const toolTraces = [];

  for (const ev of events) {
    const d = ev.data;
    if (!d || typeof d !== "object") continue;
    const type = ev.event || d.type || "";

    // Full response envelopes
    if (
      type === "response.completed" ||
      type === "response.done" ||
      type.endsWith("response.completed")
    ) {
      finalResponse = d.response || d;
    }
    if (d.response && (d.response.output || d.response.output_text || d.response.citations)) {
      finalResponse = d.response;
    }
    // Some gateways send the whole response as data without event name
    if (!finalResponse && (d.output || d.output_text) && (d.id || d.object === "response")) {
      finalResponse = d;
    }

    // Text deltas
    if (
      type === "response.output_text.delta" ||
      type === "response.text.delta" ||
      type.includes("output_text.delta")
    ) {
      const delta = d.delta ?? d.text ?? d.content ?? "";
      if (delta) textParts.push(typeof delta === "string" ? delta : String(delta));
    }
    if (type === "response.output_text.done" && d.text) {
      textParts = [d.text];
    }
    // Chat-completions-like chunks nested in responses stream
    if (d.choices?.[0]?.delta?.content) {
      textParts.push(d.choices[0].delta.content);
    }
    if (Array.isArray(d.citations)) {
      for (const c of d.citations) {
        citations.push({
          title: c.title || c.url || "",
          url: typeof c === "string" ? c : c.url || "",
          sourceTier: "media"
        });
      }
    }
  }

  if (finalResponse) {
    const parsed = parseResponsesApi(finalResponse, false);
    // merge any delta text if output_text empty
    if (!parsed.content && textParts.length) {
      parsed.content = textParts.join("");
    }
    // merge citations
    const seen = new Set(parsed.citations.map((c) => c.url || c.title));
    for (const c of citations) {
      const k = c.url || c.title;
      if (k && !seen.has(k)) {
        seen.add(k);
        parsed.citations.push(c);
      }
    }
    return {
      data: finalResponse,
      content: parsed.content,
      citations: parsed.citations,
      toolTraces: parsed.toolTraces.length ? parsed.toolTraces : toolTraces,
      events: events.length
    };
  }

  const content = textParts.join("");
  return {
    data: null,
    content,
    citations,
    toolTraces,
    events: events.length
  };
}

/**
 * Tool profiles only (no reasoning cascade).
 * 1) bare web_search (docs)
 * 2) filtered IDX domains (briefing only)
 * 3) google_search
 * 4) both
 */
export function buildToolProfileCascade(model, { unrestrictedWeb = false } = {}) {
  const preferred = detectNativeSearchTool(model);
  const profiles = [];

  // Always docs-first bare web_search for max gateway compatibility
  profiles.push({ kind: "web_search", tools: [buildWebSearchTool()] });

  // Model preferred if different (e.g. google_search for Gemini)
  const prefJson = JSON.stringify(preferred.tools);
  if (prefJson !== JSON.stringify([{ type: "web_search" }])) {
    let tools = preferred.tools;
    if (unrestrictedWeb) {
      tools = tools.map((t) =>
        t && t.type === "web_search" ? stripWebSearchFilters(t) : t
      );
    }
    profiles.unshift({ kind: preferred.kind, tools });
  }

  if (!unrestrictedWeb) {
    profiles.push({
      kind: "web_search_idx_filter",
      tools: [buildWebSearchTool({ allowedDomains: IDX_SEARCH_DOMAINS })]
    });
  }

  profiles.push({ kind: "google_search", tools: [{ type: "google_search" }] });
  profiles.push({
    kind: "web_search+google_search",
    tools: [buildWebSearchTool(), { type: "google_search" }]
  });

  const seen = new Set();
  const out = [];
  for (const p of profiles) {
    const k = JSON.stringify(p.tools);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/**
 * Single attempt: Responses API + custom router.
 */
async function attemptNativeOnce({
  model,
  system,
  user,
  signal,
  tools,
  toolKind,
  temperature = DEFAULT_TEMP,
  reasoningEffort = null
}) {
  let endpoint;
  let apiKey;
  let useProxy;
  try {
    ({ endpoint, apiKey, useProxy } = resolveProviderCredentials());
  } catch (e) {
    return {
      content: "",
      citations: [],
      toolTraces: [],
      mode: "NATIVE_FAILED",
      error: String(e.message || e),
      toolKind,
      ok: false
    };
  }

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": typeof location !== "undefined" ? location.href : "",
    "X-Title": "IHSG Market Bot"
  };

  let url = buildResponsesUrl(endpoint);
  if (useProxy) url = getProxyUrl(url);

  const body = buildNativeResponsesBody({
    model,
    system,
    user,
    tools,
    temperature,
    reasoningEffort
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    });

    const rawText = await res.text();

    if (!res.ok) {
      return {
        content: "",
        citations: [],
        toolTraces: [],
        mode: "NATIVE_FAILED",
        error: `responses ${res.status}: ${rawText.slice(0, 320)}`,
        toolKind,
        reasoningEffort: reasoningEffort || null,
        ok: false,
        requestUrl: url.replace(/\?.*$/, "")
      };
    }

    const parsed = parseResponsesPayload(rawText);
    if (parsed.content || (parsed.citations && parsed.citations.length)) {
      return {
        content: parsed.content || "",
        citations: parsed.citations || [],
        toolTraces: parsed.toolTraces || [],
        raw: parsed.data,
        mode: parsed.via === "sse" ? "NATIVE_RESPONSES_SSE" : "NATIVE_RESPONSES",
        toolKind,
        reasoningEffort: reasoningEffort || null,
        ok: true,
        requestUrl: url.replace(/\?.*$/, ""),
        parseVia: parsed.via
      };
    }

    return {
      content: "",
      citations: parsed.citations || [],
      toolTraces: parsed.toolTraces || [],
      mode: "NATIVE_FAILED",
      error:
        parsed.error ||
        (looksLikeSse(rawText)
          ? "responses_sse_empty (stream parsed, no text/citations)"
          : "responses_empty_output"),
      toolKind,
      reasoningEffort: reasoningEffort || null,
      ok: false,
      raw: parsed.data || rawText.slice(0, 500)
    };
  } catch (e) {
    if (signal?.aborted) throw e;
    return {
      content: "",
      citations: [],
      toolTraces: [],
      mode: "NATIVE_FAILED",
      error: String(e.message || e),
      toolKind,
      reasoningEffort: reasoningEffort || null,
      ok: false
    };
  }
}

/**
 * Native web search: tool profiles × reasoning cascade + temperature.
 */
export async function chatWithNativeWebSearch({
  model,
  system,
  user,
  signal = null,
  temperature = DEFAULT_TEMP,
  isJson = false,
  unrestrictedWeb = false,
  reasoningEffort = "auto",
  onLog = null
}) {
  loadSettings();

  if (!String(model || "").trim()) {
    return {
      content: "",
      citations: [],
      toolTraces: [],
      mode: "NATIVE_FAILED",
      error: "no_model",
      toolKind: null
    };
  }

  const toolProfiles = buildToolProfileCascade(model, { unrestrictedWeb });
  const preferred = preferredReasoningEffort(model, reasoningEffort);
  const efforts = reasoningEffortCascade(preferred ?? "high");
  const attempts = [];
  let last = null;
  const temp = temperature == null ? DEFAULT_TEMP : temperature;

  for (const profile of toolProfiles) {
    for (const effort of efforts) {
      onLog?.(
        `Native Responses tools=${profile.kind} reason=${effort || "off"} temp=${temp}`
      );
      const result = await attemptNativeOnce({
        model,
        system,
        user,
        signal,
        tools: profile.tools,
        toolKind: profile.kind,
        temperature: temp,
        reasoningEffort: effort
      });
      last = result;
      attempts.push({
        tools: profile.kind,
        reasoning: effort || "off",
        ok: !!result.ok,
        error: result.error || null
      });

      if (result.ok && (result.content || result.citations?.length)) {
        let content = result.content || "";
        if (isJson && content) {
          try {
            content = extractJson(content);
          } catch {
            /* keep raw */
          }
        }
        return {
          ...result,
          content,
          mode: result.mode || "NATIVE_RESPONSES",
          reasoningEffort: effort || null,
          cascadeAttempts: attempts
        };
      }

      const err = result.error || "";
      if (/401|403|api key|unauthorized/i.test(err)) {
        return {
          content: "",
          citations: [],
          toolTraces: [],
          mode: "NATIVE_FAILED",
          error: err,
          toolKind: profile.kind,
          reasoningEffort: effort || null,
          cascadeAttempts: attempts
        };
      }
      // Drop reasoning level on param reject; else try next effort then next tool
      if (effort && shouldDropReasoningLevel(err)) {
        continue;
      }
      if (shouldTryNextToolProfile(err) || !result.ok) {
        // exhausted efforts for this tool → outer loop next profile
        if (!effort || effort === efforts[efforts.length - 1]) break;
        continue;
      }
    }
  }

  return {
    content: "",
    citations: [],
    toolTraces: [],
    mode: "NATIVE_FAILED",
    error: last?.error || "native_cascade_exhausted",
    toolKind: last?.toolKind || null,
    reasoningEffort: last?.reasoningEffort || null,
    cascadeAttempts: attempts
  };
}

function parseResponsesApi(data, isJson) {
  let content = data.output_text || data.content || "";
  if (!content && Array.isArray(data.output)) {
    const texts = [];
    for (const item of data.output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === "output_text" || c.type === "text") texts.push(c.text || "");
        }
      }
      if (item.type === "model_output" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.text) texts.push(c.text);
        }
      }
      // Some gateways put assistant text in output[].content string
      if (item.type === "message" && typeof item.content === "string") {
        texts.push(item.content);
      }
    }
    content = texts.join("\n");
  }
  if (!content && data.choices?.[0]?.message?.content) {
    content = data.choices[0].message.content;
  }
  if (typeof content !== "string") {
    content = Array.isArray(content)
      ? content.map((c) => c.text || c.content || "").join("")
      : content
        ? JSON.stringify(content)
        : "";
  }
  if (isJson && content) content = extractJson(content);
  return {
    content: content || "",
    citations: extractCitations(data),
    toolTraces: extractToolTraces(data),
    raw: data
  };
}

function extractCitations(data) {
  const out = [];
  if (Array.isArray(data.citations)) {
    for (const c of data.citations) {
      out.push({
        title: c.title || c.url || "",
        url: typeof c === "string" ? c : c.url || "",
        sourceTier: "media"
      });
    }
  }
  const walk = (obj) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    if (obj.type === "url_citation" && obj.url) {
      out.push({ title: obj.title || obj.url, url: obj.url, sourceTier: "media" });
    }
    if (obj.url && obj.title && obj.start_index != null) {
      out.push({ title: obj.title, url: obj.url, sourceTier: "media" });
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(data);
  const seen = new Set();
  return out.filter((c) => {
    const k = c.url || c.title;
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function extractToolTraces(data) {
  const traces = [];
  const walk = (obj) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    if (
      obj.type === "web_search_call" ||
      obj.type === "google_search_call" ||
      obj.type === "server_side_tool" ||
      obj.name === "web_search"
    ) {
      traces.push(obj);
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(data);
  if (data.server_side_tool_usage) traces.push({ usage: data.server_side_tool_usage });
  return traces;
}

/**
 * Hybrid research cascade:
 * 1) Native Responses web_search + reasoning cascade
 * 2) Jina search (+ optional page fetch)
 * 3) Google News RSS
 */
export async function hybridResearchSearch({
  model,
  queries,
  searchMode,
  signal,
  onLog,
  unrestrictedWeb = false,
  fetchPages = false,
  fetchLimit = 0
}) {
  loadSettings();
  const results = [];
  let pages = [];
  let nativeMode = null;
  let layer = "none";
  let usedNative = false;

  if (searchMode === "DEGRADED") {
    onLog?.("Search DEGRADED — skip web");
    return {
      results: [],
      pages: [],
      nativeMode: null,
      layer: "none",
      searchModeEffective: "DEGRADED"
    };
  }

  const tryNative =
    searchMode !== "FALLBACK" &&
    model &&
    modelSupportsNativeSearch(model) &&
    appSettings.preferNativeSearch !== false;

  if (tryNative) {
    onLog?.(
      `Native Responses web_search (${model}) · reasoning cascade · temp=${DEFAULT_TEMP}`
    );
    const system = `Financial research agent IDX. Use web_search tool. Return JSON only:
{"findings":[{"claim":"","sourceTier":"media|official|rumor|unknown","url":"","query":""}]}
Choose queries from the list; do not invent official filings.`;
    const user = `Search:\n${(queries || []).map((q, i) => `${i + 1}. ${q}`).join("\n")}`;
    const native = await chatWithNativeWebSearch({
      model,
      system,
      user,
      signal,
      isJson: true,
      unrestrictedWeb,
      onLog
    });
    nativeMode = native.mode;
    if (native.content) {
      try {
        const parsed =
          typeof native.content === "string" ? JSON.parse(native.content) : native.content;
        for (const f of parsed.findings || []) {
          results.push({
            title: f.claim || f.title || "",
            snippet: f.claim || "",
            url: f.url || "",
            sourceTier: f.sourceTier || "media",
            query: f.query || "",
            provider: "native-tool"
          });
          usedNative = true;
        }
      } catch {
        if (String(native.content).length > 40) {
          results.push({
            title: "native_search_prose",
            snippet: String(native.content).slice(0, 2000),
            url: "",
            provider: "native-tool"
          });
          usedNative = true;
        }
      }
    }
    for (const c of native.citations || []) {
      results.push({
        title: c.title,
        url: c.url,
        snippet: "",
        provider: "native-citation"
      });
      usedNative = true;
    }
    if (usedNative) {
      layer = "native-tools";
      onLog?.(`Native OK mode=${nativeMode} hits≈${results.length}`);
    } else {
      onLog?.(
        `Native gagal/tipis (${native.mode || "?"} ${native.error || ""}) → Jina + news`,
        "warn"
      );
    }
  } else if (searchMode === "FALLBACK") {
    onLog?.("FALLBACK mode — skip native, langsung Jina/news");
  }

  const skipServerPack = usedNative && results.length >= 6 && !fetchPages;
  if (!skipServerPack) {
    try {
      onLog?.(
        `Fallback: Jina search${fetchPages ? ` → fetch≤${fetchLimit}` : ""} → news gap`
      );
      const res = await fetch("/api/web/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queries: (queries || []).slice(0, 12),
          max_results: 4,
          jinaApiKey: appSettings.jinaApiKey || "",
          fetchPages: !!fetchPages && fetchLimit > 0,
          fetchLimit: fetchLimit || 0,
          max_characters: unrestrictedWeb ? 8000 : 5000
        }),
        signal
      });
      if (res.ok) {
        const data = await res.json();
        const serverLayer = data.layer || "none";
        for (const r of data.results || []) {
          results.push({
            title: r.title || "",
            url: r.url || "",
            snippet: r.snippet || "",
            sourceTier: r.sourceTier || "media",
            provider: r.provider || "web",
            query: r.query || ""
          });
        }
        if (Array.isArray(data.pages)) pages = data.pages;
        if (!usedNative) layer = serverLayer;
        else if (serverLayer !== "none") layer = `native+${serverLayer}`;
        onLog?.(
          `Server layer=${serverLayer} hits=${(data.results || []).length} pages=${pages.length}${data.error ? ` err=${data.error}` : ""}`
        );
      } else {
        const t = await res.text();
        onLog?.(`Server research HTTP ${res.status}: ${t.slice(0, 160)}`, "warn");
      }
    } catch (e) {
      onLog?.(`Server research error: ${e.message}`, "warn");
    }
  }

  // 3) Extra news if still thin
  if (results.length < 3) {
    try {
      const q = (queries || [])[0] || "IHSG";
      const res = await fetch(
        `/api/web/news?q=${encodeURIComponent(q)}&max_results=6`,
        { signal }
      );
      if (res.ok) {
        const data = await res.json();
        for (const r of data.results || []) {
          results.push({
            title: r.title || "",
            url: r.url || "",
            snippet: r.snippet || "",
            provider: "news-rss",
            sourceTier: "media"
          });
        }
        if (layer === "none") layer = "news-rss";
      }
    } catch {
      /* */
    }
  }

  // dedupe by url+title
  const seen = new Set();
  const deduped = [];
  for (const r of results) {
    const k = `${r.url || ""}|${r.title || ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }

  return {
    results: deduped,
    pages,
    nativeMode,
    layer,
    searchModeEffective: searchMode,
    usedNative
  };
}

export function researchModel() {
  return modelFor("research");
}
