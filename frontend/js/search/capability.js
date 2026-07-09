import { appSettings, loadSettings } from "../state.js";
import { modelSupportsNativeSearch } from "./native-search.js";
import { modelFor } from "../ai.js";

/**
 * Resolve search mode: FULL | FALLBACK | DEGRADED
 * auto → FULL if research model looks frontier-native (Grok/Gemini/GPT tools),
 *         else FALLBACK (Google News RSS free).
 */
export function detectSearchMode() {
  loadSettings();
  const o = appSettings.searchModeOverride || "auto";
  if (o === "FULL" || o === "FALLBACK" || o === "DEGRADED") return o;
  // auto
  try {
    const m = modelFor("research");
    if (modelSupportsNativeSearch(m)) return "FULL";
  } catch {
    /* no credentials yet */
  }
  return "FALLBACK";
}

export function searchModeBanner(mode) {
  if (mode === "FULL") {
    return "Web search: FULL — native model tools (xAI web_search / Gemini google_search / Responses API)";
  }
  if (mode === "FALLBACK") {
    return "Web search: FALLBACK — free Google News RSS (+ DDG if available)";
  }
  return "Web search: DEGRADED — no live search. Jangan mengarang katalis berita.";
}
