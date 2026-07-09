/**
 * Browse full emiten universe + open emiten panel / deep dive.
 */
import { logLine, setStatus, $ } from "./state.js";
import { runDeepDive } from "./orchestrate.js";
import { parseTicker } from "./ticker-util.js";
import { openEmitenPanel } from "./storage-ui.js";
import { listDocsForTicker } from "./storage-store.js";

const PAGE_SIZE = 40;
let allTickers = [];
let filter = "";
let page = 0;

export async function loadUniverseBrowser() {
  const host = $("universe-browser");
  if (!host) return;
  host.innerHTML = `<div class="empty-state"><p class="empty-body">Memuat daftar emiten…</p></div>`;
  try {
    const res = await fetch("/api/market/universe");
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    allTickers = (data.tickers || []).map((t) => String(t).toUpperCase());
    page = 0;
    renderUniverseBrowser();
    const st = $("tickers-status");
    if (st) {
      st.textContent = `${allTickers.length} tickers · updated ${data.updated || data.refreshedAt || "?"}`;
    }
  } catch (e) {
    host.innerHTML = `<div class="empty-state"><p class="empty-title">Gagal load universe</p><p class="empty-body">${esc(e.message)}</p></div>`;
  }
}

export function renderUniverseBrowser() {
  const host = $("universe-browser");
  if (!host) return;
  const q = filter.trim().toUpperCase();
  const filtered = q ? allTickers.filter((t) => t.includes(q)) : allTickers;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (page >= pages) page = pages - 1;
  if (page < 0) page = 0;
  const slice = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // badge counts for deep dives (best-effort, async fill after)
  host.innerHTML = `
    <div class="univ-toolbar">
      <label class="field univ-filter">
        <span class="field-label">Cari emiten</span>
        <input type="search" id="universe-filter" placeholder="BBCA, ADRO…" value="${escAttr(filter)}" />
      </label>
      <div class="univ-meta">
        <span><b>${filtered.length}</b> / ${allTickers.length} emiten</span>
        <span>halaman ${page + 1}/${pages}</span>
      </div>
      <div class="univ-pager">
        <button type="button" class="btn btn-ghost" id="univ-prev" ${page <= 0 ? "disabled" : ""}>← Prev</button>
        <button type="button" class="btn btn-ghost" id="univ-next" ${page >= pages - 1 ? "disabled" : ""}>Next →</button>
        <button type="button" class="btn btn-secondary" id="univ-reload">Reload list</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data univ-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Ticker</th>
            <th scope="col">Yahoo</th>
            <th scope="col">Saved</th>
            <th scope="col">Aksi</th>
          </tr>
        </thead>
        <tbody>
          ${
            slice.length
              ? slice
                  .map((t, i) => {
                    const n = page * PAGE_SIZE + i + 1;
                    return `<tr class="univ-row" data-ticker="${escAttr(t)}" title="Klik baris / ticker → panel deep dive tersimpan">
              <td class="rpt-mono">${n}</td>
              <td><button type="button" class="ticker-link univ-open" data-ticker="${escAttr(t)}"><span class="ticker">${esc(t)}</span></button></td>
              <td class="univ-yahoo">${esc(t)}.JK</td>
              <td class="univ-saved" data-saved-for="${escAttr(t)}">—</td>
              <td>
                <button type="button" class="btn btn-ghost btn-sm univ-open" data-ticker="${escAttr(t)}">Buka</button>
                <button type="button" class="btn btn-primary btn-sm univ-deep" data-ticker="${escAttr(t)}">Deep dive</button>
              </td>
            </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="5" class="muted">Tidak ada yang cocok filter.</td></tr>`
          }
        </tbody>
      </table>
    </div>
    <p class="fineprint univ-hint">Klik <b>ticker / Buka</b> → deep dive tersimpan untuk emiten. <b>Deep dive</b> = generate baru. Briefing pasar terpisah di menu Storage → Briefings.</p>
  `;

  // async fill saved counts
  slice.forEach(async (t) => {
    try {
      const dives = await listDocsForTicker(t);
      const cell = host.querySelector(`[data-saved-for="${t}"]`);
      if (cell) {
        cell.textContent = dives.length ? `${dives.length} DD` : "—";
        if (dives.length) cell.classList.add("has-saved");
      }
    } catch {
      /* */
    }
  });

  $("universe-filter")?.addEventListener("input", (e) => {
    filter = e.target.value || "";
    page = 0;
    renderUniverseBrowser();
    // restore focus
    const inp = $("universe-filter");
    if (inp) {
      inp.focus();
      const len = inp.value.length;
      inp.setSelectionRange(len, len);
    }
  });
  $("univ-prev")?.addEventListener("click", () => {
    page -= 1;
    renderUniverseBrowser();
  });
  $("univ-next")?.addEventListener("click", () => {
    page += 1;
    renderUniverseBrowser();
  });
  $("univ-reload")?.addEventListener("click", () => loadUniverseBrowser());

  host.querySelectorAll(".univ-open").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = btn.getAttribute("data-ticker");
      logLine(`Universe → panel ${t}`);
      openEmitenPanel(t);
    });
  });

  host.querySelectorAll(".univ-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const t = row.getAttribute("data-ticker");
      openEmitenPanel(t);
    });
  });

  host.querySelectorAll(".univ-deep").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const raw = btn.getAttribute("data-ticker");
      const parsed = parseTicker(raw);
      if (!parsed.ok) {
        setStatus(parsed.error, "err");
        logLine(parsed.error, "err");
        return;
      }
      const t = parsed.ticker;
      const deepInput = $("deep-ticker");
      if (deepInput) deepInput.value = t;
      btn.disabled = true;
      setStatus(`Deep dive ${t}…`, "busy");
      logLine(`Universe → deep dive ${t}`);
      try {
        await runDeepDive(t);
        await openEmitenPanel(t);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escAttr(s) {
  return esc(s).replace(/'/g, "&#39;");
}
