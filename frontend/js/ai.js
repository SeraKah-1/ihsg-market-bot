/**
 * Slim custom-router client (OpenAI-compatible). Personal use.
 * Reasoning cascade; temperature always OMITTED.
 */
import { appSettings, loadSettings } from "./state.js";
import {
  injectReasoningParams,
  preferredReasoningEffort,
  reasoningEffortCascade,
  shouldDropReasoningLevel
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

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.(
      "abort",
      () => {
        clearTimeout(t);
        reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      },
      { once: true }
    );
  });
}

function isNetworkFetchError(e) {
  const m = String(e?.message || e || "");
  return (
    /Failed to fetch|NetworkError|network error|Load failed|ECONNRESET|ECONNREFUSED|fetch failed|AbortError.*timeout/i.test(
      m
    ) || e?.name === "TypeError"
  );
}

function messagesToInput(messages) {
  // Responses API: prefer single user blob (custom routers often strip multi-role)
  const parts = (messages || []).map((m) => {
    const role = m.role || "user";
    const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    if (role === "system") return `SYSTEM:\n${c}`;
    if (role === "assistant") return `ASSISTANT:\n${c}`;
    return `USER:\n${c}`;
  });
  return [{ role: "user", content: parts.join("\n\n") }];
}

function extractTextFromResponsesData(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.output_text === "string" && data.output_text) return data.output_text;
  if (typeof data.content === "string" && data.content) return data.content;
  const texts = [];
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item?.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === "output_text" || c?.type === "text") texts.push(c.text || "");
          else if (typeof c?.text === "string") texts.push(c.text);
        }
      }
      if (typeof item?.content === "string") texts.push(item.content);
      if (item?.type === "model_output" && Array.isArray(item.content)) {
        for (const c of item.content) if (c?.text) texts.push(c.text);
      }
    }
  }
  if (data.choices?.[0]?.message?.content) {
    const c = data.choices[0].message.content;
    texts.push(typeof c === "string" ? c : JSON.stringify(c));
  }
  return texts.filter(Boolean).join("\n");
}

function parseSseOrJsonText(rawText) {
  const t = String(rawText || "").trim();
  if (!t) return { data: null, text: "" };
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const data = JSON.parse(t);
      return { data, text: extractTextFromResponsesData(data) };
    } catch {
      /* fall through */
    }
  }
  // SSE: event: ... data: ...
  if (/^event:|data:/m.test(t)) {
    let finalObj = null;
    let delta = "";
    for (const line of t.split(/\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const d = JSON.parse(payload);
        if (d.type === "response.completed" && d.response) finalObj = d.response;
        if (d.response && (d.response.output || d.response.output_text)) finalObj = d.response;
        if (
          d.type === "response.output_text.delta" ||
          String(d.type || "").includes("output_text.delta")
        ) {
          delta += d.delta || d.text || "";
        }
        if (d.type === "response.output_text.done" && d.text) delta = d.text;
        if (d.choices?.[0]?.delta?.content) delta += d.choices[0].delta.content;
      } catch {
        /* */
      }
    }
    if (finalObj) {
      return {
        data: finalObj,
        text: extractTextFromResponsesData(finalObj) || delta
      };
    }
    return { data: null, text: delta };
  }
  return { data: null, text: t };
}

/**
 * Prefer /v1/responses (works on many custom routers for Grok).
 * Fallback /v1/chat/completions.
 */
async function chatCompleteOnce({
  model,
  messages,
  isJson = false,
  signal = null,
  temperature: _temperature = null,
  reasoningEffort = null,
  path = "responses"
}) {
  void _temperature;
  const { endpoint, apiKey, useProxy } = resolveProviderCredentials();
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": typeof location !== "undefined" ? location.href : "",
    "X-Title": "IHSG Market Bot"
  };

  if (path === "responses") {
    let targetUrl = endpoint.endsWith("/v1")
      ? `${endpoint}/responses`
      : endpoint.endsWith("/responses")
        ? endpoint
        : `${endpoint}/v1/responses`;
    if (useProxy) targetUrl = getProxyUrl(targetUrl);

    const body = {
      model,
      input: messagesToInput(messages),
      stream: false
    };
    // Do NOT set response_format — many routers reject it on responses
    if (reasoningEffort) injectReasoningParams(body, model, reasoningEffort);

    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    });
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`LLM responses ${res.status}: ${rawText.slice(0, 400)}`);
    }
    const { data, text } = parseSseOrJsonText(rawText);
    let content = text || "";
    if (!content && data) content = extractTextFromResponsesData(data);
    if (isJson && content) {
      const loose = parseJsonLoose(content);
      content = loose ? JSON.stringify(loose) : extractJson(content);
    }
    if (!content) {
      throw new Error("LLM responses empty output");
    }
    return {
      content,
      raw: data,
      reasoning: "",
      reasoningEffort: reasoningEffort || null,
      via: "responses"
    };
  }

  // chat/completions fallback
  let targetUrl = `${endpoint}/chat/completions`;
  if (useProxy) targetUrl = getProxyUrl(targetUrl);

  const body = {
    model,
    messages,
    stream: false
  };
  // json_object often breaks custom routers — only when not grok/xai
  const m = String(model || "").toLowerCase();
  if (isJson && !/grok|xai/.test(m)) {
    body.response_format = { type: "json_object" };
  }
  if (reasoningEffort) injectReasoningParams(body, model, reasoningEffort);

  const res = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LLM chat ${res.status}: ${t.slice(0, 400)}`);
  }

  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    const parsed = parseSseOrJsonText(rawText);
    data = parsed.data;
    let content = parsed.text || "";
    if (isJson && content) {
      const loose = parseJsonLoose(content);
      content = loose ? JSON.stringify(loose) : extractJson(content);
    }
    if (!content) throw new Error("LLM chat non-JSON body");
    return {
      content,
      raw: data,
      reasoning: "",
      reasoningEffort: reasoningEffort || null,
      via: "chat_sse"
    };
  }

  let content = data.choices?.[0]?.message?.content || "";
  if (typeof content !== "string") content = JSON.stringify(content || "");
  if (isJson && content) {
    const loose = parseJsonLoose(content);
    content = loose ? JSON.stringify(loose) : extractJson(content);
  }
  return {
    content,
    raw: data,
    reasoning:
      data.choices?.[0]?.message?.reasoning_content ||
      data.choices?.[0]?.message?.reasoning ||
      "",
    reasoningEffort: reasoningEffort || null,
    via: "chat"
  };
}

/**
 * Non-stream completion: Responses first → chat/completions.
 * Reasoning cascade + network retries.
 */
export async function chatComplete({
  model,
  messages,
  isJson = false,
  signal = null,
  temperature: _temperature = null,
  reasoningEffort = "auto",
  onLog = null
}) {
  void _temperature;
  const preferred = preferredReasoningEffort(model, reasoningEffort);
  const efforts = reasoningEffortCascade(preferred ?? "high");
  const paths = ["responses", "chat"];
  let lastErr = null;

  for (const path of paths) {
    for (const effort of efforts) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          onLog?.(
            `chatComplete via=${path} model=${model} temp=omit reason=${effort || "off"}${attempt > 1 ? ` retry=${attempt}` : ""}`
          );
          return await chatCompleteOnce({
            model,
            messages,
            isJson,
            signal,
            temperature: null,
            reasoningEffort: effort,
            path
          });
        } catch (e) {
          lastErr = e;
          if (signal?.aborted) throw e;
          const msg = String(e.message || e);

          if (isNetworkFetchError(e) && attempt < 3) {
            onLog?.(
              `Network ${msg.slice(0, 80)} → tunggu ${attempt * 1.2}s lalu retry`,
              "warn"
            );
            await sleep(1200 * attempt, signal);
            continue;
          }

          if (shouldDropReasoningLevel(e) && effort) {
            onLog?.(
              `reason=${effort} ditolak → turun cascade: ${msg.slice(0, 120)}`
            );
            break; // next effort
          }
          if (
            effort &&
            /400|422|unknown|unrecognized|parameter|reasoning/i.test(msg)
          ) {
            break; // next effort
          }
          // path-level failure (404, empty, method) → try next path
          if (
            /404|405|not found|responses empty|unsupported|chat \d{3}|responses \d{3}/i.test(
              msg
            )
          ) {
            onLog?.(`via=${path} gagal (${msg.slice(0, 100)}) → path lain`, "warn");
            attempt = 99; // break attempt loop
            break;
          }
          // hard fail on last path
          if (path === paths[paths.length - 1] && attempt >= 3) throw e;
          if (!isNetworkFetchError(e) && path === "responses") {
            onLog?.(`via=responses error → coba chat/completions: ${msg.slice(0, 100)}`, "warn");
            attempt = 99;
            break;
          }
          throw e;
        }
      }
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
  onLog = null
}) {
  void _temperature;
  // Keep user payload bounded — huge research dumps cause router/browser fetch fail
  let userStr = String(user || "");
  if (userStr.length > 90000) {
    onLog?.(`chatJson user payload trim ${userStr.length}→90000`, "warn");
    userStr = userStr.slice(0, 90000) + "\n…[truncated]";
  }
  const messages = [
    {
      role: "system",
      content:
        system +
        "\n\nOutput HARUS JSON valid murni. Tanpa markdown fence, tanpa prosa di luar JSON, tanpa HTML/web_ dump."
    },
    { role: "user", content: userStr }
  ];
  const { content, reasoningEffort: used, via } = await chatComplete({
    model,
    messages,
    isJson: true,
    signal,
    temperature: null,
    reasoningEffort,
    onLog
  });
  onLog?.(`chatJson ok via=${via || "?"} chars=${String(content || "").length}`);

  let parsed = parseJsonLoose(content);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    parsed.__meta = { ...(parsed.__meta || {}), reasoningEffort: used, via };
    return parsed;
  }

  onLog?.("chatJson loose-parse gagal → repair pass", "warn");
  const repair = await chatComplete({
    model,
    messages: [
      {
        role: "system",
        content: "Perbaiki jadi JSON object valid saja. Tidak ada teks lain."
      },
      { role: "user", content: String(content || "").slice(0, 60000) }
    ],
    isJson: true,
    signal,
    temperature: null,
    reasoningEffort: "off",
    onLog
  });
  parsed = parseJsonLoose(repair.content);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      "chatJson: model tidak return JSON parseable (" +
        String(content || "").slice(0, 80) +
        ")"
    );
  }
  parsed.__meta = { ...(parsed.__meta || {}), reasoningEffort: "off", via: repair.via };
  return parsed;
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
