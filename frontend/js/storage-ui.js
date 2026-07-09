/**
 * Storage UI — folder/file tree + CRUD + open generated reports.
 * Separate Briefings vs Deep Dives; emiten panel lists ticker deep dives.
 */
import { logLine, setStatus, $ } from "./state.js";
import {
  SYSTEM,
  ensureSystemFolders,
  listFolders,
  listDocs,
  getDocById,
  createFolder,
  renameFolder,
  deleteFolder,
  renameDoc,
  moveDoc,
  deleteDocRecord,
  createEmptyDoc,
  listDocsForTicker,
  pullCloudStorage,
  exportStorageBackup,
  importStorageBackup,
  countByKind
} from "./storage-store.js";
import { injectReportStylesOnce, renderBriefingHtml, renderDeepDiveHtml } from "./render-report.js";
import { runDeepDive } from "./orchestrate.js";

let expanded = new Set([SYSTEM.BRIEFINGS.id, SYSTEM.DEEP_DIVES.id]);
let activeDocId = null;
let filterQ = "";
let viewMode = "live"; // live | storage
let emitenTicker = null;

try {
  const s = JSON.parse(localStorage.getItem("ihsg-storage-expanded") || "[]");
  s.forEach((id) => expanded.add(id));
} catch {
  /* */
}

function saveExpanded() {
  try {
    localStorage.setItem("ihsg-storage-expanded", JSON.stringify([...expanded]));
  } catch {
    /* */
  }
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(ms) {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "—";
  }
}

function promptModal({ title, value = "", selectOpts = null }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true">
        <h3 class="modal-title">${esc(title)}</h3>
        ${
          selectOpts
            ? `<label class="field"><span class="field-label">Pilih</span>
               <select id="modal-sel" class="model-select">
                 ${selectOpts.map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join("")}
               </select></label>`
            : `<label class="field"><span class="field-label">Nama</span>
               <input id="modal-inp" type="text" value="${esc(value)}" autofocus /></label>`
        }
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-a="cancel">Batal</button>
          <button type="button" class="btn btn-primary" data-a="ok">OK</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const inp = overlay.querySelector("#modal-inp");
    const sel = overlay.querySelector("#modal-sel");
    inp?.focus();
    inp?.select();
    const close = (v) => {
      overlay.remove();
      resolve(v);
    };
    overlay.querySelector('[data-a="cancel"]').onclick = () => close(null);
    overlay.querySelector('[data-a="ok"]').onclick = () => {
      if (selectOpts) close({ sel: sel.value });
      else close({ value: inp.value });
    };
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(null);
      if (e.key === "Enter") overlay.querySelector('[data-a="ok"]').click();
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
    });
  });
}

export function setMainView(mode) {
  viewMode = mode === "storage" ? "storage" : "live";
  document.querySelectorAll("[data-main-view]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.getAttribute("data-main-view") === viewMode ? "true" : "false");
  });
  $("view-live")?.classList.toggle("hidden", viewMode !== "live");
  $("view-storage")?.classList.toggle("hidden", viewMode !== "storage");
  if (viewMode === "storage") refreshStorageUi();
}

export async function initStorageUi() {
  await ensureSystemFolders();
  wireStorageChrome();
  await refreshStorageUi();
  // pull cloud in background
  pullCloudStorage(logLine).then(() => refreshStorageUi()).catch(() => {});
}

function wireStorageChrome() {
  document.querySelectorAll("[data-main-view]").forEach((btn) => {
    btn.addEventListener("click", () => setMainView(btn.getAttribute("data-main-view")));
  });

  $("btn-storage-new-folder")?.addEventListener("click", async () => {
    const r = await promptModal({ title: "Folder baru" });
    if (!r?.value?.trim()) return;
    try {
      await createFolder(r.value.trim());
      logLine("Folder dibuat: " + r.value.trim());
      await refreshStorageUi();
    } catch (e) {
      setStatus(e.message, "err");
    }
  });

  $("btn-storage-new-note")?.addEventListener("click", async () => {
    const r = await promptModal({ title: "Judul catatan" });
    if (!r?.value?.trim()) return;
    try {
      const d = await createEmptyDoc({
        title: r.value.trim(),
        folderId: SYSTEM.BRIEFINGS.id,
        kind: "briefing"
      });
      logLine("Catatan: " + d.title);
      await openStorageDoc(d.id);
      await refreshStorageUi();
    } catch (e) {
      setStatus(e.message, "err");
    }
  });

  $("btn-storage-refresh")?.addEventListener("click", async () => {
    await pullCloudStorage(logLine);
    await refreshStorageUi();
    setStatus("Storage di-refresh", "ok");
  });

  $("btn-storage-export")?.addEventListener("click", async () => {
    const backup = await exportStorageBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ihsg-storage-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    logLine("Export storage backup");
  });

  $("btn-storage-import")?.addEventListener("click", () => {
    $("storage-import-file")?.click();
  });
  $("storage-import-file")?.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      const r = await importStorageBackup(obj);
      logLine(`Import storage · folders=${r.folders} docs=${r.docs}`);
      await refreshStorageUi();
      setStatus("Import OK", "ok");
    } catch (e) {
      setStatus("Import gagal: " + e.message, "err");
    }
    ev.target.value = "";
  });

  $("storage-filter")?.addEventListener("input", (e) => {
    filterQ = e.target.value || "";
    refreshStorageUi();
  });

  $("btn-close-emiten")?.addEventListener("click", () => closeEmitenPanel());
}

export async function refreshStorageUi() {
  const host = $("storage-tree");
  if (!host) return;
  const [folders, docs] = await Promise.all([
    listFolders(),
    listDocs(filterQ ? { q: filterQ } : {})
  ]);
  const counts = await countByKind();
  const meta = $("storage-meta");
  if (meta) {
    meta.textContent = `${counts.total} file · ${counts.briefing} briefing · ${counts.deep_dive} deep dive · ${folders.length} folder`;
  }

  let html = "";
  for (const f of folders) {
    const fdocs = docs.filter((d) => d.folderId === f.id);
    // when filtering, hide empty folders unless system
    if (filterQ && !fdocs.length) continue;
    const isOpen = expanded.has(f.id);
    const badge =
      f.systemKey === "briefings"
        ? "briefing"
        : f.systemKey === "deep_dives"
          ? "deep"
          : "user";
    html += `
      <div class="st-folder ${isOpen ? "open" : ""}" data-fid="${esc(f.id)}">
        <div class="st-folder-head" data-fid="${esc(f.id)}">
          <span class="st-chev">${isOpen ? "▾" : "▸"}</span>
          <span class="st-folder-icon" aria-hidden="true">📁</span>
          <span class="st-folder-name">${esc(f.name)}</span>
          <span class="st-count">${fdocs.length}</span>
          <span class="st-badge st-badge-${badge}">${esc(badge)}</span>
          ${
            f.kind !== "system"
              ? `<button type="button" class="st-more" data-act="folder-menu" data-id="${esc(f.id)}" data-name="${esc(f.name)}" title="Menu">⋯</button>`
              : ""
          }
        </div>
        <div class="st-folder-body ${isOpen ? "" : "hidden"}">
          ${
            fdocs.length
              ? fdocs.map((d) => docRow(d)).join("")
              : `<div class="st-empty">Folder kosong</div>`
          }
        </div>
      </div>`;
  }

  // orphan docs
  const folderIds = new Set(folders.map((f) => f.id));
  const orphans = docs.filter((d) => !folderIds.has(d.folderId));
  if (orphans.length) {
    html += `<div class="st-section-label">Tanpa folder</div>${orphans.map(docRow).join("")}`;
  }

  if (!html) {
    html = `<div class="empty-state"><p class="empty-title">Belum ada file</p><p class="empty-body">Jalankan briefing atau deep dive — otomatis tersimpan di sini.</p></div>`;
  }
  host.innerHTML = html;

  host.querySelectorAll(".st-folder-head").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".st-more")) return;
      const id = el.getAttribute("data-fid");
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      saveExpanded();
      refreshStorageUi();
    });
  });

  host.querySelectorAll(".st-doc").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".st-more")) return;
      openStorageDoc(el.getAttribute("data-id"));
    });
  });

  host.querySelectorAll('[data-act="folder-menu"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showCtxMenu(e, {
        type: "folder",
        id: btn.getAttribute("data-id"),
        name: btn.getAttribute("data-name")
      });
    });
  });
  host.querySelectorAll('[data-act="doc-menu"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showCtxMenu(e, {
        type: "doc",
        id: btn.getAttribute("data-id"),
        name: btn.getAttribute("data-name"),
        folderId: btn.getAttribute("data-folder")
      });
    });
  });
}

function docRow(d) {
  const active = d.id === activeDocId ? "active" : "";
  const kind = d.kind === "deep_dive" ? "deep" : "brief";
  const tick = d.ticker ? `<span class="st-tick">${esc(d.ticker)}</span>` : "";
  return `
    <div class="st-doc ${active}" data-id="${esc(d.id)}">
      <span class="st-doc-kind st-kind-${kind}">${d.kind === "deep_dive" ? "DD" : "BR"}</span>
      <div class="st-doc-main">
        <span class="st-doc-title">${esc(d.title)}</span>
        <span class="st-doc-meta">${tick}${d.lean ? ` · ${esc(d.lean)}` : ""} · ${fmtDate(d.updatedAt)}</span>
      </div>
      <button type="button" class="st-more" data-act="doc-menu" data-id="${esc(d.id)}" data-name="${esc(d.title)}" data-folder="${esc(d.folderId || "")}" title="Menu">⋯</button>
    </div>`;
}

function showCtxMenu(e, data) {
  let menu = $("st-ctx-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "st-ctx-menu";
    menu.className = "st-ctx-menu hidden";
    document.body.appendChild(menu);
  }
  const items =
    data.type === "folder"
      ? [
          { l: "Rename", a: async () => {
            const r = await promptModal({ title: "Rename folder", value: data.name });
            if (r?.value?.trim()) {
              await renameFolder(data.id, r.value.trim());
              await refreshStorageUi();
            }
          }},
          { l: "Hapus folder", a: async () => {
            if (!confirm(`Hapus folder "${data.name}"? File pindah ke Briefings.`)) return;
            await deleteFolder(data.id);
            await refreshStorageUi();
          }}
        ]
      : [
          { l: "Buka", a: () => openStorageDoc(data.id) },
          { l: "Rename", a: async () => {
            const r = await promptModal({ title: "Rename file", value: data.name });
            if (r?.value?.trim()) {
              await renameDoc(data.id, r.value.trim());
              await refreshStorageUi();
            }
          }},
          { l: "Pindah ke…", a: async () => {
            const folders = await listFolders();
            const opts = folders.map((f) => ({ v: f.id, l: f.name }));
            const r = await promptModal({ title: "Pindah ke folder", selectOpts: opts });
            if (r?.sel) {
              await moveDoc(data.id, r.sel);
              await refreshStorageUi();
            }
          }},
          { l: "Hapus", a: async () => {
            if (!confirm(`Hapus "${data.name}"?`)) return;
            await deleteDocRecord(data.id);
            if (activeDocId === data.id) activeDocId = null;
            await refreshStorageUi();
            setStatus("File dihapus", "ok");
          }}
        ];

  menu.innerHTML = items.map((i) => `<button type="button" class="st-ctx-item">${esc(i.l)}</button>`).join("");
  menu.querySelectorAll("button").forEach((btn, idx) => {
    btn.onclick = async () => {
      menu.classList.add("hidden");
      try {
        await items[idx].a();
      } catch (err) {
        setStatus(err.message, "err");
        logLine(err.message, "err");
      }
    };
  });
  menu.style.top = Math.min(e.clientY, window.innerHeight - 160) + "px";
  menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + "px";
  menu.classList.remove("hidden");
  setTimeout(() => {
    document.addEventListener(
      "click",
      () => menu.classList.add("hidden"),
      { once: true }
    );
  }, 0);
}

export async function openStorageDoc(id) {
  const rec = await getDocById(id);
  if (!rec) {
    setStatus("File tidak ditemukan", "err");
    return;
  }
  activeDocId = id;
  injectReportStylesOnce();
  const reportEl = $("report-view");
  let html = rec.html;
  if (!html && rec.payload) {
    html =
      rec.kind === "deep_dive"
        ? renderDeepDiveHtml(rec.payload)
        : renderBriefingHtml(rec.payload);
  }
  if (reportEl) {
    reportEl.innerHTML =
      html ||
      `<div class="empty-state"><p class="empty-title">${esc(rec.title)}</p><p class="empty-body">Tidak ada HTML/payload.</p></div>`;
  }
  window.__lastBriefing = rec.payload || { title: rec.title, kind: rec.kind };
  window.__lastStorageDocId = id;

  // switch to live report area so user sees content
  setMainView("live");
  $("h-report") && ($("h-report").textContent = rec.kind === "deep_dive" ? `Deep dive · ${rec.ticker || ""}` : "Briefing (storage)");
  const eyebrow = document.querySelector("#h-report")?.closest(".block-head")?.querySelector(".eyebrow");
  if (eyebrow) eyebrow.textContent = "Storage";
  document.getElementById("report-view")?.scrollIntoView({ behavior: "smooth", block: "start" });
  setStatus(`Buka: ${rec.title}`, "ok");
  logLine(`Storage open ${rec.kind} ${rec.id}`);
  await refreshStorageUi();
}

/** Emiten panel: list deep dives for ticker + run */
export async function openEmitenPanel(ticker) {
  const { parseTicker } = await import("./ticker-util.js");
  const parsed = parseTicker(ticker);
  if (!parsed.ok) return;
  const t = parsed.ticker;
  emitenTicker = t;
  const panel = $("emiten-panel");
  if (!panel) return;
  panel.classList.remove("hidden");
  const title = $("emiten-panel-title");
  if (title) title.textContent = t;

  const listEl = $("emiten-dives-list");
  const dives = await listDocsForTicker(t);
  if (listEl) {
    if (!dives.length) {
      listEl.innerHTML = `<p class="muted fineprint">Belum ada deep dive tersimpan untuk ${esc(t)}. Tekan Run deep dive.</p>`;
    } else {
      listEl.innerHTML = dives
        .map(
          (d) => `
        <button type="button" class="emiten-dive-item" data-id="${esc(d.id)}">
          <span class="emiten-dive-title">${esc(d.title)}</span>
          <span class="emiten-dive-meta">${fmtDate(d.updatedAt)}${d.lean ? " · " + esc(d.lean) : ""}</span>
        </button>`
        )
        .join("");
      listEl.querySelectorAll(".emiten-dive-item").forEach((btn) => {
        btn.addEventListener("click", () => openStorageDoc(btn.getAttribute("data-id")));
      });
    }
  }

  const runBtn = $("btn-emiten-deep");
  if (runBtn) {
    runBtn.onclick = async () => {
      const deepInput = $("deep-ticker");
      if (deepInput) deepInput.value = t;
      runBtn.disabled = true;
      setStatus(`Deep dive ${t}…`, "busy");
      try {
        await runDeepDive(t);
        await openEmitenPanel(t);
      } finally {
        runBtn.disabled = false;
      }
    };
  }
}

export function closeEmitenPanel() {
  emitenTicker = null;
  $("emiten-panel")?.classList.add("hidden");
}

/** Call after generate to refresh tree if open */
export async function notifyStorageSaved(rec) {
  logLine(
    `Storage saved · ${rec.kind} · ${rec.title}${rec.ticker ? " · " + rec.ticker : ""}`
  );
  if (viewMode === "storage") await refreshStorageUi();
  if (emitenTicker && rec.ticker === emitenTicker) await openEmitenPanel(emitenTicker);
}
