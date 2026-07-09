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

/**
 * Single chat/completions attempt (optional reasoning fields already on body).
 */
async function chatCompleteOnce({
  model,
  messages,
  isJson = false,
  signal = null,
  temperature: _temperature = null,
  reasoningEffort = null
}) {
  void _temperature; // product: never send temperature
  const { endpoint, apiKey, useProxy } = resolveProviderCredentials();
  let targetUrl = `${endpoint}/chat/completions`;
  if (useProxy) targetUrl = getProxyUrl(targetUrl);

  const body = {
    model,
    messages,
    stream: false
  };
  if (isJson) body.response_format = { type: "json_object" };
  if (reasoningEffort) injectReasoningParams(body, model, reasoningEffort);

  const res = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": typeof location !== "undefined" ? location.href : "",
      "X-Title": "IHSG Market Bot"
    },
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LLM ${res.status}: ${t.slice(0, 400)}`);
  }

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
    reasoningEffort: reasoningEffort || null
  };
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
  onLog = null
}) {
  void _temperature;
  const preferred = preferredReasoningEffort(model, reasoningEffort);
  const efforts = reasoningEffortCascade(preferred ?? "high");
  let lastErr = null;

  for (const effort of efforts) {
    try {
      onLog?.(
        `chatComplete model=${model} temp=omit reason=${effort || "off"}`
      );
      return await chatCompleteOnce({
        model,
        messages,
        isJson,
        signal,
        temperature: null,
        reasoningEffort: effort
      });
    } catch (e) {
      lastErr = e;
      if (signal?.aborted) throw e;
      if (shouldDropReasoningLevel(e) && effort) {
        onLog?.(`reason=${effort} ditolak → turun cascade: ${String(e.message || e).slice(0, 120)}`);
        continue;
      }
      if (effort && /400|422|unknown|unrecognized|parameter/i.test(String(e.message || e))) {
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
  onLog = null
}) {
  void _temperature;
  const messages = [
    {
      role: "system",
      content:
        system +
        "\n\nOutput HARUS JSON valid murni. Tanpa markdown fence, tanpa prosa di luar JSON."
    },
    { role: "user", content: user }
  ];
  const { content, reasoningEffort: used } = await chatComplete({
    model,
    messages,
    isJson: true,
    signal,
    temperature: null,
    reasoningEffort,
    onLog
  });
  try {
    const parsed = JSON.parse(content);
    parsed.__meta = { ...(parsed.__meta || {}), reasoningEffort: used };
    return parsed;
  } catch (e) {
    const repair = await chatComplete({
      model,
      messages: [
        { role: "system", content: "Perbaiki jadi JSON valid saja. Tidak ada teks lain." },
        { role: "user", content: content }
      ],
      isJson: true,
      signal,
      temperature: null,
      reasoningEffort: "off",
      onLog
    });
    return JSON.parse(repair.content);
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
