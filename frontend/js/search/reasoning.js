/**
 * Reasoning / thinking params for routers (OpenAI-compat, xAI, Gemini).
 * Soft-fail cascade when a model rejects thinking config.
 */
import { appSettings, loadSettings } from "../state.js";
import { buildThinkingLevelCascade, isThinkingConfigError } from "../thinking-config.js";

/**
 * Does this model id look like a reasoning / thinking model?
 */
export function modelLooksReasoning(model) {
  loadSettings();
  const m = String(model || "").toLowerCase();
  if (!m) return false;
  // built-in heuristics
  if (
    /o1|o3|o4|reasoning|thinking|r1|qwq|deepseek-r1|kimi|grok.*reason|reason.*grok/i.test(
      m
    )
  ) {
    return true;
  }
  // user keywords from settings
  const raw = appSettings.reasoningKeywords || "";
  const keys = String(raw)
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return keys.some((k) => m.includes(k));
}

/**
 * Preferred effort for deep-dive style work.
 * Reasoning models → high; others still try medium (some gateways ignore).
 */
export function preferredReasoningEffort(model, override = "auto") {
  if (override === "off" || override === null) return null;
  if (override && override !== "auto") return String(override);
  if (modelLooksReasoning(model)) return "high";
  // frontier web models often accept mild reasoning hints
  const m = String(model || "").toLowerCase();
  if (/grok|gemini|gpt-4|gpt-5|o[134]/.test(m)) return "medium";
  return null;
}

/**
 * Mutate request body with best-effort reasoning fields.
 * Multiple keys — gateways ignore unknown ones.
 */
export function injectReasoningParams(body, model, effort) {
  if (!body || !effort || effort === "off") return body;
  const e = String(effort).toLowerCase();
  const m = String(model || "").toLowerCase();

  // Common OpenAI / multi-provider
  body.reasoning_effort = e;
  body.reasoning = { effort: e };

  // xAI-style
  if (m.includes("grok") || m.includes("xai")) {
    body.reasoning = { effort: e };
  }

  // Gemini / Vertex thinking levels via various shapes
  if (m.includes("gemini") || m.includes("google")) {
    const level = e === "high" ? "high" : e === "low" ? "low" : "medium";
    body.thinkingConfig = { thinkingLevel: level };
    body.thinking = { thinking_level: level, thinkingLevel: level };
    body.generationConfig = {
      ...(body.generationConfig || {}),
      thinkingConfig: { thinkingLevel: level.toUpperCase() }
    };
  }

  return body;
}

/**
 * Cascade efforts to try when API rejects thinking config.
 * @returns {(string|null)[]}
 */
export function reasoningEffortCascade(preferred = "high") {
  if (!preferred || preferred === "off") return [null];
  // reuse thinking cascade names (high/medium/low/null)
  return buildThinkingLevelCascade(preferred);
}

export { isThinkingConfigError, buildThinkingLevelCascade };
