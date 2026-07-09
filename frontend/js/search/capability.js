import { appSettings, loadSettings } from "../state.js";
import { modelSupportsNativeSearch } from "./native-search.js";
import { modelFor } from "../ai.js";

/**
 * Resolve search mode: FULL | FALLBACK | DEGRADED
 *
 * auto → FULL for any configured research model (native+reasoning default;
 *         cascade soft-fails into Jina/news).
 * Explicit FALLBACK skips native; DEGRADED skips all live web.
 */
export function detectSearchMode() {
  loadSettings();
  const o = appSettings.searchModeOverride || "auto";
  if (o === "FULL" || o === "FALLBACK" || o === "DEGRADED") return o;
  // auto: prefer FULL whenever we have a model id (try native first)
  try {
    const m = modelFor("research");
    if (modelSupportsNativeSearch(m)) return "FULL";
  } catch {
    /* no credentials / empty model */
  }
  // no model yet — still FULL so UI path tries; hybrid will soft-fail to news
  return "FULL";
}

export function searchModeBanner(mode) {
  if (mode === "FULL") {
    return "Web: FULL — Research agentic web_search (komprehensif) → Jina → news. Pipeline: Research → Analysis(verify) → Writer.";
  }
  if (mode === "FALLBACK") {
    return "Web: FALLBACK — skip native; Jina search + Google News RSS saja.";
  }
  return "Web: DEGRADED — no live search. Jangan mengarang katalis berita.";
}
