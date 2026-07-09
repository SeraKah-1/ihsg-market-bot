import { loadSettings, saveSettings, appSettings, $, logLine, setStatus } from "./state.js";
import {
  runPipeline,
  runDeepDive,
  abortRun,
  abortAndResetSession,
  downloadHtml,
  downloadJson,
  resumePipeline,
  setResumeBannerRefresh
} from "./orchestrate.js";
import { injectReportStylesOnce, renderBriefingHtml } from "./render-report.js";
import { fetchModels } from "./ai.js";
import { loadUniverseBrowser } from "./universe-browser.js";
import { initAgentMemory, listResumableRuns, cacheLastBriefing } from "./agent-memory.js";
import { initStorageUi } from "./storage-ui.js";
import {
  waitForAuth,
  signInWithGoogle,
  signOut,
  onUserChanged,
  currentUser
} from "./firebase.js";
import {
  loadLastBriefingCached,
  isOnline
} from "./offline-store.js";

const SHELL = () => document.querySelector(".shell");
const THEME_KEY = "ihsg-theme";
const OFFLINE_OK_KEY = "ihsg-allow-offline-session";

let pendingResumeRunId = null;

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

const MODEL_SELECT_IDS = ["model-research", "model-analysis", "model-writer"];

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
  if ($("jina-api-key")) $("jina-api-key").value = s.jinaApiKey || "";
  // selects filled by applyModelsToSelects after catalog load
  if ($("shortlist-k")) $("shortlist-k").value = s.shortlistK || 8;
  if ($("max-ingest")) $("max-ingest").value = s.maxIngest || 0;
  if ($("force-refresh")) $("force-refresh").checked = !!s.forceRefresh;
  if ($("search-mode")) $("search-mode").value = s.searchModeOverride || "auto";

  // seed selects with saved values even before fetch
  const saved = [
    s.models?.research,
    s.models?.analysis || s.models?.judge,
    s.models?.writer || s.models?.verify || s.models?.judge
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
    jinaApiKey: $("jina-api-key")?.value?.trim() || "",
    shortlistK: parseInt($("shortlist-k")?.value || "8", 10),
    maxIngest: parseInt($("max-ingest")?.value || "0", 10),
    forceRefresh: !!$("force-refresh")?.checked,
    searchModeOverride: $("search-mode")?.value || "auto",
    models: {
      research: $("model-research")?.value?.trim() || "gpt-4o-mini",
      analysis: $("model-analysis")?.value?.trim() || "gpt-4o-mini",
      writer: $("model-writer")?.value?.trim() || "gpt-4o-mini",
      // keep verify alias in sync for old localStorage readers
      verify: $("model-writer")?.value?.trim() || "gpt-4o-mini"
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

  async function refreshUniverseUi(mode = "quick") {
    const st = $("tickers-status");
    const buttons = [
      $("btn-fetch-tickers"),
      $("btn-fetch-tickers-sample"),
      $("btn-fetch-tickers-full")
    ].filter(Boolean);
    buttons.forEach((b) => (b.disabled = true));
    const labels = {
      quick: "Seed merge (tanpa Yahoo)…",
      sample: "Seed + sample Yahoo (~80)…",
      full: "Full Yahoo validate (bisa lama)…"
    };
    if (st) st.textContent = labels[mode] || "Refreshing…";
    setStatus(`Universe ${mode}…`, "busy");
    logLine(`Universe refresh mode=${mode}`);

    // Health check first — clearer than opaque Failed to fetch
    try {
      const h = await fetch("/api/health", { cache: "no-store" });
      if (!h.ok) throw new Error("server health " + h.status);
    } catch (e) {
      const msg =
        "Server tidak terjangkau (" +
        (e.message || "Failed to fetch") +
        "). Pastikan npm run dev di :3010.";
      if (st) st.textContent = "Gagal: " + msg;
      logLine("universe refresh: " + msg, "err");
      setStatus("Refresh tickers gagal — server down?", "err");
      buttons.forEach((b) => (b.disabled = false));
      return;
    }

    const ctrl = new AbortController();
    // quick ~30s, sample ~3min, full ~20min
    const timeoutMs = mode === "full" ? 20 * 60_000 : mode === "sample" ? 3 * 60_000 : 45_000;
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch("/api/market/universe/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          validate: mode !== "quick",
          maxValidate: mode === "sample" ? 80 : mode === "full" ? 0 : 0
        }),
        signal: ctrl.signal,
        cache: "no-store"
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t.slice(0, 200) || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const warn = data.meta?.yahooSuspectDown ? " · Yahoo lemah (list dijaga)" : "";
      if (st) {
        st.textContent = `${data.count} tickers · mode ${data.meta?.mode || mode} · removed ${data.meta?.removedCount || 0}${warn}`;
      }
      logLine(
        `Universe OK: ${data.count} tickers · removed ${data.meta?.removedCount || 0} · mode=${data.meta?.mode || mode}${warn}`
      );
      setStatus(`Universe: ${data.count} emiten`, "ok");
      await loadUniverseBrowser();
    } catch (e) {
      let msg = e.message || String(e);
      if (e.name === "AbortError") {
        msg = `Timeout ${Math.round(timeoutMs / 1000)}s — coba Quick, atau Sample (bukan Full).`;
      } else if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
        msg =
          "Failed to fetch — server putus/timeout. Pakai Refresh quick; Full validate sangat lama.";
      }
      if (st) st.textContent = "Gagal: " + msg;
      logLine("universe refresh: " + msg, "err");
      setStatus("Refresh tickers gagal", "err");
    } finally {
      clearTimeout(timer);
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  $("btn-fetch-tickers")?.addEventListener("click", () => refreshUniverseUi("quick"));
  $("btn-fetch-tickers-sample")?.addEventListener("click", () => refreshUniverseUi("sample"));
  $("btn-fetch-tickers-full")?.addEventListener("click", () => {
    if (
      !window.confirm(
        "Full validate mengecek SEMUA ticker lewat Yahoo (bisa 5–15+ menit).\n\nLanjut? Lebih aman pakai Quick atau Sample."
      )
    ) {
      return;
    }
    refreshUniverseUi("full");
  });

  // universe browser + storage library
  loadUniverseBrowser();
  initStorageUi().catch((e) => logLine("storage init: " + e.message, "warn"));

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
  $("btn-abort")?.addEventListener("click", async () => {
    const ok = window.confirm(
      "Abort & reset sesi?\n\n• Hentikan run yang sedang jalan\n• Hapus progress / resume\n• Bersihkan report live\n\nStorage library (Briefings/Deep Dives) tidak dihapus.\nBisa ulang dari awal."
    );
    if (!ok) return;
    // stop busy buttons
    ["btn-run", "btn-run-m", "btn-run-data", "btn-run-data-m", "btn-deep-dive", "btn-resume", "btn-resume-m"].forEach(
      (id) => {
        const b = $(id);
        if (b) b.disabled = false;
      }
    );
    await abortAndResetSession({ wipeLog: true, clearLastBriefing: true });
    pendingResumeRunId = null;
    await refreshResumeUi();
    setStatus("Sesi di-reset — siap ulang", "ok");
  });
  $("btn-abort-m")?.addEventListener("click", () => $("btn-abort")?.click());
  $("btn-dl-json")?.addEventListener("click", () => downloadJson());
  $("btn-dl-html")?.addEventListener("click", () => downloadHtml());

  // In-report export buttons (event delegation)
  document.getElementById("report-view")?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-export]");
    if (!btn) return;
    e.preventDefault();
    const kind = btn.getAttribute("data-export");
    if (kind === "html") downloadHtml();
    else if (kind === "json") downloadJson();
  });

  const doResume = () =>
    withBusy(["btn-run", "btn-run-m", "btn-resume", "btn-resume-m", "btn-resume-banner"], async () => {
      if (!pendingResumeRunId) {
        await refreshResumeUi();
        if (!pendingResumeRunId) {
          setStatus("Tidak ada run untuk di-resume", "warn");
          return;
        }
      }
      readSettingsFromForm();
      setLogOpen(true);
      logLine(`Resume pipeline ${pendingResumeRunId}`);
      await resumePipeline(pendingResumeRunId);
    });

  $("btn-resume")?.addEventListener("click", doResume);
  $("btn-resume-m")?.addEventListener("click", doResume);
  $("btn-resume-banner")?.addEventListener("click", doResume);
  $("btn-dismiss-resume")?.addEventListener("click", () => {
    $("resume-banner")?.classList.add("hidden");
  });

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

  // Auth UI
  wireAuthUi();
  setResumeBannerRefresh(refreshResumeUi);

  // Online / offline banners
  const syncNet = () => {
    const offline = !isOnline();
    $("offline-banner")?.classList.toggle("hidden", !offline);
    if (offline) logLine("Browser offline — PWA shell + cache aktif", "warn");
  };
  window.addEventListener("online", () => {
    syncNet();
    logLine("Online kembali");
    setStatus("Online", "ok");
  });
  window.addEventListener("offline", syncNet);
  syncNet();

  // Service worker
  registerServiceWorker();

  // Boot: auth + memory + restore offline briefing
  bootApp();
}

function showAuthError(msg) {
  const el = $("auth-error");
  if (!el) return;
  el.innerHTML = msg;
  el.classList.remove("hidden");
}

function setAuthScreen(show) {
  $("auth-screen")?.classList.toggle("hidden", !show);
  // app always visible for offline read; gate only when forcing login
}

function paintUser(user) {
  const chip = $("user-chip");
  if (!chip) return;
  if (user && !user.isAnonymous) {
    chip.classList.remove("hidden");
    const av = $("user-avatar");
    if (av) {
      av.src = user.photoURL || "";
      av.alt = user.displayName || "user";
    }
    if ($("user-name")) {
      $("user-name").textContent =
        user.displayName?.split(" ")[0] || user.email?.split("@")[0] || "akun";
    }
  } else {
    chip.classList.add("hidden");
  }
}

function wireAuthUi() {
  $("btn-google-signin")?.addEventListener("click", async () => {
    $("auth-error")?.classList.add("hidden");
    try {
      const u = await signInWithGoogle({ preferRedirect: false });
      if (u) {
        logLine("Google sign-in OK: " + (u.email || u.uid));
        localStorage.removeItem(OFFLINE_OK_KEY);
        setAuthScreen(false);
        paintUser(u);
        await initAgentMemory(logLine);
        setStatus("Login Google · memory sync", "ok");
      }
    } catch (e) {
      console.error(e);
      const code = e.code || "";
      const msg = e.message || String(e);
      if (
        code === "auth/unauthorized-domain" ||
        msg.includes("unauthorized-domain") ||
        msg.includes("invalid-continue-uri")
      ) {
        showAuthError(
          "Domain belum di-whitelist di Firebase Console.<br/>Tambah <b>" +
            location.hostname +
            "</b> ke Authentication → Settings → Authorized domains."
        );
      } else {
        showAuthError(msg);
      }
    }
  });

  $("btn-continue-offline")?.addEventListener("click", () => {
    localStorage.setItem(OFFLINE_OK_KEY, "1");
    setAuthScreen(false);
    logLine("Mode offline lokal (tanpa Google sync)");
    setStatus("Offline mode · memory lokal", "info");
  });

  $("btn-signout")?.addEventListener("click", async () => {
    try {
      await signOut();
      localStorage.removeItem(OFFLINE_OK_KEY);
      paintUser(null);
      setAuthScreen(true);
      setStatus("Signed out", "info");
      logLine("Signed out");
    } catch (e) {
      logLine("Sign out: " + e.message, "err");
    }
  });

  onUserChanged((user) => {
    paintUser(user);
    if (user && !user.isAnonymous) {
      setAuthScreen(false);
    }
  });
}

async function refreshResumeUi() {
  try {
    const list = await listResumableRuns(logLine);
    const top = list[0];
    pendingResumeRunId = top?.runId || null;
    const show = !!pendingResumeRunId;
    $("btn-resume")?.classList.toggle("hidden", !show);
    $("btn-resume-m")?.classList.toggle("hidden", !show);
    const banner = $("resume-banner");
    if (banner) {
      banner.classList.toggle("hidden", !show);
      if (show && $("resume-banner-text")) {
        $("resume-banner-text").textContent =
          `Run tertunda ${pendingResumeRunId}` +
          (top.lastError ? ` · ${String(top.lastError).slice(0, 80)}` : "") +
          " — lanjut dari agent terakhir.";
      }
    }
  } catch (e) {
    logLine("resume ui: " + e.message, "warn");
  }
}

async function restoreOfflineBriefing() {
  try {
    const cached = await loadLastBriefingCached();
    if (!cached?.briefing && !cached?.html) return;
    injectReportStylesOnce();
    const reportEl = $("report-view");
    if (!reportEl) return;
    if (cached.html) {
      reportEl.innerHTML = cached.html;
    } else if (cached.briefing) {
      reportEl.innerHTML = renderBriefingHtml(cached.briefing);
    }
    window.__lastBriefing = cached.briefing || window.__lastBriefing;
    logLine(
      "Restored briefing cache offline · " +
        (cached.briefing?.asOfSession || cached.at || "")
    );
    setStatus("Briefing dari cache offline", "info");
  } catch (e) {
    logLine("restore cache: " + e.message, "warn");
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("/sw.js")
    .then((reg) => logLine("PWA SW registered · " + (reg.scope || "")))
    .catch((e) => logLine("SW register fail: " + e.message, "warn"));
}

async function bootApp() {
  try {
    const user = await waitForAuth();
    const allowOffline = localStorage.getItem(OFFLINE_OK_KEY) === "1";
    if (user && !user.isAnonymous) {
      setAuthScreen(false);
      paintUser(user);
      logLine("Session Google: " + (user.email || user.uid.slice(0, 8)));
    } else if (allowOffline || !isOnline()) {
      setAuthScreen(false);
      if (!isOnline()) logLine("Boot offline — skip auth gate");
    } else {
      setAuthScreen(true);
    }

    const mem = await initAgentMemory(logLine);
    await restoreOfflineBriefing();
    await refreshResumeUi();

    try {
      const r = await fetch("/api/health");
      const j = await r.json();
      logLine("API ok · " + j.service);
      setStatus(
        mem.ok
          ? "Siap · Google + Firebase market"
          : isOnline()
            ? "Siap · offline memory (login untuk sync)"
            : "Offline · cache tersedia",
        mem.ok ? "ok" : "info"
      );
    } catch (e) {
      logLine("API fail: " + e.message, "err");
      setStatus("API offline · cache PWA OK", "warn");
      await restoreOfflineBriefing();
    }
  } catch (e) {
    console.error(e);
    logLine("Boot: " + e.message, "err");
    setAuthScreen(localStorage.getItem(OFFLINE_OK_KEY) !== "1");
  }
}

init();
