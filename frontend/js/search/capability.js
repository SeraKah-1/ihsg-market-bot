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
    return "Web: FULL — native tools (web_search/google_search) dulu → Jina search → news RSS. Deep dive = agentic + reasoning (query dinamis, no page-fetch).";
  }
  if (mode === "FALLBACK") {
    return "Web: FALLBACK — Jina search + Google News RSS (tanpa native tools).";
  }
  return "Web: DEGRADED — no live search. Jangan mengarang katalis berita.";
}
