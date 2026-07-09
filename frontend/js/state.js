const STORAGE_KEY = "ihsg-market-bot-settings-v1";

export const DEFAULT_SETTINGS = {
  connectionMode: "custom",
  customEndpoint: "http://127.0.0.1:20128/v1",
  customApiKey: "",
  useCorsProxy: true,
  models: {
    research: "gpt-4o-mini",
    analysis: "gpt-4o-mini",
    writer: "gpt-4o-mini",
    // legacy keys still merged if present in localStorage
    verify: "gpt-4o-mini",
    fear: "gpt-4o-mini",
    positive: "gpt-4o-mini",
    judge: "gpt-4o-mini"
  },
  shortlistK: 8,
  maxIngest: 0,
  forceRefresh: false,
  /** Prefer native web tools (any model) before Jina+news. Default on. */
  preferNativeSearch: true,
  /**
   * Optional Jina key for browser→server body (overrides empty server env).
   * Prefer server .env JINA_API_KEY so the key never leaves localStorage if not needed.
   */
  jinaApiKey: "",
  tavilyApiKey: "",
  reasoningKeywords: "qwen, deepseek-r1, o1, o3, reasoning, thinking, kimi, qwq",
  searchModeOverride: "auto"
};

export let appSettings = { ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models } };

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return appSettings;
    const parsed = JSON.parse(raw);
    appSettings = mergeSettings(DEFAULT_SETTINGS, parsed);
    return appSettings;
  } catch {
    return appSettings;
  }
}

export function saveSettings(partial = {}) {
  appSettings = mergeSettings(appSettings, partial);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appSettings));
  return appSettings;
}

function mergeSettings(base, partial) {
  const out = { ...base, ...partial };
  if (partial.models) out.models = { ...base.models, ...partial.models };
  // migrate legacy roles → research / analysis / writer
  if (out.models) {
    if (!out.models.analysis && (out.models.judge || out.models.fear)) {
      out.models.analysis = out.models.judge || out.models.fear;
    }
    if (!out.models.writer) {
      out.models.writer =
        out.models.verify || out.models.judge || out.models.positive || out.models.analysis;
    }
    if (!out.models.verify && out.models.writer) {
      out.models.verify = out.models.writer;
    }
  }
  return out;
}

export function $(id) {
  return document.getElementById(id);
}

export function logLine(msg, cls = "") {
  const el = $("log-stream");
  if (!el) return;
  const line = document.createElement("div");
  line.className = "log-line " + cls;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

export function setStatus(text, kind = "info") {
  const el = $("run-status");
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
}
