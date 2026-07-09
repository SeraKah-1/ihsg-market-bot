import { appSettings, loadSettings } from "../state.js";

/**
 * Resolve search mode: FULL | FALLBACK | DEGRADED
 * Personal: native search assumed only if user sets prefer + override; else DDG fallback.
 */
export function detectSearchMode() {
  loadSettings();
  const o = appSettings.searchModeOverride || "auto";
  if (o === "FULL" || o === "FALLBACK" || o === "DEGRADED") return o;
  // auto
  if (appSettings.preferNativeSearch && appSettings.nativeSearchAvailable) return "FULL";
  return "FALLBACK"; // DDG free
}

export function searchModeBanner(mode) {
  if (mode === "FULL") return "Web search: native model / FULL";
  if (mode === "FALLBACK") return "Web search: FALLBACK (DuckDuckGo free)";
  return "Web search: DEGRADED — tanpa search live. Catalyst berita tidak diverifikasi. Jangan mengarang.";
}
