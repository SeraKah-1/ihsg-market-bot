/**
 * JSON → HTML briefing. Shared structure for in-app + export.
 */
import { REPORT_CSS, wrapStandaloneHtml } from "./report-theme.js";

export function renderBriefingHtml(b) {
  if (!b) {
    return `<div class="empty-state"><p class="empty-title">Empty briefing</p></div>`;
  }

  updateKpisFromBriefing(b);

  const lean = b.sentiment?.judgeLean || "—";
  const priority = b.sentiment?.judgePriority || "mixed";
  const ihsg = b.ihsg || {};

  const cards = (b.shortlist || [])
    .map((s) => {
      const st = s.stance || {};
      const risk = st.exitLiquidityRisk || "low";
      const agg = st.aggressionAllowed;
      const chg = s.metrics?.changePct;
      return `<article class="card">
      <header>
        <h3>
          ${esc(s.ticker)}
          <span class="badge ${agg ? "badge-follow" : "badge-exit"}">${agg ? "Follow money" : "No aggression"}</span>
          <span class="badge badge-exit">Exit-liq ${esc(risk)}</span>
        </h3>
        <div class="metrics-line ${chg >= 0 ? "up" : "down"}">
          ${signed(chg)}% · rvol ${fmt(s.metrics?.rvol)} · z ${fmt(s.metrics?.zRet)}
        </div>
      </header>
      <dl class="kv">
        <dt>Context</dt><dd class="muted">${esc(s.context?.summary || "—")}</dd>
        <dt>vs IHSG</dt><dd>${esc(
          s.vsIhsg
            ? `1w ${signed(s.vsIhsg.excessRet1w)}% · 1m ${signed(s.vsIhsg.excessRet1m)}%`
            : "—"
        )}</dd>
        <dt>Why</dt><dd>${esc((s.whySelected || []).join(", ") || "—")}</dd>
        <dt>FOMO</dt><dd>${esc(st.fomoThesis || s.followMoney?.asymmetryNote || "—")}</dd>
        <dt>Invalidation</dt><dd>${esc(st.invalidation || "—")}</dd>
        <dt>Horizon</dt><dd>${esc(st.timeHorizon || "—")}</dd>
        <dt>Best move</dt><dd>${esc(s.bestMoveFraming || "—")}</dd>
      </dl>
      <div class="scenario-row">
        <div class="scenario">
          <div class="lab">Base</div>
          <div>${esc(s.scenarios?.base?.narrative || "—")}</div>
          <div class="prob">p=${fmt(s.scenarios?.base?.prob)} · ${esc(s.scenarios?.base?.horizon || "")}</div>
        </div>
        <div class="scenario">
          <div class="lab">Bull</div>
          <div>${esc(s.scenarios?.bull?.narrative || "—")}</div>
          <div class="prob">p=${fmt(s.scenarios?.bull?.prob)}</div>
        </div>
        <div class="scenario">
          <div class="lab">Bear</div>
          <div>${esc(s.scenarios?.bear?.narrative || "—")}</div>
          <div class="prob">p=${fmt(s.scenarios?.bear?.prob)}</div>
        </div>
      </div>
    </article>`;
    })
    .join("");

  const mermaid = b.diagrams?.flowMermaid
    ? `<pre class="mermaid">${esc(b.diagrams.flowMermaid)}</pre>`
    : `<p class="muted">Tidak ada diagram.</p>`;

  const globalsRows = (b.globals || [])
    .map((g) => {
      const c = g.changePct;
      return `<tr>
        <td>${esc(g.label || g.symbol)}</td>
        <td class="${c >= 0 ? "up" : "down"}">${signed(c)}%</td>
      </tr>`;
    })
    .join("");

  const regime = b.marketRegime || {};
  const ihsgSum = ihsg.context?.summary || regime.ihsgSummary || "";

  return `
  <header class="report-head">
    <p class="report-kicker">Market briefing</p>
    <h1>IHSG · ${esc(b.asOfSession || "")}</h1>
    <div class="badges">
      <span class="badge badge-lean">Lean ${esc(lean)}</span>
      <span class="badge ${priority === "avoid_exit_liq" ? "badge-exit" : "badge-follow"}">${esc(priority)}</span>
      <span class="badge badge-lean">Regime ${esc(regime.tag || "—")}</span>
      <span class="badge">${esc(b.searchMode || "")}</span>
      <span class="badge">${esc(b.sentiment?.confidenceLabel || "uncalibrated")}</span>
    </div>
    <p class="meta">IHSG ${fmtNum(ihsg.close)} (${signed(ihsg.changePct)}%) · ${esc(ihsgSum)}</p>
    <p class="meta">coverage ${fmt(b.dataQuality?.coveragePct)}% · ${esc(b.runId || "")}${regime.note ? " · " + esc(regime.note) : ""}</p>
  </header>

  <details class="report-section" open>
    <summary>Judge &amp; sentimen</summary>
    <div class="report-section-body">
      <p>${esc(b.sentiment?.judgeRationale || "—")}</p>
      <p><b>Fear</b> — ${esc(b.sentiment?.fear?.summary || "—")}</p>
      <p><b>Positive</b> — ${esc(b.sentiment?.positive?.summary || "—")}</p>
    </div>
  </details>

  <details class="report-section" open>
    <summary>Market-wide</summary>
    <div class="report-section-body">
      <dl class="kv">
        <dt>Regime</dt><dd>${esc(b.marketWide?.regimeTag || "—")}</dd>
        <dt>Themes</dt><dd>${esc((b.marketWide?.themes || []).join(", ") || "—")}</dd>
        <dt>Follow money</dt><dd>${esc(b.marketWide?.followMoneyThesis || "—")}</dd>
        <dt>Best move</dt><dd>${esc(b.marketWide?.bestMoveOverall || "—")}</dd>
        <dt>Unexplained</dt><dd>${esc((b.marketWide?.unexplained || []).join("; ") || "—")}</dd>
      </dl>
    </div>
  </details>

  <details class="report-section">
    <summary>Globals</summary>
    <div class="report-section-body">
      <table class="report-table">
        <thead><tr><th>Symbol</th><th>Change</th></tr></thead>
        <tbody>${globalsRows || "<tr><td colspan='2' class='muted'>—</td></tr>"}</tbody>
      </table>
    </div>
  </details>

  <details class="report-section" open>
    <summary>Shortlist deep-dive (${(b.shortlist || []).length})</summary>
    <div class="report-section-body card-grid">
      ${cards || "<p class='muted'>Kosong</p>"}
    </div>
  </details>

  <details class="report-section">
    <summary>Flow diagram</summary>
    <div class="report-section-body">${mermaid}</div>
  </details>

  <footer class="report-footer">
    <p>${esc(b.disclaimer || "Bukan saran investasi. Keputusan akhir di user.")}</p>
    <p>Stance: follow the money · FOMO boleh · jangan exit liquidity · no AI loss-aversion</p>
  </footer>`;
}

/** Full document for download */
export function buildExportHtml(b) {
  const body = renderBriefingHtml(b);
  return wrapStandaloneHtml({
    title: `IHSG Briefing ${b?.asOfSession || ""}`.trim(),
    bodyHtml: body,
    reportJson: b
  });
}

export function injectReportStylesOnce() {
  if (document.getElementById("report-theme-css")) return;
  const style = document.createElement("style");
  style.id = "report-theme-css";
  style.textContent = REPORT_CSS;
  document.head.appendChild(style);
}

export function updateKpisFromBriefing(b) {
  const leanEl = document.getElementById("kpi-lean");
  const priEl = document.getElementById("kpi-priority");
  if (leanEl) {
    leanEl.textContent = (b.sentiment?.judgeLean || "—").toUpperCase();
    leanEl.classList.remove("up", "down");
    if (b.sentiment?.judgeLean === "positive") leanEl.classList.add("up");
    if (b.sentiment?.judgeLean === "fear") leanEl.classList.add("down");
  }
  if (priEl) priEl.textContent = b.sentiment?.judgePriority || "judge";
}

export function updateKpisFromShortlist(pack) {
  const ihsg = pack.ihsg || {};
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  setText("kpi-ihsg", ihsg.close != null ? fmtNum(ihsg.close) : "—");
  const chgEl = document.getElementById("kpi-ihsg-chg");
  if (chgEl) {
    const chg = ihsg.changePct;
    chgEl.textContent = chg == null ? "—" : `${signed(chg)}%`;
    chgEl.className = "kpi-meta " + (chg > 0 ? "up" : chg < 0 ? "down" : "");
  }
  const b = pack.breadth || {};
  setText("kpi-breadth", b.total != null ? `${b.adv ?? 0} / ${b.dec ?? 0}` : "—");
  setText(
    "kpi-cov",
    pack.dataQuality?.coveragePct != null ? `${fmt(pack.dataQuality.coveragePct)}%` : "—"
  );
  const cacheEl = document.getElementById("kpi-cache");
  if (cacheEl) cacheEl.textContent = pack.dataQuality?.fromCache ? "cache hit" : "fresh fetch";
  document.querySelectorAll(".kpi-strip .kpi").forEach((k) => k.classList.remove("empty"));
}

function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return String(Math.round(Number(n) * 100) / 100);
}
function fmtNum(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const x = Number(n);
  if (Math.abs(x) >= 100) return x.toLocaleString("id-ID", { maximumFractionDigits: 2 });
  return String(Math.round(x * 100) / 100);
}
function signed(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const x = Math.round(Number(n) * 100) / 100;
  return (x > 0 ? "+" : "") + x;
}
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
