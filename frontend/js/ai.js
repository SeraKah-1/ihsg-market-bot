/**
 * Slim custom-router client (OpenAI-compatible). Personal use.
 * Reasoning cascade + non-zero temperature defaults.
 */
import { appSettings, loadSettings } from "./state.js";
import {
  injectReasoningParams,
  preferredReasoningEffort,
  reasoningEffortCascade,
  shouldDropReasoningLevel
} from "./search/reasoning.js";

loadSettings();

/** Default creative temp for analysis agents — never freeze at 0 */
export const DEFAULT_TEMP = 0.65;
/** Slightly lower for repair-only JSON fix (still not 0) */
export const REPAIR_TEMP = 0.2;

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

export function extractJson(text) {
  if (!text) return text;
  let s = String(text).trim();
  s = s.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return s;
}

/**
 * Single chat/completions attempt (optional reasoning fields already on body).
 */
async function chatCompleteOnce({
  model,
  messages,
  isJson = false,
  signal = null,
  temperature = DEFAULT_TEMP,
  reasoningEffort = null
}) {
  const { endpoint, apiKey, useProxy } = resolveProviderCredentials();
  let targetUrl = `${endpoint}/chat/completions`;
  if (useProxy) targetUrl = getProxyUrl(targetUrl);

  const body = {
    model,
    messages,
    temperature: temperature == null ? DEFAULT_TEMP : temperature,
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
  temperature = DEFAULT_TEMP,
  reasoningEffort = "auto",
  onLog = null
}) {
  const preferred = preferredReasoningEffort(model, reasoningEffort);
  const efforts = reasoningEffortCascade(preferred ?? "high");
  let lastErr = null;

  for (const effort of efforts) {
    try {
      onLog?.(
        `chatComplete model=${model} temp=${temperature} reason=${effort || "off"}`
      );
      return await chatCompleteOnce({
        model,
        messages,
        isJson,
        signal,
        temperature,
        reasoningEffort: effort
      });
    } catch (e) {
      lastErr = e;
      if (signal?.aborted) throw e;
      if (shouldDropReasoningLevel(e) && effort) {
        onLog?.(`reason=${effort} ditolak → turun cascade: ${String(e.message || e).slice(0, 120)}`);
        continue;
      }
      // non-reasoning error — don't spin the whole cascade unless 400-ish
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
  temperature = DEFAULT_TEMP,
  reasoningEffort = "auto",
  onLog = null
}) {
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
    temperature,
    reasoningEffort,
    onLog
  });
  try {
    const parsed = JSON.parse(content);
    parsed.__meta = { ...(parsed.__meta || {}), reasoningEffort: used };
    return parsed;
  } catch (e) {
    // one repair attempt — low but non-zero temp
    const repair = await chatComplete({
      model,
      messages: [
        { role: "system", content: "Perbaiki jadi JSON valid saja. Tidak ada teks lain." },
        { role: "user", content: content }
      ],
      isJson: true,
      signal,
      temperature: REPAIR_TEMP,
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
  if (role === "verify") return m.verify || m.judge || m.analysis || m.research || "gpt-4o-mini";
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
