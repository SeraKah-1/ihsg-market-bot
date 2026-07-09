/**
 * Pure JSON → HTML (no LLM). Scanable badges.
 */
export function renderBriefingHtml(b) {
  if (!b) return "<p>Empty</p>";
  const lean = b.sentiment?.judgeLean || "—";
  const priority = b.sentiment?.judgePriority || "mixed";
  const ihsg = b.ihsg || {};
  const cards = (b.shortlist || [])
    .map((s) => {
      const st = s.stance || {};
      const risk = st.exitLiquidityRisk || "low";
      const agg = st.aggressionAllowed;
      return `<article class="card">
      <header>
        <h3>${esc(s.ticker)}
          <span class="badge ${agg ? "badge-follow" : "badge-exit"}">${agg ? "FOLLOW MONEY OK" : "NO AGGRESSION"}</span>
          <span class="badge badge-exit">EXIT-LIQ ${esc(risk)}</span>
        </h3>
        <div class="${(s.metrics?.changePct || 0) >= 0 ? "up" : "down"}">
          ${fmt(s.metrics?.changePct)}% · rvol ${fmt(s.metrics?.rvol)} · z ${fmt(s.metrics?.zRet)}
        </div>
      </header>
      <p><b>Why:</b> ${esc((s.whySelected || []).join(", "))}</p>
      <p><b>FOMO thesis:</b> ${esc(st.fomoThesis || s.followMoney?.asymmetryNote || "—")}</p>
      <p><b>Invalidation:</b> ${esc(st.invalidation || "—")}</p>
      <p><b>Horizon:</b> ${esc(st.timeHorizon || "—")}</p>
      <p><b>Best move:</b> ${esc(s.bestMoveFraming || "—")}</p>
      <p><b>Base:</b> ${esc(s.scenarios?.base?.narrative || "—")}
         (p=${fmt(s.scenarios?.base?.prob)})</p>
      <p class="muted"><b>Bull:</b> ${esc(s.scenarios?.bull?.narrative || "—")} ·
         <b>Bear:</b> ${esc(s.scenarios?.bear?.narrative || "—")}</p>
    </article>`;
    })
    .join("");

  const mermaid = b.diagrams?.flowMermaid
    ? `<pre class="mermaid">${esc(b.diagrams.flowMermaid)}</pre>`
    : "";

  return `
  <header class="report-head">
    <h1>IHSG Briefing · ${esc(b.asOfSession || "")}</h1>
    <div class="badges">
      <span class="badge badge-lean">LEAN ${esc(lean)}</span>
      <span class="badge ${priority === "avoid_exit_liq" ? "badge-exit" : "badge-follow"}">${esc(priority)}</span>
      <span class="badge">${esc(b.searchMode || "")}</span>
      <span class="badge">conf ${esc(b.sentiment?.confidenceLabel || "uncalibrated")}</span>
    </div>
    <p class="meta">IHSG ${fmt(ihsg.close)} (${fmt(ihsg.changePct)}%) ·
      coverage ${fmt(b.dataQuality?.coveragePct)}% · run ${esc(b.runId || "")}</p>
  </header>

  <section>
    <h2>Judge</h2>
    <p>${esc(b.sentiment?.judgeRationale || "")}</p>
    <p><b>Fear:</b> ${esc(b.sentiment?.fear?.summary || "")}</p>
    <p><b>Positive:</b> ${esc(b.sentiment?.positive?.summary || "")}</p>
  </section>

  <section>
    <h2>Market-wide</h2>
    <p><b>Regime:</b> ${esc(b.marketWide?.regimeTag || "—")}</p>
    <p><b>Themes:</b> ${esc((b.marketWide?.themes || []).join(", ") || "—")}</p>
    <p><b>Follow money:</b> ${esc(b.marketWide?.followMoneyThesis || "—")}</p>
    <p><b>Best move overall:</b> ${esc(b.marketWide?.bestMoveOverall || "—")}</p>
    <p><b>Unexplained:</b> ${esc((b.marketWide?.unexplained || []).join("; ") || "—")}</p>
  </section>

  <section>
    <h2>Globals</h2>
    <table><thead><tr><th>Symbol</th><th>%</th></tr></thead>
    <tbody>
      ${(b.globals || [])
        .map(
          (g) =>
            `<tr><td>${esc(g.label || g.symbol)}</td><td class="${(g.changePct || 0) >= 0 ? "up" : "down"}">${fmt(g.changePct)}</td></tr>`
        )
        .join("")}
    </tbody></table>
  </section>

  <section>
    <h2>Shortlist deep-dive</h2>
    ${cards}
  </section>

  <section>
    <h2>Flow diagram</h2>
    ${mermaid}
  </section>

  <footer class="muted">
    <p>${esc(b.disclaimer || "")}</p>
    <p>Stance: follow the money · FOMO boleh · jangan exit liquidity · no AI loss-aversion</p>
  </footer>`;
}

function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return String(Math.round(Number(n) * 100) / 100);
}
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
