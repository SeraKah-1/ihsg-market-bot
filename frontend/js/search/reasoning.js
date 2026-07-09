/**
 * Reasoning / thinking params — default ON for all models.
 * Cascade: high → medium → low → no reasoning (null).
 */
import { appSettings, loadSettings } from "../state.js";
import { buildThinkingLevelCascade, isThinkingConfigError } from "../thinking-config.js";

/**
 * Heuristic: model name suggests native reasoning SKU (for logging / prefs only).
 * Does NOT gate whether we try reasoning — we always try by default.
 */
export function modelLooksReasoning(model) {
  loadSettings();
  const m = String(model || "").toLowerCase();
  if (!m) return false;
  if (
    /o1|o3|o4|reasoning|thinking|r1|qwq|deepseek-r1|kimi|grok.*reason|reason.*grok/i.test(
      m
    )
  ) {
    return true;
  }
  const raw = appSettings.reasoningKeywords || "";
  const keys = String(raw)
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return keys.some((k) => m.includes(k));
}

/**
 * Default preferred effort: high for ALL models (soft-fail cascade handles reject).
 * override: "auto" | "high" | "medium" | "low" | "off" | null
 */
export function preferredReasoningEffort(model, override = "auto") {
  if (override === "off" || override === null) return null;
  if (override && override !== "auto") return String(override);
  // Default product policy: always start high
  void model;
  return "high";
}

/**
 * Mutate request body with best-effort reasoning fields (all providers).
 * Inject broadly so unknown models still get a chance; cascade strips on reject.
 */
export function injectReasoningParams(body, model, effort) {
  if (!body || !effort || effort === "off") return body;
  const e = String(effort).toLowerCase();
  const m = String(model || "").toLowerCase();

  body.reasoning_effort = e;
  body.reasoning = { effort: e };

  // xAI
  if (m.includes("grok") || m.includes("xai") || !m) {
    body.reasoning = { effort: e };
  }

  // Gemini / Vertex-style — always attach so gemini-via-router works;
  // non-gemini gateways usually ignore unknown keys.
  const level = e === "high" ? "high" : e === "low" ? "low" : "medium";
  body.thinkingConfig = { thinkingLevel: level };
  body.thinking = { thinking_level: level, thinkingLevel: level };
  body.generationConfig = {
    ...(body.generationConfig || {}),
    thinkingConfig: { thinkingLevel: level.toUpperCase() }
  };

  return body;
}

/**
 * Always: high → medium → low → null (no reasoning).
 * If preferred is medium, start mid; if off, [null] only.
 */
export function reasoningEffortCascade(preferred = "high") {
  if (!preferred || preferred === "off") return [null];
  return buildThinkingLevelCascade(preferred);
}

/**
 * Errors that warrant dropping reasoning level (not only pure thinking config).
 */
export function shouldDropReasoningLevel(err) {
  if (isThinkingConfigError(err)) return true;
  const msg = String(err?.message || err || "").toLowerCase();
  if (!msg) return false;
  if (
    msg.includes("reasoning_effort") ||
    msg.includes("reasoning.effort") ||
    msg.includes("unknown parameter") ||
    msg.includes("unrecognized") ||
    msg.includes("extra fields") ||
    msg.includes("additional properties") ||
    (msg.includes("400") && (msg.includes("reason") || msg.includes("think")))
  ) {
    return true;
  }
  return false;
}

/**
 * Errors that warrant trying a different tool profile.
 */
export function shouldTryNextToolProfile(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  if (!msg) return false;
  if (
    msg.includes("tool") ||
    msg.includes("web_search") ||
    msg.includes("google_search") ||
    msg.includes("unknown type") ||
    msg.includes("not supported") ||
    msg.includes("invalid tools") ||
    msg.includes("server_side") ||
    msg.includes("function") ||
    msg.includes("400") ||
    msg.includes("404") ||
    msg.includes("422")
  ) {
    return true;
  }
  return false;
}

/**
 * Models that reject non-default temperature (OpenAI o-series / GPT-5 reasoning).
 * Docs/community: temperature unsupported or only default=1 allowed.
 */
export function modelOmitsTemperature(model) {
  const m = String(model || "").toLowerCase();
  if (!m) return false;
  if (/\bo1\b|\bo3\b|\bo4\b|o1-|o3-|o4-|o1_|o3_|o4_/.test(m)) return true;
  if (/gpt-5|gpt5/.test(m) && !/gpt-5-chat|gpt-4/.test(m)) return true;
  // pure reasoning SKUs often reject sampling knobs
  if (/(^|\/)(o3|o4|o1)(-|$)/.test(m)) return true;
  return false;
}

/**
 * Product policy: ALWAYS omit temperature (all models / tools / chat).
 * Gateway default sampling only. `preferred` ignored.
 */
export function resolveTemperature(_model, _preferred = null, _opts = {}) {
  void _model;
  void _preferred;
  void _opts;
  return null;
}

/** API rejected temperature — retry without it */
export function shouldDropTemperature(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("temperature") &&
    (msg.includes("unsupported") ||
      msg.includes("not support") ||
      msg.includes("invalid") ||
      msg.includes("unknown") ||
      msg.includes("only the default") ||
      msg.includes("400") ||
      msg.includes("422"))
  );
}

export { isThinkingConfigError, buildThinkingLevelCascade };
