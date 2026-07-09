/**
 * Native web search for ALL models (default try).
 *
 * Cascades:
 *   reasoning: high → medium → low → off
 *   tools:     model-preferred → web_search → google_search → web_search+google_search
 *   transport: /v1/responses → /chat/completions
 *
 * Outer layers (hybrid): native → Jina search → Google News RSS
 */
import { resolveProviderCredentials, getProxyUrl, extractJson, modelFor } from "../ai.js";
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
 * Infer preferred native search tool config from model id (hint only).
 * Unknown models still get web_search tried via cascade.
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
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("o4")) {
    return {
      kind: "openai_web_search",
      tools: [{ type: "web_search" }]
    };
  }
  // Default try OpenAI-style web_search for every model
  return { kind: "generic_web_search", tools: [{ type: "web_search" }] };
}

/**
 * Product policy: always try native tools for any non-empty model id.
 * Actual support is discovered at runtime via cascade soft-fail.
 */
export function modelSupportsNativeSearch(model) {
  return !!String(model || "").trim();
}

/**
 * Ordered tool profiles to attempt (deduped by JSON).
 */
export function buildToolProfileCascade(model, { unrestrictedWeb = false } = {}) {
  const preferred = detectNativeSearchTool(model);
  let first = preferred.tools;
  if (unrestrictedWeb) {
    // drop domain filters for deep dive
    first = first.map((t) => {
      if (t && t.type === "web_search") return { type: "web_search" };
      return t;
    });
  }
  const profiles = [
    { kind: preferred.kind, tools: first },
    { kind: "web_search", tools: [{ type: "web_search" }] },
    { kind: "google_search", tools: [{ type: "google_search" }] },
    {
      kind: "web_search+google_search",
      tools: [{ type: "web_search" }, { type: "google_search" }]
    }
  ];
  // dedupe by tools JSON
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
 * Single attempt: one tool profile + one reasoning effort.
 * @private
 */
async function attemptNativeOnce({
  model,
  system,
  user,
  signal,
  temperature,
  isJson,
  tools,
  toolKind,
  reasoningEffort
}) {
  const { endpoint, apiKey, useProxy } = resolveProviderCredentials();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": typeof location !== "undefined" ? location.href : "",
    "X-Title": "IHSG Market Bot"
  };

  // --- Responses API ---
  try {
    const base = endpoint.replace(/\/+$/, "");
    let url = base.endsWith("/v1") ? `${base}/responses` : `${base}/v1/responses`;
    if (useProxy) url = getProxyUrl(url);

    const body = injectReasoningParams(
      {
        model,
        input: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        tools,
        temperature
      },
      model,
      reasoningEffort
    );
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
        return {
          ...parsed,
          mode: "NATIVE_RESPONSES",
          toolKind,
          reasoningEffort,
          ok: true
        };
      }
    } else {
      const t = await res.text();
      if (res.status >= 400) {
        return {
          content: "",
          citations: [],
          toolTraces: [],
          mode: "NATIVE_FAILED",
          error: `responses ${res.status}: ${t.slice(0, 280)}`,
          toolKind,
          reasoningEffort,
          ok: false
        };
      }
    }
  } catch (e) {
    // fall through to chat
    if (signal?.aborted) throw e;
  }

  // --- Chat Completions ---
  try {
    let url = `${endpoint}/chat/completions`;
    if (useProxy) url = getProxyUrl(url);
    const body = injectReasoningParams(
      {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature,
        tools,
        tool_choice: "auto"
      },
      model,
      reasoningEffort
    );
    if (isJson) body.response_format = { type: "json_object" };

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    });
    if (!res.ok) {
      const t = await res.text();
      return {
        content: "",
        citations: [],
        toolTraces: [],
        mode: "NATIVE_FAILED",
        error: `native search chat ${res.status}: ${t.slice(0, 280)}`,
        toolKind,
        reasoningEffort,
        ok: false
      };
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
    const reasoning =
      data.choices?.[0]?.message?.reasoning_content ||
      data.choices?.[0]?.message?.reasoning ||
      "";
    return {
      content,
      citations,
      toolTraces: extractToolTraces(data),
      mode: "NATIVE_CHAT",
      toolKind,
      raw: data,
      reasoning,
      reasoningEffort,
      ok: true
    };
  } catch (e) {
    return {
      content: "",
      citations: [],
      toolTraces: [],
      mode: "NATIVE_FAILED",
      error: String(e.message || e),
      toolKind,
      reasoningEffort,
      ok: false
    };
  }
}

/**
 * Run with full cascades (default for all models):
 * for each tool profile × reasoning high→med→low→off until content ok.
 */
export async function chatWithNativeWebSearch({
  model,
  system,
  user,
  signal = null,
  temperature = 0.3,
  isJson = false,
  unrestrictedWeb = false,
  /** "auto" | "high" | "medium" | "low" | "off" | null | concrete level */
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
  const startEffort = preferredReasoningEffort(model, reasoningEffort);
  const efforts = reasoningEffortCascade(startEffort || "high");

  const attempts = [];
  let last = null;

  for (const profile of toolProfiles) {
    for (const effort of efforts) {
      onLog?.(
        `Native try tools=${profile.kind} reason=${effort || "off"}`
      );
      const result = await attemptNativeOnce({
        model,
        system,
        user,
        signal,
        temperature,
        isJson,
        tools: profile.tools,
        toolKind: profile.kind,
        reasoningEffort: effort
      });
      last = result;
      attempts.push({
        tools: profile.kind,
        reasoning: effort || "off",
        ok: !!result.ok,
        error: result.error || null
      });

      if (result.ok && result.content) {
        return {
          ...result,
          mode: result.mode,
          cascadeAttempts: attempts
        };
      }

      const err = result.error || "";
      // Reasoning rejected → next lower effort (same tools)
      if (effort && shouldDropReasoningLevel(err)) {
        continue;
      }
      // Tool/API rejected this profile → skip remaining efforts for this profile, next tools
      if (shouldTryNextToolProfile(err)) {
        break;
      }
      // Empty content but 200? try next effort then next tools
      if (!result.content && !err) {
        continue;
      }
      // Auth errors: abort cascade
      if (/401|403|api key|unauthorized/i.test(err)) {
        return {
          content: "",
          citations: [],
          toolTraces: [],
          mode: "NATIVE_FAILED",
          error: err,
          toolKind: profile.kind,
          cascadeAttempts: attempts
        };
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
    }
    content = texts.join("\n");
  }
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
 * Hybrid research cascade (all modes except DEGRADED):
 * 1) Native tools (any model) + reasoning cascade inside chatWithNativeWebSearch
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

  // 1) Native first for ALL models unless explicit FALLBACK (user wants pack-only)
  const tryNative =
    searchMode !== "FALLBACK" &&
    model &&
    modelSupportsNativeSearch(model) &&
    appSettings.preferNativeSearch !== false;

  if (tryNative) {
    onLog?.(`Native web tools first (${model}) · reason cascade high→…→off`);
    const system = `Financial research agent IDX. Use web search tools when available. Return JSON only:
{"findings":[{"claim":"","sourceTier":"media|official|rumor|unknown","url":"","query":""}]}
Reason first from context; choose queries dynamically. If tools unavailable, still return best-effort JSON from knowledge but mark sourceTier unknown.`;
    const user = `Search:\n${(queries || []).map((q, i) => `${i + 1}. ${q}`).join("\n")}`;
    const native = await chatWithNativeWebSearch({
      model,
      system,
      user,
      signal,
      isJson: true,
      unrestrictedWeb,
      reasoningEffort: "auto",
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
      onLog?.(
        `Native OK mode=${nativeMode} reason=${native.reasoningEffort || "off"} hits≈${results.length}`
      );
    } else {
      onLog?.(
        `Native gagal/tipis (${native.mode || "?"} ${native.error || ""}) → Jina + news`,
        "warn"
      );
    }
  } else if (searchMode === "FALLBACK") {
    onLog?.("FALLBACK mode — skip native, langsung Jina/news");
  }

  // 2) Jina search (+ fetch) — always enrich unless we have plenty of native hits
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
        if (data.pages?.length) pages = data.pages;
        if (serverLayer !== "none") {
          layer =
            layer === "none"
              ? serverLayer
              : layer.includes(serverLayer)
                ? layer
                : `${layer}+${serverLayer}`;
        }
        onLog?.(
          `Server layer=${serverLayer} hits=${results.length} pages=${pages.length}` +
            (data.hasJinaKey === false ? " (no JINA key)" : "") +
            (data.errors?.length ? ` err=${data.errors[0]}` : "")
        );
      } else {
        onLog?.(`Web research HTTP ${res.status}`, "warn");
      }
    } catch (e) {
      onLog?.(`Web research failed: ${e.message || e}`, "warn");
    }
  }

  // 3) News RSS guarantee
  if (results.length < 2 && searchMode !== "DEGRADED") {
    onLog?.("Filling with free news RSS…");
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
    if (results.length) {
      layer =
        layer === "none" ? "news-rss" : layer.includes("news-rss") ? layer : layer + "+news-rss";
    }
  }

  const seen = new Set();
  const deduped = results.filter((r) => {
    const k = (r.url || "") + "|" + (r.title || r.snippet || "").slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const effective =
    searchMode === "DEGRADED"
      ? "DEGRADED"
      : layer.includes("native") || layer.includes("jina-search")
        ? "FULL"
        : "FALLBACK";

  return {
    results: deduped,
    pages,
    nativeMode,
    layer,
    searchModeEffective: effective
  };
}

export function researchModel() {
  return modelFor("research");
}
