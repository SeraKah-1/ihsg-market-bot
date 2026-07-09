/**
 * Slim custom-router client (OpenAI-compatible). Personal use.
 * Reasoning cascade; temperature always OMITTED.
 */
import { appSettings, loadSettings } from "./state.js";
import {
  injectReasoningParams,
  preferredReasoningEffort,
  reasoningEffortCascade,
  shouldDropReasoningLevel,
  modelLooksReasoning
} from "./search/reasoning.js";

loadSettings();

/** @deprecated always omit temperature — kept for call-site compat */
export const DEFAULT_TEMP = null;
export const REPAIR_TEMP = null;

function normalizeEndpoint(endpoint) {
  if (!endpoint) return "";
  return endpoint.replace(/\/chat\/completions$/, "").replace(/\/$/, "");
}

export function getProxyUrl(target) {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3010";
  return `${origin}/api/cors-proxy?url=${encodeURIComponent(target)}`;
}

export function resolveProviderCredentials() {
  const endpoint = normalizeEndpoint(appSettings.customEndpoint || "");
  const apiKey = appSettings.customApiKey || "";
  if (!endpoint) throw new Error("Custom endpoint kosong. Isi di Settings.");
  if (!apiKey) throw new Error("API key kosong. Isi di Settings.");
  const isLocal = endpoint.includes("localhost") || endpoint.includes("127.0.0.1");
  return {
    endpoint,
    apiKey,
    useProxy: !!appSettings.useCorsProxy && !isLocal
  };
}

/**
 * Strip fences / noise and extract a JSON object/array substring (best effort).
 * Returns string; may still be invalid — prefer parseJsonLoose().
 */
export function extractJson(text) {
  if (text == null) return text;
  if (typeof text === "object") return JSON.stringify(text);
  let s = String(text).trim();
  // strip BOM / zero-width
  s = s.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
  // markdown fences (anywhere)
  s = s.replace(/```(?:json|JSON)?\s*/g, "").replace(/```/g, "").trim();
  // model sometimes dumps "html <web_...>" prefixes before JSON
  s = s.replace(/^html\s*/i, "").trim();
  // strip leading citation/tool tags like <web_search> or <web:1>
  s = s.replace(/^<web[_a-z0-9:.-]*>\s*/i, "").trim();

  // Prefer balanced {...} or [...]
  const obj = extractBalancedJson(s, "{", "}");
  if (obj) return obj;
  const arr = extractBalancedJson(s, "[", "]");
  if (arr) return arr;

  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) return s.slice(start, end + 1);
  return s;
}

/**
 * Extract first balanced JSON object/array by brace matching (handles nested).
 */
export function extractBalancedJson(text, openCh = "{", closeCh = "}") {
  const s = String(text || "");
  const start = s.indexOf(openCh);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === "\\") {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse model output that may be polluted with HTML / web_ tags / fences.
 * @returns {object|array|null}
 */
export function parseJsonLoose(text) {
  if (text == null || text === "") return null;
  if (typeof text === "object") return text;

  const candidates = [];
  const raw = String(text);
  candidates.push(extractJson(raw));

  // try each {...} block if multiple
  const re = /\{[\s\S]*?\}/g;
  let m;
  let n = 0;
  while ((m = re.exec(raw)) && n < 8) {
    candidates.push(m[0]);
    n++;
  }
  // longer balanced object first
  const bal = extractBalancedJson(raw, "{", "}");
  if (bal) candidates.unshift(bal);

  const seen = new Set();
  for (const c of candidates) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    try {
      return JSON.parse(c);
    } catch {
      /* try next */
    }
    // trailing comma / soft fix
    try {
      const soft = String(c)
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/'/g, '"');
      return JSON.parse(soft);
    } catch {
      /* */
    }
  }
  return null;
}

/**
 * If model dumped HTML / web snippets instead of JSON, pull claim-like findings.
 */
export function salvageFindingsFromText(text) {
  const s = String(text || "");
  if (!s.trim()) return [];
  const findings = [];
  const urlRe = /https?:\/\/[^\s"'<>)\]]+/gi;
  const urls = [...new Set((s.match(urlRe) || []).map((u) => u.replace(/[.,;]+$/, "")))];
  for (const url of urls.slice(0, 20)) {
    // grab nearby text window as claim
    const idx = s.indexOf(url);
    const window = s.slice(Math.max(0, idx - 120), Math.min(s.length, idx + url.length + 80));
    const claim = window
      .replace(url, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    findings.push({
      claim: claim || url,
      url,
      sourceTier: "media",
      query: ""
    });
  }
  // title-ish lines if no urls
  if (!findings.length) {
    const lines = s
      .split(/\n+/)
      .map((l) => l.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .filter((l) => l.length > 40 && l.length < 280 && !/^html\b/i.test(l));
    for (const line of lines.slice(0, 12)) {
      findings.push({ claim: line, url: "", sourceTier: "unknown", query: "" });
    }
  }
  return findings;
}

/**
 * Single chat/completions attempt (optional reasoning fields already on body).
 */
function isTransientNetworkError(e) {
  const m = String(e?.message || e || "");
  return (
    e?.name === "TypeError" ||
    /Failed to fetch|NetworkError|network|ECONNRESET|ETIMEDOUT|fetch failed|Load failed/i.test(
      m
    )
  );
}

/**
 * Abortable timeout that does NOT abort the parent signal permanently.
 * Parent abort still cancels the request.
 */
function withTimeoutSignal(parentSignal, ms) {
  const ctrl = new AbortController();
  const onParent = () => ctrl.abort();
  if (parentSignal) {
    if (parentSignal.aborted) ctrl.abort();
    else parentSignal.addEventListener("abort", onParent, { once: true });
  }
  const timer =
    ms > 0
      ? setTimeout(() => {
          try {
            ctrl.abort();
          } catch {
            /* */
          }
        }, ms)
      : null;
  return {
    signal: ctrl.signal,
    cleanup() {
      if (timer) clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener("abort", onParent);
    },
    timedOut: () => ms > 0 && ctrl.signal.aborted && !parentSignal?.aborted
  };
}

/**
 * Consume chat/completions response — streaming (Cognitive Sandbox pattern) or JSON.
 * Local routers often hang on stream:false + reasoning; stream:true always progresses.
 */
async function consumeChatCompletionResponse(
  res,
  { isJson = false, onLog = null, preferStream = true } = {}
) {
  const ct = (res.headers.get("content-type") || "").toLowerCase();

  // Non-stream JSON body (only when we did not ask for stream)
  if (
    !preferStream &&
    res.body &&
    ct.includes("application/json") &&
    !ct.includes("event-stream")
  ) {
    const data = await res.json();
    let content = data.choices?.[0]?.message?.content || "";
    if (isJson) content = extractJson(content);
    return {
      content,
      raw: data,
      reasoning:
        data.choices?.[0]?.message?.reasoning_content ||
        data.choices?.[0]?.message?.reasoning ||
        "",
      streamed: false
    };
  }

  // SSE / byte stream accumulation (CS: callOpenRouterStream)
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let fullReasoning = "";
    let buffer = "";
    let chunks = 0;

    const handleDataLine = (trimmed) => {
      if (!trimmed.startsWith("data:") || trimmed === "data: [DONE]") return;
      try {
        const data = JSON.parse(trimmed.slice(5).trim());
        const delta = data.choices?.[0]?.delta;
        const msg = data.choices?.[0]?.message;
        const content = delta?.content || msg?.content || "";
        const reasoning =
          delta?.reasoning_content ||
          delta?.reasoning ||
          delta?.thinking ||
          msg?.reasoning_content ||
          msg?.reasoning ||
          "";
        if (content) fullContent += content;
        if (reasoning) fullReasoning += reasoning;
        chunks++;
      } catch {
        /* skip bad chunk */
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Non-SSE whole JSON dumped mid-stream
        if (trimmed.startsWith("{") && trimmed.includes("choices")) {
          try {
            const data = JSON.parse(trimmed);
            const c = data.choices?.[0]?.message?.content || data.choices?.[0]?.delta?.content || "";
            if (c) fullContent += c;
            chunks++;
            continue;
          } catch {
            /* */
          }
        }
        handleDataLine(trimmed);
      }
      if (chunks > 0 && chunks % 40 === 0) {
        onLog?.(`LLM stream… ${fullContent.length} chars`);
      }
    }
    if (buffer.trim()) handleDataLine(buffer.trim());

    // Fallback: entire body was non-stream JSON in buffer path
    if (!fullContent && buffer.trim().startsWith("{")) {
      try {
        const data = JSON.parse(buffer);
        fullContent = data.choices?.[0]?.message?.content || "";
        fullReasoning =
          data.choices?.[0]?.message?.reasoning_content ||
          data.choices?.[0]?.message?.reasoning ||
          "";
      } catch {
        /* */
      }
    }

    let content = fullContent;
    if (isJson) content = extractJson(content);
    return {
      content,
      raw: { streamed: true, chunks },
      reasoning: fullReasoning,
      streamed: true
    };
  }

  // text body
  const bodyText = await res.text();
  if (bodyText.trim().startsWith("data:")) {
    // CS non-stream handler: reconstruct SSE from full text
    let reconstructed = "";
    for (const line of bodyText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (trimmed.startsWith("data:")) {
        try {
          const chunkJson = JSON.parse(trimmed.replace(/^data:\s*/, ""));
          reconstructed +=
            chunkJson.choices?.[0]?.delta?.content ||
            chunkJson.choices?.[0]?.message?.content ||
            "";
        } catch {
          /* */
        }
      }
    }
    let content = reconstructed;
    if (isJson) content = extractJson(content);
    return { content, raw: { reconstructedSse: true }, reasoning: "", streamed: true };
  }

  const data = JSON.parse(bodyText.replace(/data:\s*\[DONE\]/g, ""));
  let content = data.choices?.[0]?.message?.content || "";
  if (isJson) content = extractJson(content);
  return {
    content,
    raw: data,
    reasoning:
      data.choices?.[0]?.message?.reasoning_content ||
      data.choices?.[0]?.message?.reasoning ||
      "",
    streamed: false
  };
}

async function chatCompleteOnce({
  model,
  messages,
  isJson = false,
  signal = null,
  temperature: _temperature = null,
  reasoningEffort = null,
  retries = 2,
  timeoutMs = 180_000,
  onLog = null,
  /** Cognitive Sandbox: always stream on custom routers */
  stream = true
}) {
  void _temperature; // product: never send temperature
  const { endpoint, apiKey, useProxy } = resolveProviderCredentials();
  let targetUrl = `${endpoint}/chat/completions`;
  if (useProxy) targetUrl = getProxyUrl(targetUrl);

  // Cap payload — huge messages often kill proxy mid-flight → Failed to fetch
  const maxMsg = 48_000;
  const bodyMessages = messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string" && m.content.length > maxMsg
        ? m.content.slice(0, maxMsg) + "\n…[truncated for transport]"
        : m.content
  }));

  const approxBytes = JSON.stringify(bodyMessages).length;
  // CS pattern: only attach reasoning params for known reasoning SKUs.
  // Injecting reasoning_effort on plain grok-4.5 via chat/completions often hangs non-stream.
  const attachReason =
    reasoningEffort &&
    (modelLooksReasoning(model) ||
      /o1|o3|o4|r1|reason|think|qwq|kimi/i.test(String(model || "")));

  onLog?.(
    `LLM request → ${model} · ~${Math.round(approxBytes / 1024)}KB · stream=${stream} · reason=${attachReason ? reasoningEffort : "off"} · timeout=${timeoutMs}ms`
  );

  const body = {
    model,
    messages: bodyMessages,
    stream: !!stream
  };
  // Prefer json_object; some routers reject it — cascade drops on 400
  if (isJson) body.response_format = { type: "json_object" };
  if (attachReason) injectReasoningParams(body, model, reasoningEffort);

  let lastErr = null;
  let dropJsonFormatTried = false;
  let dropStreamTried = false;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const to = withTimeoutSignal(signal, timeoutMs);
    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": typeof location !== "undefined" ? location.href : "",
          "X-Title": "IHSG Market Bot",
          Accept: stream ? "text/event-stream, application/json" : "application/json"
        },
        body: JSON.stringify(body),
        signal: to.signal
      });

      if (!res.ok) {
        const t = await res.text();
        to.cleanup();
        // drop response_format if router hates it
        if (
          isJson &&
          body.response_format &&
          !dropJsonFormatTried &&
          /response_format|json_object|unsupported|unknown/i.test(t) &&
          (res.status === 400 || res.status === 422)
        ) {
          delete body.response_format;
          dropJsonFormatTried = true;
          onLog?.("response_format ditolak → retry tanpa json_object");
          attempt -= 1;
          continue;
        }
        // some routers reject stream
        if (
          body.stream &&
          !dropStreamTried &&
          /stream|unsupported/i.test(t) &&
          (res.status === 400 || res.status === 422)
        ) {
          body.stream = false;
          dropStreamTried = true;
          onLog?.("stream ditolak → retry non-stream");
          attempt -= 1;
          continue;
        }
        throw new Error(`LLM ${res.status}: ${t.slice(0, 400)}`);
      }

      const parsed = await consumeChatCompletionResponse(res, {
        isJson,
        onLog,
        preferStream: !!body.stream
      });
      to.cleanup();
      if (!parsed.content || !String(parsed.content).trim()) {
        throw new Error("LLM empty content (stream ended with 0 chars)");
      }
      onLog?.(
        `LLM OK · ${model} · content≈${String(parsed.content || "").length} chars · ${parsed.streamed ? "sse" : "json"}`
      );
      return {
        content: parsed.content,
        raw: parsed.raw,
        reasoning: parsed.reasoning || "",
        reasoningEffort: attachReason ? reasoningEffort : null
      };
    } catch (e) {
      to.cleanup();
      lastErr = e;
      if (signal?.aborted) throw e;
      if (to.timedOut()) {
        lastErr = new Error(`LLM timeout ${timeoutMs}ms model=${model}`);
        onLog?.(String(lastErr.message), "err");
        // On timeout with stream already on: drop reasoning and retry once
        if (attachReason && body.reasoning_effort) {
          delete body.reasoning_effort;
          delete body.reasoning;
          delete body.thinkingConfig;
          delete body.thinking;
          delete body.generationConfig;
          onLog?.("timeout → strip reasoning params, retry stream", "warn");
          attempt -= 1;
          retries = Math.max(retries, attempt + 1);
          continue;
        }
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
        throw lastErr;
      }
      if (isTransientNetworkError(e) && attempt < retries) {
        onLog?.(`LLM network retry ${attempt + 1}: ${String(e.message || e).slice(0, 80)}`, "warn");
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("chatCompleteOnce failed");
}

/**
 * Non-stream chat completion with reasoning cascade high→med→low→off.
 */
export async function chatComplete({
  model,
  messages,
  isJson = false,
  signal = null,
  temperature: _temperature = null,
  reasoningEffort = "auto",
  onLog = null,
  timeoutMs = 120_000
}) {
  void _temperature;
  const preferred = preferredReasoningEffort(model, reasoningEffort);
  // CS-style: for non-reasoning SKUs, skip effort cascade (params not attached anyway)
  const looksReason = modelLooksReasoning(model);
  const efforts = looksReason
    ? reasoningEffortCascade(preferred ?? "medium")
    : [null]; // plain grok/gpt via chat/completions — no reasoning hang
  let lastErr = null;

  for (let i = 0; i < efforts.length; i++) {
    const effort = efforts[i];
    const hasLower = i < efforts.length - 1;
    // Streaming can run longer; CS has no hard 120s wall on stream
    const effortTimeout =
      effort === "high"
        ? Math.min(timeoutMs, 90_000)
        : effort === "medium"
          ? Math.min(timeoutMs, 120_000)
          : Math.max(timeoutMs, 150_000);
    try {
      onLog?.(
        `chatComplete model=${model} stream=true reason=${effort || "off"} timeout=${effortTimeout}ms`
      );
      return await chatCompleteOnce({
        model,
        messages,
        isJson,
        signal,
        temperature: null,
        reasoningEffort: effort,
        timeoutMs: effortTimeout,
        onLog,
        stream: true,
        retries: 1
      });
    } catch (e) {
      lastErr = e;
      if (signal?.aborted) throw e;
      const msg = String(e?.message || e || "");
      const isTimeout = /timeout/i.test(msg);
      if (shouldDropReasoningLevel(e) && effort && hasLower) {
        onLog?.(`reason=${effort} ditolak → turun cascade: ${msg.slice(0, 120)}`);
        continue;
      }
      if (isTimeout && effort && hasLower) {
        onLog?.(
          `reason=${effort} timeout → coba effort lebih ringan (CS cascade)`,
          "warn"
        );
        continue;
      }
      if (effort && hasLower && /400|422|unknown|unrecognized|parameter|Failed to fetch/i.test(msg)) {
        onLog?.(`reason=${effort} error → cascade: ${msg.slice(0, 100)}`, "warn");
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("chatComplete cascade exhausted");
}

export async function chatJson({
  model,
  system,
  user,
  signal,
  temperature: _temperature = null,
  reasoningEffort = "auto",
  onLog = null,
  timeoutMs = 120_000
}) {
  void _temperature;
  // Harden sizes before network — main Writer bottleneck was huge system+user
  const sys =
    typeof system === "string" && system.length > 28_000
      ? system.slice(0, 28_000) + "\n…[system truncated]"
      : system;
  const usr =
    typeof user === "string" && user.length > 40_000
      ? user.slice(0, 40_000) + "\n…[user truncated]"
      : user;
  onLog?.(
    `chatJson start · sys≈${String(sys || "").length} user≈${String(usr || "").length}`
  );
  const messages = [
    {
      role: "system",
      content:
        sys +
        "\n\nOutput HARUS JSON valid murni. Tanpa markdown fence, tanpa prosa di luar JSON."
    },
    { role: "user", content: usr }
  ];
  const { content, reasoningEffort: used } = await chatComplete({
    model,
    messages,
    isJson: true,
    signal,
    temperature: null,
    reasoningEffort,
    onLog,
    timeoutMs
  });
  // Prefer loose parse first (handles fence / html prefix)
  let parsed = parseJsonLoose(content);
  if (parsed && typeof parsed === "object") {
    parsed.__meta = { ...(parsed.__meta || {}), reasoningEffort: used };
    return parsed;
  }
  try {
    parsed = JSON.parse(content);
    parsed.__meta = { ...(parsed.__meta || {}), reasoningEffort: used };
    return parsed;
  } catch (e) {
    const repair = await chatComplete({
      model,
      messages: [
        {
          role: "system",
          content: "Perbaiki jadi JSON valid saja. Tidak ada teks lain."
        },
        { role: "user", content: String(content || "").slice(0, 60_000) }
      ],
      isJson: true,
      signal,
      temperature: null,
      reasoningEffort: "off",
      onLog
    });
    const fixed = parseJsonLoose(repair.content) || JSON.parse(repair.content);
    if (fixed && typeof fixed === "object") {
      fixed.__meta = { ...(fixed.__meta || {}), reasoningEffort: used, repaired: true };
    }
    return fixed;
  }
}

export function modelFor(role) {
  loadSettings();
  const m = appSettings.models || {};
  // new roles + legacy aliases
  if (role === "analysis") return m.analysis || m.judge || m.research || "gpt-4o-mini";
  if (role === "writer" || role === "verify") {
    return m.writer || m.verify || m.judge || m.analysis || m.research || "gpt-4o-mini";
  }
  if (role === "research" || role === "researcher") {
    return m.research || m.researcher || "gpt-4o-mini";
  }
  if (role === "judge") return m.analysis || m.judge || "gpt-4o-mini";
  if (role === "fear" || role === "positive") return m.analysis || m[role] || "gpt-4o-mini";
  return m[role] || m.analysis || m.judge || "gpt-4o-mini";
}

/**
 * GET {endpoint}/models — OpenAI-compatible list.
 */
export async function fetchModels(signal = null) {
  loadSettings();
  const { endpoint, apiKey, useProxy } = resolveProviderCredentials();
  let targetUrl = `${endpoint}/models`;
  if (useProxy) targetUrl = getProxyUrl(targetUrl);

  const res = await fetch(targetUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "HTTP-Referer": typeof location !== "undefined" ? location.href : "",
      "X-Title": "IHSG Market Bot"
    },
    signal
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Models ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const list = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data)
      ? data
      : Array.isArray(data?.models)
        ? data.models
        : [];
  const ids = [
    ...new Set(
      list
        .map((m) => (typeof m === "string" ? m : m.id || m.name || m.model))
        .filter(Boolean)
        .map(String)
    )
  ].sort((a, b) => a.localeCompare(b));
  return ids;
}
