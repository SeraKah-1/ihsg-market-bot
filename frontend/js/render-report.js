/**
 * JSON → HTML report with progressive disclosure (collapsible sections).
 * Scan-first: header badges → accordions → cards.
 */
export function renderBriefingHtml(b) {
  if (!b) return empty("Empty briefing");

  const lean = b.sentiment?.judgeLean || "—";
  const priority = b.sentiment?.judgePriority || "mixed";
  const ihsg = b.ihsg || {};

  // update KPI if present
  updateKpisFromBriefing(b);

  const cards = (b.shortlist || [])
    .map((s) => {
      const st = s.stance || {};
      const risk = st.exitLiquidityRisk || "low";
      const agg = st.aggressionAllowed;
      return `<article class="card">
      <header>
        <h3>
          ${esc(s.ticker)}
          <span class="badge ${agg ? "badge-follow" : "badge-exit"}">${agg ? "Follow money" : "No aggression"}</span>
          <span class="badge badge-exit">Exit-liq ${esc(risk)}</span>
        </h3>
        <div class="metrics-line ${(s.metrics?.changePct || 0) >= 0 ? "up" : "down"}">
          ${fmt(s.metrics?.changePct)}% · rvol ${fmt(s.metrics?.rvol)} · z ${fmt(s.metrics?.zRet)}
        </div>
      </header>
      <p><b>Why</b> — ${esc((s.whySelected || []).join(", ") || "—")}</p>
      <p><b>FOMO thesis</b> — ${esc(st.fomoThesis || s.followMoney?.asymmetryNote || "—")}</p>
      <p><b>Invalidation</b> — ${esc(st.invalidation || "—")}</p>
      <p><b>Horizon</b> — ${esc(st.timeHorizon || "—")}</p>
      <p><b>Best move</b> — ${esc(s.bestMoveFraming || "—")}</p>
      <p><b>Base</b> — ${esc(s.scenarios?.base?.narrative || "—")}
         <span class="muted">(p=${fmt(s.scenarios?.base?.prob)})</span></p>
      <p class="muted"><b>Bull</b> ${esc(s.scenarios?.bull?.narrative || "—")} ·
         <b>Bear</b> ${esc(s.scenarios?.bear?.narrative || "—")}</p>
    </article>`;
    })
    .join("");

  const mermaid = b.diagrams?.flowMermaid
    ? `<pre class="mermaid">${esc(b.diagrams.flowMermaid)}</pre>`
    : `<p class="muted">Tidak ada diagram.</p>`;

  const globalsRows = (b.globals || [])
    .map(
      (g) =>
        `<tr><td>${esc(g.label || g.symbol)}</td><td class="${(g.changePct || 0) >= 0 ? "up" : "down"}">${fmt(g.changePct)}%</td></tr>`
    )
    .join("");

  return `
  <header class="report-head">
    <h1>IHSG Briefing · ${esc(b.asOfSession || "")}</h1>
    <div class="badges">
      <span class="badge badge-lean">Lean ${esc(lean)}</span>
      <span class="badge ${priority === "avoid_exit_liq" ? "badge-exit" : "badge-follow"}">${esc(priority)}</span>
      <span class="badge">${esc(b.searchMode || "")}</span>
      <span class="badge">${esc(b.sentiment?.confidenceLabel || "uncalibrated")}</span>
    </div>
    <p class="meta">IHSG ${fmt(ihsg.close)} (${signed(ihsg.changePct)}%) · coverage ${fmt(b.dataQuality?.coveragePct)}% · ${esc(b.runId || "")}</p>
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
      <p><b>Regime</b> — ${esc(b.marketWide?.regimeTag || "—")}</p>
      <p><b>Themes</b> — ${esc((b.marketWide?.themes || []).join(", ") || "—")}</p>
      <p><b>Follow money</b> — ${esc(b.marketWide?.followMoneyThesis || "—")}</p>
      <p><b>Best move</b> — ${esc(b.marketWide?.bestMoveOverall || "—")}</p>
      <p><b>Unexplained</b> — ${esc((b.marketWide?.unexplained || []).join("; ") || "—")}</p>
    </div>
  </details>

  <details class="report-section">
    <summary>Globals</summary>
    <div class="report-section-body">
      <table>
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

  <footer>
    <p>${esc(b.disclaimer || "Bukan saran investasi.")}</p>
    <p>Stance: follow the money · FOMO boleh · jangan exit liquidity · no AI loss-aversion</p>
  </footer>`;
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
  const set = (id, text, cls) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (cls !== undefined) {
      el.classList.remove("up", "down");
      if (cls) el.classList.add(cls);
    }
  };
  const chg = ihsg.changePct;
  set("kpi-ihsg", ihsg.close != null ? fmtNum(ihsg.close) : "—");
  const chgEl = document.getElementById("kpi-ihsg-chg");
  if (chgEl) {
    chgEl.textContent = chg == null ? "—" : `${signed(chg)}%`;
    chgEl.className = "kpi-meta " + (chg > 0 ? "up" : chg < 0 ? "down" : "");
  }
  const b = pack.breadth || {};
  set("kpi-breadth", b.total != null ? `${b.adv ?? 0}/${b.dec ?? 0}` : "—");
  set("kpi-cov", pack.dataQuality?.coveragePct != null ? `${fmtNum(pack.dataQuality.coveragePct)}%` : "—");
  const cacheEl = document.getElementById("kpi-cache");
  if (cacheEl) {
    cacheEl.textContent = pack.dataQuality?.fromCache ? "cache hit" : "fresh fetch";
  }
  // clear empty state styling
  document.querySelectorAll(".kpi-strip .kpi").forEach((k) => k.classList.remove("empty"));
}

function empty(msg) {
  return `<div class="empty-state"><p class="empty-title">${esc(msg)}</p></div>`;
}

function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return String(Math.round(Number(n) * 100) / 100);
}
function fmtNum(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const x = Number(n);
  if (Math.abs(x) >= 1000) return x.toLocaleString("id-ID", { maximumFractionDigits: 2 });
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
