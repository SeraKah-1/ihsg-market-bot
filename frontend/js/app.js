import { loadSettings, saveSettings, appSettings, $, logLine, setStatus } from "./state.js";
import { runPipeline, abortRun, downloadHtml, downloadJson } from "./orchestrate.js";

function bindSettingsForm() {
  loadSettings();
  const s = appSettings;
  if ($("custom-endpoint")) $("custom-endpoint").value = s.customEndpoint || "";
  if ($("custom-api-key")) $("custom-api-key").value = s.customApiKey || "";
  if ($("use-cors-proxy")) $("use-cors-proxy").checked = !!s.useCorsProxy;
  if ($("model-research")) $("model-research").value = s.models?.research || "";
  if ($("model-fear")) $("model-fear").value = s.models?.fear || "";
  if ($("model-positive")) $("model-positive").value = s.models?.positive || "";
  if ($("model-judge")) $("model-judge").value = s.models?.judge || "";
  if ($("shortlist-k")) $("shortlist-k").value = s.shortlistK || 8;
  if ($("max-ingest")) $("max-ingest").value = s.maxIngest || 0;
  if ($("force-refresh")) $("force-refresh").checked = !!s.forceRefresh;
  if ($("search-mode")) $("search-mode").value = s.searchModeOverride || "auto";
}

function readSettingsFromForm() {
  saveSettings({
    connectionMode: "custom",
    customEndpoint: $("custom-endpoint")?.value?.trim() || "",
    customApiKey: $("custom-api-key")?.value?.trim() || "",
    useCorsProxy: !!$("use-cors-proxy")?.checked,
    shortlistK: parseInt($("shortlist-k")?.value || "8", 10),
    maxIngest: parseInt($("max-ingest")?.value || "0", 10),
    forceRefresh: !!$("force-refresh")?.checked,
    searchModeOverride: $("search-mode")?.value || "auto",
    models: {
      research: $("model-research")?.value?.trim() || "gpt-4o-mini",
      fear: $("model-fear")?.value?.trim() || "gpt-4o-mini",
      positive: $("model-positive")?.value?.trim() || "gpt-4o-mini",
      judge: $("model-judge")?.value?.trim() || "gpt-4o-mini"
    }
  });
  logLine("Settings saved");
}

function init() {
  bindSettingsForm();
  $("btn-save-settings")?.addEventListener("click", readSettingsFromForm);
  $("btn-run")?.addEventListener("click", async () => {
    readSettingsFromForm();
    $("btn-run").disabled = true;
    try {
      await runPipeline({ skipAi: false });
    } finally {
      $("btn-run").disabled = false;
    }
  });
  $("btn-run-data")?.addEventListener("click", async () => {
    readSettingsFromForm();
    $("btn-run-data").disabled = true;
    try {
      await runPipeline({ skipAi: true });
    } finally {
      $("btn-run-data").disabled = false;
    }
  });
  $("btn-abort")?.addEventListener("click", () => abortRun());
  $("btn-dl-json")?.addEventListener("click", () => downloadJson());
  $("btn-dl-html")?.addEventListener("click", () => downloadHtml());

  fetch("/api/health")
    .then((r) => r.json())
    .then((j) => logLine("API ok: " + j.service))
    .catch((e) => logLine("API fail: " + e.message, "err"));

  setStatus("Siap. Isi custom router lalu Run.", "info");
}

init();
