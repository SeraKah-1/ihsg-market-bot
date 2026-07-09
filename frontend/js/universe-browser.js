/**
 * Browse full emiten universe + launch deep dive.
 */
import { logLine, setStatus, $ } from "./state.js";
import { runDeepDive } from "./orchestrate.js";

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
            <th scope="col">Aksi</th>
          </tr>
        </thead>
        <tbody>
          ${
            slice.length
              ? slice
                  .map((t, i) => {
                    const n = page * PAGE_SIZE + i + 1;
                    return `<tr data-ticker="${escAttr(t)}">
              <td class="rpt-mono">${n}</td>
              <td><span class="ticker">${esc(t)}</span></td>
              <td class="univ-yahoo">${esc(t)}.JK</td>
              <td>
                <button type="button" class="btn btn-primary btn-sm univ-deep" data-ticker="${escAttr(t)}">Deep dive</button>
              </td>
            </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="4" class="muted">Tidak ada yang cocok filter.</td></tr>`
          }
        </tbody>
      </table>
    </div>
    <p class="fineprint univ-hint">Klik Deep dive untuk riset intensif (native web search bila model support + fallback news).</p>
  `;

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

  host.querySelectorAll(".univ-deep").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const t = btn.getAttribute("data-ticker");
      const deepInput = $("deep-ticker");
      if (deepInput) deepInput.value = t;
      btn.disabled = true;
      setStatus(`Deep dive ${t}…`, "busy");
      logLine(`Universe → deep dive ${t}`);
      try {
        await runDeepDive(t);
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
