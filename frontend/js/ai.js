/**
 * Slim custom-router client (OpenAI-compatible). Personal use.
 */
import { appSettings, loadSettings } from "./state.js";

loadSettings();

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
 * Non-stream chat completion. isJson → response_format json_object.
 */
export async function chatComplete({
  model,
  messages,
  isJson = false,
  signal = null,
  temperature = 0.4
}) {
  const { endpoint, apiKey, useProxy } = resolveProviderCredentials();
  let targetUrl = `${endpoint}/chat/completions`;
  if (useProxy) targetUrl = getProxyUrl(targetUrl);

  const body = {
    model,
    messages,
    temperature,
    stream: false
  };
  if (isJson) body.response_format = { type: "json_object" };

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
    reasoning: data.choices?.[0]?.message?.reasoning_content || data.choices?.[0]?.message?.reasoning || ""
  };
}

export async function chatJson({ model, system, user, signal, temperature = 0.35 }) {
  const messages = [
    {
      role: "system",
      content:
        system +
        "\n\nOutput HARUS JSON valid murni. Tanpa markdown fence, tanpa prosa di luar JSON."
    },
    { role: "user", content: user }
  ];
  const { content } = await chatComplete({ model, messages, isJson: true, signal, temperature });
  try {
    return JSON.parse(content);
  } catch (e) {
    // one repair attempt
    const repair = await chatComplete({
      model,
      messages: [
        { role: "system", content: "Perbaiki jadi JSON valid saja. Tidak ada teks lain." },
        { role: "user", content: content }
      ],
      isJson: true,
      signal,
      temperature: 0
    });
    return JSON.parse(repair.content);
  }
}

export function modelFor(role) {
  loadSettings();
  const m = appSettings.models || {};
  return m[role] || m.judge || "gpt-4o-mini";
}

/**
 * GET {endpoint}/models — OpenAI-compatible list.
 * Returns sorted model ids (deduped).
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
