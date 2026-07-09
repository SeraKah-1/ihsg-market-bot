/**
 * Structured JSON → readable HTML (briefing + deep dive).
 * No KaTeX for market numbers — tabular mono only.
 */
import { REPORT_CSS, wrapStandaloneHtml } from "./report-theme.js";

export function renderBriefingHtml(b) {
  if (!b) return emptyBox("Empty briefing");

  updateKpisFromBriefing(b);

  const lean = b.sentiment?.judgeLean || "—";
  const priority = b.sentiment?.judgePriority || "mixed";
  const ihsg = b.ihsg || {};
  const regime = b.marketRegime || {};
  const leanCls = lean === "positive" ? "up" : lean === "fear" ? "down" : "neutral";

  const cards = (b.shortlist || []).map((s) => renderTickerCard(s)).join("");

  const themeChips = chips(b.marketWide?.themes || []);
  const unexChips = chips(b.marketWide?.unexplained || [], "warn");

  const globalsRows = (b.globals || [])
    .map((g) => {
      const c = g.changePct;
      return `<tr>
        <td>${esc(g.label || g.symbol)}</td>
        <td class="num ${clsSign(c)}">${signed(c)}%</td>
        <td class="rpt-muted">${esc(g.context?.summary || g.contextSummary || "—")}</td>
      </tr>`;
    })
    .join("");

  const ihsgHorizon = horizonTable(ihsg.context);

  return `
<div class="rpt ${isDark() ? "rpt-dark" : ""}">
<div class="rpt-wrap">
  <header class="rpt-head">
    <p class="rpt-kicker">Market briefing</p>
    <h1>IHSG · ${esc(b.asOfSession || "")}</h1>
    <div class="rpt-badges">
      <span class="rpt-badge ${leanCls}">Lean ${esc(lean)}</span>
      <span class="rpt-badge ${priority === "avoid_exit_liq" ? "down" : "up"}">${esc(priority)}</span>
      <span class="rpt-badge neutral">Regime ${esc(regime.tag || "—")}</span>
      <span class="rpt-badge neutral">${esc(b.searchMode || "")}</span>
      <span class="rpt-badge neutral">${esc(b.sentiment?.confidenceLabel || "uncalibrated")}</span>
    </div>
    <p class="rpt-meta">IHSG <span class="rpt-mono">${fmtNum(ihsg.close)}</span>
      (<span class="rpt-mono ${clsSign(ihsg.changePct)}">${signed(ihsg.changePct)}%</span>)</p>
    <p class="rpt-meta">${esc(regime.note || "")}${regime.note ? " · " : ""}coverage ${fmt(b.dataQuality?.coveragePct)}% · ${esc(b.runId || "")}</p>
  </header>

  <details class="rpt-section" open>
    <summary>1 · Judge &amp; sentimen</summary>
    <div class="rpt-body">
      <p class="rpt-lead">${esc(b.sentiment?.judgeRationale || "—")}</p>
      <div class="rpt-grid-2">
        <div class="rpt-panel">
          <h4>Fear</h4>
          <p>${esc(b.sentiment?.fear?.summary || "—")}</p>
        </div>
        <div class="rpt-panel">
          <h4>Positive</h4>
          <p>${esc(b.sentiment?.positive?.summary || "—")}</p>
        </div>
      </div>
    </div>
  </details>

  <details class="rpt-section" open>
    <summary>2 · Kondisi IHSG &amp; regime</summary>
    <div class="rpt-body">
      <dl class="rpt-kv">
        <dt>Regime</dt><dd><strong>${esc(b.marketWide?.regimeTag || regime.tag || "—")}</strong></dd>
        <dt>Follow money</dt><dd>${esc(b.marketWide?.followMoneyThesis || "—")}</dd>
        <dt>Best move</dt><dd>${esc(b.marketWide?.bestMoveOverall || "—")}</dd>
      </dl>
      <h4 class="rpt-muted" style="margin:1rem 0 .35rem;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase">Horizon IHSG</h4>
      ${ihsgHorizon}
      <h4 class="rpt-muted" style="margin:1rem 0 .35rem;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase">Themes</h4>
      ${themeChips || `<p class="rpt-muted">—</p>`}
      <h4 class="rpt-muted" style="margin:1rem 0 .35rem;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase">Unexplained</h4>
      ${unexChips || `<p class="rpt-muted">—</p>`}
    </div>
  </details>

  <details class="rpt-section">
    <summary>3 · Globals</summary>
    <div class="rpt-body">
      <table class="rpt-table">
        <thead><tr><th>Symbol</th><th>1d</th><th>Context</th></tr></thead>
        <tbody>${globalsRows || `<tr><td colspan="3" class="rpt-muted">—</td></tr>`}</tbody>
      </table>
    </div>
  </details>

  <details class="rpt-section" open>
    <summary>4 · Shortlist (${(b.shortlist || []).length})</summary>
    <div class="rpt-body">
      ${cards || `<p class="rpt-muted">Kosong</p>`}
    </div>
  </details>

  <details class="rpt-section">
    <summary>5 · Alur keputusan</summary>
    <div class="rpt-body">
      ${flowSteps(b)}
    </div>
  </details>

  <footer class="rpt-footer">
    <p>${esc(b.disclaimer || "Bukan saran investasi. Keputusan akhir di user.")}</p>
    <p>Stance: follow the money · FOMO boleh · jangan exit liquidity · no AI loss-aversion</p>
  </footer>
</div>
</div>`;
}

export function renderDeepDiveHtml(d) {
  if (!d) return emptyBox("Empty deep dive");

  const c = d.company || {};
  const f = d.financials || {};
  const p = d.prospects || {};
  const ca = d.corporateActions || [];
  const risks = d.risks || [];
  const cats = d.catalysts || [];
  const needles = d.needles || [];
  const fc = d.forecast || {};
  const ctx = d.marketContext || d.context;

  return `
<div class="rpt ${isDark() ? "rpt-dark" : ""}">
<div class="rpt-wrap">
  <header class="rpt-head">
    <p class="rpt-kicker">Deep dive · emiten</p>
    <h1>${esc(d.ticker || "")} · ${esc(c.name || "—")}</h1>
    <div class="rpt-badges">
      <span class="rpt-badge neutral">${esc(c.sector || "sektor?")}</span>
      <span class="rpt-badge ${fc.lean === "positive" ? "up" : fc.lean === "fear" ? "down" : "neutral"}">Lean ${esc(fc.lean || "—")}</span>
      <span class="rpt-badge neutral">${esc(d.searchMode || "")}</span>
      <span class="rpt-badge neutral">${esc(d.confidenceLabel || "uncalibrated")}</span>
    </div>
    <p class="rpt-meta">${esc(c.oneLiner || "")}</p>
    <p class="rpt-meta">as of ${esc(d.asOfSession || "")} · ${esc(d.runId || "")}</p>
  </header>

  <details class="rpt-section" open>
    <summary>1 · Bisnis &amp; identitas</summary>
    <div class="rpt-body">
      <dl class="rpt-kv">
        <dt>Perusahaan</dt><dd>${esc(c.name || "—")}</dd>
        <dt>Sektor</dt><dd>${esc(c.sector || "—")}</dd>
        <dt>Bisnis</dt><dd>${esc(c.business || "—")}</dd>
        <dt>Produk / jasa</dt><dd>${esc(c.products || "—")}</dd>
        <dt>Moat / posisi</dt><dd>${esc(c.positioning || "—")}</dd>
      </dl>
    </div>
  </details>

  <details class="rpt-section" open>
    <summary>2 · Konteks harga &amp; market</summary>
    <div class="rpt-body">
      ${horizonTable(ctx)}
      <dl class="rpt-kv">
        <dt>vs IHSG</dt><dd class="rpt-mono">${esc(fmtVs(d.vsIhsg))}</dd>
        <dt>Regime market</dt><dd>${esc(d.marketRegime?.tag || "—")} — ${esc(d.marketRegime?.note || "")}</dd>
      </dl>
    </div>
  </details>

  <details class="rpt-section" open>
    <summary>3 · Finansial &amp; lapkeu (dari riset)</summary>
    <div class="rpt-body">
      <dl class="rpt-kv">
        <dt>Ringkas</dt><dd>${esc(f.summary || "—")}</dd>
        <dt>Revenue / margin</dt><dd>${esc(f.revenueMargin || "—")}</dd>
        <dt>Balance / utang</dt><dd>${esc(f.balanceSheet || "—")}</dd>
        <dt>Cash flow</dt><dd>${esc(f.cashFlow || "—")}</dd>
        <dt>Valuasi kasar</dt><dd>${esc(f.valuationNotes || "—")}</dd>
        <dt>Sumber</dt><dd>${esc((f.sources || []).join(" · ") || "—")}</dd>
      </dl>
    </div>
  </details>

  <details class="rpt-section" open>
    <summary>4 · Proyek, prospek, aksi korporasi</summary>
    <div class="rpt-body">
      <div class="rpt-panel" style="margin-top:.9rem">
        <h4>Prospek</h4>
        <p>${esc(p.summary || "—")}</p>
      </div>
      <div class="rpt-panel" style="margin-top:.65rem">
        <h4>Proyek / pipeline</h4>
        <p>${esc(p.projects || "—")}</p>
      </div>
      <h4 class="rpt-muted" style="margin:1rem 0 .35rem;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase">Corporate actions</h4>
      ${
        ca.length
          ? `<ul class="rpt-list">${ca.map((x) => `<li><strong>${esc(x.type || "")}</strong> — ${esc(x.detail || "")} <span class="rpt-muted">(${esc(x.date || "?")})</span></li>`).join("")}</ul>`
          : `<p class="rpt-muted">Tidak ketemu / unexplained</p>`
      }
    </div>
  </details>

  <details class="rpt-section" open>
    <summary>5 · Katalis, risiko, needles</summary>
    <div class="rpt-body">
      <h4 class="rpt-muted" style="margin:.9rem 0 .35rem;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase">Katalis harga</h4>
      ${listOrDash(cats)}
      <h4 class="rpt-muted" style="margin:1rem 0 .35rem;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase">Risiko</h4>
      ${listOrDash(risks, "warn")}
      <h4 class="rpt-muted" style="margin:1rem 0 .35rem;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase">Needles (temuan non-obvious)</h4>
      ${listOrDash(needles)}
    </div>
  </details>

  <details class="rpt-section" open>
    <summary>6 · Forecast &amp; best move</summary>
    <div class="rpt-body">
      <dl class="rpt-kv">
        <dt>Thesis</dt><dd>${esc(fc.thesis || "—")}</dd>
        <dt>Horizon</dt><dd>${esc(fc.horizon || "—")}</dd>
        <dt>Invalidation</dt><dd>${esc(fc.invalidation || "—")}</dd>
        <dt>Best move</dt><dd>${esc(fc.bestMove || "—")}</dd>
        <dt>Exit-liq risk</dt><dd>${esc(fc.exitLiquidityRisk || "—")}</dd>
      </dl>
      <div class="rpt-scenarios">
        <div class="rpt-sc">
          <div class="lab">Base</div>
          <p class="body">${esc(fc.scenarios?.base?.narrative || "—")}</p>
          <p class="prob">p=${fmt(fc.scenarios?.base?.prob)}</p>
        </div>
        <div class="rpt-sc">
          <div class="lab">Bull</div>
          <p class="body">${esc(fc.scenarios?.bull?.narrative || "—")}</p>
          <p class="prob">p=${fmt(fc.scenarios?.bull?.prob)}</p>
        </div>
        <div class="rpt-sc">
          <div class="lab">Bear</div>
          <p class="body">${esc(fc.scenarios?.bear?.narrative || "—")}</p>
          <p class="prob">p=${fmt(fc.scenarios?.bear?.prob)}</p>
        </div>
      </div>
    </div>
  </details>

  <details class="rpt-section">
    <summary>7 · Sumber riset</summary>
    <div class="rpt-body">
      ${
        (d.sources || []).length
          ? `<ul class="rpt-list">${(d.sources || []).map((s) => `<li>${esc(s.title || s.url || s)} ${s.url ? `<span class="rpt-muted">— ${esc(s.url)}</span>` : ""}</li>`).join("")}</ul>`
          : `<p class="rpt-muted">—</p>`
      }
      <p class="rpt-muted" style="margin-top:.75rem">Unexplained: ${esc((d.unexplained || []).join("; ") || "—")}</p>
    </div>
  </details>

  <footer class="rpt-footer">
    <p>${esc(d.disclaimer || "Bukan saran investasi. Deep dive berbasis berita/data publik + heuristik; verifikasi manual.")}</p>
  </footer>
</div>
</div>`;
}

function renderTickerCard(s) {
  const st = s.stance || {};
  const risk = st.exitLiquidityRisk || "low";
  const agg = st.aggressionAllowed;
  const chg = s.metrics?.changePct;
  const why = Array.isArray(s.whySelected) ? s.whySelected : [];

  return `
  <article class="rpt-card">
    <div class="rpt-card-head">
      <h3>${esc(s.ticker)}</h3>
      <div class="rpt-badges" style="margin:0">
        <span class="rpt-badge ${agg ? "up" : "down"}">${agg ? "Follow money OK" : "No aggression"}</span>
        <span class="rpt-badge ${risk === "high" ? "down" : risk === "med" ? "neutral" : "up"}">Exit-liq ${esc(risk)}</span>
      </div>
    </div>
    <div class="rpt-card-metrics">
      <span class="${clsSign(chg)}">1d ${signed(chg)}%</span>
      <span>rvol <span class="rpt-mono">${fmt(s.metrics?.rvol)}</span></span>
      <span>z <span class="rpt-mono">${fmt(s.metrics?.zRet)}</span></span>
      <span>vs IHSG ${esc(fmtVs(s.vsIhsg))}</span>
    </div>
    ${horizonTable(s.context)}
    <div style="margin-top:.75rem">${chips(why)}</div>
    <dl class="rpt-kv">
      <dt>FOMO / flow</dt><dd>${esc(st.fomoThesis || s.followMoney?.asymmetryNote || "—")}</dd>
      <dt>Invalidation</dt><dd>${esc(st.invalidation || "—")}</dd>
      <dt>Horizon</dt><dd>${esc(st.timeHorizon || "—")}</dd>
      <dt>Best move</dt><dd>${esc(s.bestMoveFraming || "—")}</dd>
    </dl>
    <div class="rpt-scenarios">
      <div class="rpt-sc">
        <div class="lab">Base</div>
        <p class="body">${esc(s.scenarios?.base?.narrative || "—")}</p>
        <p class="prob">p=${fmt(s.scenarios?.base?.prob)} · ${esc(s.scenarios?.base?.horizon || "")}</p>
      </div>
      <div class="rpt-sc">
        <div class="lab">Bull</div>
        <p class="body">${esc(s.scenarios?.bull?.narrative || "—")}</p>
        <p class="prob">p=${fmt(s.scenarios?.bull?.prob)}</p>
      </div>
      <div class="rpt-sc">
        <div class="lab">Bear</div>
        <p class="body">${esc(s.scenarios?.bear?.narrative || "—")}</p>
        <p class="prob">p=${fmt(s.scenarios?.bear?.prob)}</p>
      </div>
    </div>
  </article>`;
}

function horizonTable(ctx) {
  if (!ctx || !ctx.ok) {
    return `<p class="rpt-muted" style="margin-top:.75rem">Context horizon tidak tersedia (force refresh data).</p>`;
  }
  const rows = [
    ["1d", ctx.d1?.retPct, null, null, ctx.d1?.rvol != null ? `rvol ${fmt(ctx.d1.rvol)}` : "—"],
    ["1w", ctx.w1?.retPct, ctx.w1?.slopeDeg, ctx.w1?.structure, "—"],
    ["1m", ctx.m1?.retPct, ctx.m1?.slopeDeg, ctx.m1?.structure, ctx.m1?.volAnnPct != null ? `vol ${fmt(ctx.m1.volAnnPct)}%` : "—"]
  ];
  if (ctx.y1) {
    rows.push(["1y", ctx.y1.retPct, ctx.y1.slopeDeg, "—", ctx.y1.volAnnPct != null ? `vol ${fmt(ctx.y1.volAnnPct)}%` : "—"]);
  }
  const body = rows
    .map(
      ([h, ret, slope, struct, extra]) => `<tr>
      <td>${h}</td>
      <td class="num ${clsSign(ret)}">${signed(ret)}%</td>
      <td class="num">${slope == null ? "—" : signed(slope) + "°"}</td>
      <td>${esc(struct || "—")}</td>
      <td class="rpt-muted">${esc(extra)}</td>
    </tr>`
    )
    .join("");
  return `
  <table class="rpt-table">
    <thead>
      <tr><th>Horizon</th><th>Return</th><th>Slope</th><th>Structure</th><th>Note</th></tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
  <p class="rpt-meta" style="margin-top:.5rem">Vol ATR ${fmt(ctx.vol?.atrPct14)}% · realized ${fmt(ctx.vol?.realizedVol20dAnnPct)}% ann · volume ${esc(ctx.vol?.volumeTrend || "—")}</p>`;
}

function flowSteps(b) {
  const steps = [
    `IHSG ${b.marketRegime?.tag || "—"}`,
    b.sentiment?.judgeLean ? `Lean ${b.sentiment.judgeLean}` : null,
    b.marketWide?.bestMoveOverall ? truncate(b.marketWide.bestMoveOverall, 48) : "Best move",
    (b.shortlist || []).some((s) => s.stance?.exitLiquidityRisk === "high")
      ? "Exit-liq flags"
      : "No high exit-liq"
  ].filter(Boolean);

  return `<div class="rpt-flow">${steps
    .map(
      (s, i) =>
        `${i ? `<span class="rpt-flow-arrow">→</span>` : ""}<span class="rpt-flow-step">${esc(s)}</span>`
    )
    .join("")}</div>`;
}

function chips(items, tone = "") {
  const arr = (items || []).filter(Boolean);
  if (!arr.length) return "";
  return `<ul class="rpt-chips">${arr
    .map((t) => `<li class="rpt-chip ${tone}">${esc(String(t))}</li>`)
    .join("")}</ul>`;
}

function listOrDash(items, tone = "") {
  const arr = (items || []).filter(Boolean);
  if (!arr.length) return `<p class="rpt-muted">—</p>`;
  return `<ul class="rpt-list">${arr
    .map((x) => {
      if (typeof x === "string") return `<li>${esc(x)}</li>`;
      return `<li><strong>${esc(x.title || x.claim || "")}</strong> — ${esc(x.detail || x.why || "")}</li>`;
    })
    .join("")}</ul>`;
}

function emptyBox(msg) {
  return `<div class="rpt"><div class="rpt-wrap"><p class="rpt-muted">${esc(msg)}</p></div></div>`;
}

export function buildExportHtml(b) {
  const full = b?.kind === "deep_dive" ? renderDeepDiveHtml(b) : renderBriefingHtml(b);
  // Extract inner wrap content for standalone shell
  let inner = full;
  const m = full.match(/<div class="rpt-wrap">([\s\S]*)<\/div>\s*<\/div>\s*$/);
  if (m) inner = m[1];
  return wrapStandaloneHtml({
    title:
      b?.kind === "deep_dive"
        ? `Deep dive ${b.ticker || ""}`
        : `IHSG Briefing ${b?.asOfSession || ""}`,
    bodyHtml: inner,
    reportJson: b
  });
}

export function injectReportStylesOnce() {
  let style = document.getElementById("report-theme-css");
  if (!style) {
    style = document.createElement("style");
    style.id = "report-theme-css";
    document.head.appendChild(style);
  }
  // always refresh CSS (fixes stale inject)
  style.textContent = REPORT_CSS;
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

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark-mode");
}
function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return String(Math.round(Number(n) * 100) / 100);
}
function fmtNum(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });
}
function signed(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const x = Math.round(Number(n) * 100) / 100;
  return (x > 0 ? "+" : "") + x;
}
function clsSign(n) {
  if (n == null || Number.isNaN(Number(n))) return "";
  return Number(n) > 0 ? "up" : Number(n) < 0 ? "down" : "";
}
function fmtVs(vs) {
  if (!vs) return "—";
  const a = vs.excessRet1w != null ? `1w ${signed(vs.excessRet1w)}%` : "";
  const b = vs.excessRet1m != null ? `1m ${signed(vs.excessRet1m)}%` : "";
  return [a, b].filter(Boolean).join(" · ") || "—";
}
function truncate(s, n) {
  const t = String(s || "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
