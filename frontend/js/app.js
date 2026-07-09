import { loadSettings, saveSettings, appSettings, $, logLine, setStatus } from "./state.js";
import { runPipeline, runDeepDive, abortRun, downloadHtml, downloadJson } from "./orchestrate.js";
import { injectReportStylesOnce } from "./render-report.js";
import { fetchModels } from "./ai.js";

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

/** In-memory model catalog for filter + selects */
let modelCatalog = [];

const MODEL_SELECT_IDS = ["model-research", "model-fear", "model-positive", "model-judge"];

/**
 * Populate role <select>s via DOM APIs (safe for ids with /, :, etc.).
 * Preserves current selection when still in list; otherwise keeps custom option.
 */
function applyModelsToSelects(ids, { filter = "" } = {}) {
  const all = Array.isArray(ids) ? ids : [];
  modelCatalog = all;
  const q = String(filter || "")
    .trim()
    .toLowerCase();
  const filtered = q ? all.filter((id) => id.toLowerCase().includes(q)) : all;

  for (const sid of MODEL_SELECT_IDS) {
    const sel = $(sid);
    if (!sel || sel.tagName !== "SELECT") continue;
    const prev = sel.value || appSettings.models?.[sid.replace("model-", "")] || "";

    // rebuild options safely
    sel.replaceChildren();

    // placeholder (not disabled — disabled+selected can block dropdown UX in some browsers)
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = filtered.length
      ? `— pilih model (${filtered.length}${q ? " filtered" : ""}) —`
      : "— fetch models dulu —";
    if (!prev) ph.selected = true;
    sel.appendChild(ph);

    // keep previous value even if filtered out (so save still works)
    if (prev && !filtered.includes(prev)) {
      const keep = document.createElement("option");
      keep.value = prev;
      keep.textContent = prev + (all.includes(prev) ? " (hidden by filter)" : " (saved)");
      keep.selected = true;
      sel.appendChild(keep);
    }

    for (const id of filtered) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      if (id === prev) opt.selected = true;
      sel.appendChild(opt);
    }
  }
}

function bindSettingsForm() {
  loadSettings();
  const s = appSettings;
  if ($("custom-endpoint")) $("custom-endpoint").value = s.customEndpoint || "";
  if ($("custom-api-key")) $("custom-api-key").value = s.customApiKey || "";
  if ($("use-cors-proxy")) $("use-cors-proxy").checked = !!s.useCorsProxy;
  // selects filled by applyModelsToSelects after catalog load
  if ($("shortlist-k")) $("shortlist-k").value = s.shortlistK || 8;
  if ($("max-ingest")) $("max-ingest").value = s.maxIngest || 0;
  if ($("force-refresh")) $("force-refresh").checked = !!s.forceRefresh;
  if ($("search-mode")) $("search-mode").value = s.searchModeOverride || "auto";

  // seed selects with saved values even before fetch
  const saved = [
    s.models?.research,
    s.models?.fear,
    s.models?.positive,
    s.models?.judge
  ].filter(Boolean);
  const uniqueSaved = [...new Set(saved)];
  if (uniqueSaved.length && !modelCatalog.length) {
    applyModelsToSelects(uniqueSaved);
  } else if (modelCatalog.length) {
    applyModelsToSelects(modelCatalog);
  } else {
    applyModelsToSelects([]);
    // still show saved as selected options
    for (const sid of MODEL_SELECT_IDS) {
      const sel = $(sid);
      const key = sid.replace("model-", "");
      const val = s.models?.[key];
      if (sel && val) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = val;
        opt.selected = true;
        sel.appendChild(opt);
      }
    }
  }
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

  $("btn-fetch-models")?.addEventListener("click", async () => {
    readSettingsFromForm();
    const st = $("models-status");
    const btn = $("btn-fetch-models");
    if (btn) btn.disabled = true;
    if (st) st.textContent = "Fetching /models…";
    try {
      const ids = await fetchModels();
      const filter = $("model-filter")?.value || "";
      applyModelsToSelects(ids, { filter });
      try {
        localStorage.setItem("ihsg-model-list", JSON.stringify(ids));
      } catch {
        /* quota / private mode */
      }
      if (st) {
        st.textContent = `${ids.length} models loaded · pakai dropdown di bawah (bisa di-filter)`;
      }
      logLine(`Fetched ${ids.length} models`);
      setStatus(`${ids.length} models ready`, "ok");
    } catch (e) {
      if (st) st.textContent = "Gagal: " + e.message;
      logLine("fetch models: " + e.message, "err");
      setStatus("Fetch models gagal", "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Filter without re-fetch
  $("model-filter")?.addEventListener("input", () => {
    if (!modelCatalog.length) return;
    applyModelsToSelects(modelCatalog, { filter: $("model-filter").value || "" });
  });

  // hydrate selects from cache
  try {
    const cached = JSON.parse(localStorage.getItem("ihsg-model-list") || "[]");
    if (Array.isArray(cached) && cached.length) {
      applyModelsToSelects(cached);
      const st = $("models-status");
      if (st) st.textContent = `${cached.length} models (cache) · fetch ulang untuk update`;
    }
  } catch {
    /* */
  }

  $("btn-fetch-tickers")?.addEventListener("click", async () => {
    const st = $("tickers-status");
    const btn = $("btn-fetch-tickers");
    if (btn) btn.disabled = true;
    if (st) st.textContent = "Refreshing universe (validate Yahoo)…";
    try {
      const res = await fetch("/api/market/universe/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ validate: true, maxValidate: 0 })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (st) {
        st.textContent = `${data.count} tickers · removed ${data.meta?.removedCount || 0} · ${data.refreshedAt || ""}`;
      }
      logLine(`Universe refresh: ${data.count} tickers, removed ${data.meta?.removedCount || 0}`);
      setStatus(`Universe: ${data.count} emiten`, "ok");
    } catch (e) {
      if (st) st.textContent = "Gagal: " + e.message;
      logLine("universe refresh: " + e.message, "err");
      setStatus("Refresh tickers gagal", "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // show current universe count
  fetch("/api/market/universe")
    .then((r) => r.json())
    .then((u) => {
      const st = $("tickers-status");
      if (st) st.textContent = `${u.count || u.tickers?.length || "?"} tickers · updated ${u.updated || "?"}`;
    })
    .catch(() => {});

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

  $("btn-deep-dive")?.addEventListener("click", async () => {
    readSettingsFromForm();
    const ticker = $("deep-ticker")?.value || "";
    setLogOpen(true);
    $("btn-deep-dive").disabled = true;
    try {
      await runDeepDive(ticker);
    } finally {
      $("btn-deep-dive").disabled = false;
    }
  });
  $("deep-ticker")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      $("btn-deep-dive")?.click();
    }
  });

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
