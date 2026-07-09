import { loadSettings, saveSettings, appSettings, $, logLine, setStatus } from "./state.js";
import { runPipeline, abortRun, downloadHtml, downloadJson } from "./orchestrate.js";
import { injectReportStylesOnce } from "./render-report.js";

const SHELL = () => document.querySelector(".shell");
const THEME_KEY = "ihsg-theme";

function applyTheme(mode) {
  const m = mode || localStorage.getItem(THEME_KEY) || "system";
  localStorage.setItem(THEME_KEY, m);
  document.documentElement.dataset.theme = m;
  const dark =
    m === "dark" || (m === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark-mode", dark);
  document.querySelectorAll("[data-theme-set]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.getAttribute("data-theme-set") === m ? "true" : "false");
  });
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#1c1917" : "#f3efe6");
}

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
  setStatus("Settings tersimpan", "ok");
}

function setNavOpen(open) {
  const shell = SHELL();
  if (!shell) return;
  shell.classList.toggle("nav-collapsed", !open);
  $("btn-toggle-nav")?.setAttribute("aria-expanded", open ? "true" : "false");
}

function setLogOpen(open) {
  const shell = SHELL();
  const drawer = $("log-drawer");
  if (!shell || !drawer) return;
  shell.classList.toggle("log-open", open);
  drawer.hidden = !open;
  $("btn-toggle-log")?.setAttribute("aria-expanded", open ? "true" : "false");
}

function isMobile() {
  return window.matchMedia("(max-width: 960px)").matches;
}

async function withBusy(btnIds, fn) {
  const btns = btnIds.map((id) => $(id)).filter(Boolean);
  btns.forEach((b) => (b.disabled = true));
  try {
    await fn();
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

function initChrome() {
  applyTheme(localStorage.getItem(THEME_KEY) || "system");
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((localStorage.getItem(THEME_KEY) || "system") === "system") applyTheme("system");
  });
  document.querySelectorAll("[data-theme-set]").forEach((btn) => {
    btn.addEventListener("click", () => applyTheme(btn.getAttribute("data-theme-set")));
  });

  setNavOpen(!isMobile());
  setLogOpen(false);

  $("btn-toggle-nav")?.addEventListener("click", () => {
    setNavOpen($("btn-toggle-nav").getAttribute("aria-expanded") !== "true");
  });
  $("btn-toggle-nav-m")?.addEventListener("click", () => {
    setNavOpen($("btn-toggle-nav").getAttribute("aria-expanded") !== "true");
  });
  $("btn-toggle-log")?.addEventListener("click", () => {
    setLogOpen($("btn-toggle-log").getAttribute("aria-expanded") !== "true");
  });
  $("btn-close-log")?.addEventListener("click", () => setLogOpen(false));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if ($("btn-toggle-log")?.getAttribute("aria-expanded") === "true") setLogOpen(false);
      else if (isMobile() && $("btn-toggle-nav")?.getAttribute("aria-expanded") === "true")
        setNavOpen(false);
    }
    if (e.key === "\\" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setNavOpen($("btn-toggle-nav").getAttribute("aria-expanded") !== "true");
    }
  });
}

function init() {
  injectReportStylesOnce();
  bindSettingsForm();
  initChrome();

  $("btn-save-settings")?.addEventListener("click", readSettingsFromForm);

  const runFull = () =>
    withBusy(["btn-run", "btn-run-m", "btn-run-data", "btn-run-data-m"], async () => {
      readSettingsFromForm();
      setLogOpen(true);
      await runPipeline({ skipAi: false });
    });

  const runData = () =>
    withBusy(["btn-run", "btn-run-m", "btn-run-data", "btn-run-data-m"], async () => {
      readSettingsFromForm();
      setLogOpen(true);
      await runPipeline({ skipAi: true });
    });

  $("btn-run")?.addEventListener("click", runFull);
  $("btn-run-m")?.addEventListener("click", runFull);
  $("btn-run-data")?.addEventListener("click", runData);
  $("btn-run-data-m")?.addEventListener("click", runData);
  $("btn-abort")?.addEventListener("click", () => abortRun());
  $("btn-dl-json")?.addEventListener("click", () => downloadJson());
  $("btn-dl-html")?.addEventListener("click", () => downloadHtml());

  fetch("/api/health")
    .then((r) => r.json())
    .then((j) => {
      logLine("API ok · " + j.service);
      setStatus("Siap · isi router lalu Run", "info");
    })
    .catch((e) => {
      logLine("API fail: " + e.message, "err");
      setStatus("API offline", "err");
    });
}

init();
