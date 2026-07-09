/**
 * Native frontier web search (server-side tools).
 *
 * xAI Grok (docs): tools web_search via Responses API / SDK
 *   tools: [{ type: "web_search", allowed_domains?, excluded_domains? }]
 *
 * Gemini: tools: [{ type: "google_search" }] (grounding)
 *
 * Router OpenAI-compat may expose either:
 *   POST {base}/chat/completions  + tools
 *   POST {base}/responses         + tools  (OpenAI Responses API shape)
 *
 * Falls back to empty results so caller can use FALLBACK news search.
 */
import { resolveProviderCredentials, getProxyUrl, extractJson, modelFor } from "../ai.js";
import { appSettings, loadSettings } from "../state.js";

/** IDX / ID finance domains — xAI allows max 5 allowed_domains */
export const IDX_SEARCH_DOMAINS = [
  "idx.co.id",
  "cnbcindonesia.com",
  "kontan.co.id",
  "bisnis.com",
  "investing.com"
];

/**
 * Infer native search tool config from model id.
 * @returns {{ kind: 'xai_web_search'|'gemini_google_search'|'unknown', tools: object[] }}
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
      tools: [
        {
          type: "web_search",
          // keep focused on ID market sources when possible
          allowed_domains: IDX_SEARCH_DOMAINS
        }
      ]
    };
  }
  if (m.includes("gemini") || m.includes("google/")) {
    return {
      kind: "gemini_google_search",
      tools: [{ type: "google_search" }]
    };
  }
  // OpenAI / unknown — try web_search tool type (Responses API)
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) {
    return {
      kind: "openai_web_search",
      tools: [{ type: "web_search" }]
    };
  }
  return { kind: "unknown", tools: [{ type: "web_search" }] };
}

export function modelSupportsNativeSearch(model) {
  const { kind } = detectNativeSearchTool(model);
  return kind !== "unknown" || /grok|gemini|xai|gpt|o[134]/i.test(String(model || ""));
}

/**
 * Run one-shot research prompt with native web search tools.
 * Returns { content, citations[], toolTraces[], mode, raw }
 */
export async function chatWithNativeWebSearch({
  model,
  system,
  user,
  signal = null,
  temperature = 0.3,
  isJson = false,
  unrestrictedWeb = false
}) {
  loadSettings();
  const { endpoint, apiKey, useProxy } = resolveProviderCredentials();
  const toolCfg = detectNativeSearchTool(model);
  let tools = toolCfg.tools;
  if (unrestrictedWeb && toolCfg.kind === "xai_web_search") {
    // deep dive: full web, not only 5 domains
    tools = [{ type: "web_search" }];
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": typeof location !== "undefined" ? location.href : "",
    "X-Title": "IHSG Market Bot"
  };

  // --- Try Responses API first (xAI / OpenAI Responses shape) ---
  try {
    const base = endpoint.replace(/\/+$/, "");
    let url = base.endsWith("/v1") ? `${base}/responses` : `${base}/v1/responses`;
    // if base already is .../v1/something odd, still try /responses sibling
    if (useProxy) url = getProxyUrl(url);

    const input = [
      { role: "system", content: system },
      { role: "user", content: user }
    ];
    const body = {
      model,
      input,
      tools,
      temperature
    };
    // some gateways use messages instead of input
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    });
    if (res.ok) {
      const data = await res.json();
      const parsed = parseResponsesApi(data, isJson);
      if (parsed.content) {
        return { ...parsed, mode: "NATIVE_RESPONSES", toolKind: toolCfg.kind };
      }
    }
  } catch {
    /* try chat completions */
  }

  // --- Chat Completions + tools (server-side tools if gateway supports) ---
  try {
    let url = `${endpoint}/chat/completions`;
    if (useProxy) url = getProxyUrl(url);
    const body = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature,
      tools,
      tool_choice: "auto"
    };
    if (isJson) body.response_format = { type: "json_object" };

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`native search chat ${res.status}: ${t.slice(0, 240)}`);
    }
    const data = await res.json();
    let content = data.choices?.[0]?.message?.content || "";
    if (typeof content !== "string") {
      content = Array.isArray(content)
        ? content.map((c) => c.text || c.content || "").join("")
        : JSON.stringify(content);
    }
    if (isJson) content = extractJson(content);
    const citations = extractCitations(data);
    return {
      content,
      citations,
      toolTraces: extractToolTraces(data),
      mode: "NATIVE_CHAT",
      toolKind: toolCfg.kind,
      raw: data
    };
  } catch (e) {
    return {
      content: "",
      citations: [],
      toolTraces: [],
      mode: "NATIVE_FAILED",
      error: String(e.message || e),
      toolKind: toolCfg.kind
    };
  }
}

function parseResponsesApi(data, isJson) {
  // OpenAI Responses: output array / output_text
  let content =
    data.output_text ||
    data.content ||
    "";
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
    }
    content = texts.join("\n");
  }
  // xAI sometimes puts final in choices
  if (!content && data.choices?.[0]?.message?.content) {
    content = data.choices[0].message.content;
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
        url: c.url || c,
        sourceTier: "media"
      });
    }
  }
  // nested annotations
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
  // dedupe
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
 * Hybrid research: native tool search first when mode FULL / auto+capable;
 * always can merge FALLBACK snippets.
 */
export async function hybridResearchSearch({
  model,
  queries,
  searchMode,
  signal,
  onLog,
  unrestrictedWeb = false
}) {
  loadSettings();
  const results = [];
  let nativeMode = null;

  const wantNative =
    searchMode === "FULL" ||
    (searchMode === "auto" && modelSupportsNativeSearch(model)) ||
    (searchMode === "FALLBACK" && appSettings.preferNativeSearch && modelSupportsNativeSearch(model));

  // Actually for FALLBACK we keep free news; FULL forces native
  const useNative = searchMode === "FULL" || (searchMode === "auto" && modelSupportsNativeSearch(model));

  if (useNative && searchMode !== "DEGRADED") {
    onLog?.(`Native web search via model tools (${model})…`);
    const system = `You are a financial research agent for Indonesia IDX stocks.
Use web search tools intensively. Find recent, verifiable facts.
Return ONLY a JSON object:
{
  "findings": [{"claim":"","sourceTier":"official|media|rumor|unknown","url":"","query":""}],
  "notes": ""
}`;
    const user = `Run web searches for these queries and extract findings (max 3 per query):\n${(queries || [])
      .map((q, i) => `${i + 1}. ${q}`)
      .join("\n")}`;

    const native = await chatWithNativeWebSearch({
      model,
      system,
      user,
      signal,
      isJson: true,
      unrestrictedWeb
    });
    nativeMode = native.mode;
    if (native.error) onLog?.(`Native search note: ${native.error}`, "warn");

    if (native.content) {
      try {
        const parsed = typeof native.content === "string" ? JSON.parse(native.content) : native.content;
        for (const f of parsed.findings || []) {
          results.push({
            title: f.claim || f.title || "",
            snippet: f.claim || "",
            url: f.url || "",
            sourceTier: f.sourceTier || "media",
            query: f.query || "",
            provider: "native-tool"
          });
        }
      } catch {
        // treat as prose blob
        results.push({
          title: "native_search_prose",
          snippet: String(native.content).slice(0, 2000),
          url: "",
          sourceTier: "unknown",
          provider: "native-tool"
        });
      }
    }
    for (const c of native.citations || []) {
      results.push({
        title: c.title,
        url: c.url,
        snippet: "",
        sourceTier: "media",
        provider: "native-citation"
      });
    }
    onLog?.(
      `Native search mode=${native.mode} findings=${results.length} tools=${native.toolKind}`
    );
  }

  // FALLBACK free search if native empty or mode FALLBACK or auto hybrid
  const needFallback =
    searchMode === "FALLBACK" ||
    searchMode === "auto" ||
    (useNative && results.length < 3);

  if (searchMode !== "DEGRADED" && needFallback) {
    onLog?.("Fallback free news search…");
    for (const q of queries || []) {
      if (signal?.aborted) break;
      try {
        const res = await fetch("/api/search/ddg?q=" + encodeURIComponent(q) + "&n=4", {
          signal
        });
        if (!res.ok) continue;
        const data = await res.json();
        for (const r of data.results || []) {
          results.push({ ...r, query: q, provider: r.provider || "google-news-rss" });
        }
      } catch {
        /* */
      }
    }
  }

  // dedupe
  const seen = new Set();
  const deduped = results.filter((r) => {
    const k = (r.url || "") + "|" + (r.title || r.snippet || "").slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    results: deduped,
    nativeMode,
    searchModeEffective:
      useNative && nativeMode && nativeMode !== "NATIVE_FAILED"
        ? "FULL"
        : searchMode === "DEGRADED"
          ? "DEGRADED"
          : "FALLBACK"
  };
}

export function researchModel() {
  return modelFor("research");
}
