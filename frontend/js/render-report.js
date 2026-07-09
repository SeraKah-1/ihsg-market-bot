/**
 * Structured JSON → human-readable HTML (briefing + deep dive).
 * Narasi = prose. Indikator = card + JSON terpisah (tidak nyampur teks).
 */
import { REPORT_CSS, wrapStandaloneHtml } from "./report-theme.js";
import {
  glossChangePct,
  plainFromHard,
  plainMarketFromHard,
  heuristicPriceOutlook,
  outlookBadgeClass,
  outlookLabel
} from "./metric-gloss.js";
import {
  packMarketIndicators,
  packTickerIndicators,
  chipsFromMarketPack,
  chipsFromTickerPack,
  attachIndicatorsToBriefing,
  attachIndicatorsToDeepDive
} from "./indicators-pack.js";

export function renderBriefingHtml(b) {
  if (!b) return emptyBox("Empty briefing");

  updateKpisFromBriefing(b);

  const lean = b.sentiment?.judgeLean || "—";
  const priority = b.sentiment?.judgePriority || "mixed";
  const ihsg = b.ihsg || {};
  const regime = b.marketRegime || {};
  const leanCls = lean === "positive" ? "up" : lean === "fear" ? "down" : "neutral";
  const mw = b.marketWide || {};
  const pres = b.presentation || {};
  const plainM = {
    ...plainMarketFromHard({
      marketRegime: regime,
      ihsg,
      breadth: b.breadth
    }),
    ...(mw.plain || {}),
    plainHeadline:
      pres.headline || mw.plainHeadline || mw.plain?.plainHeadline,
    whatItMeans: mw.whatItMeans || mw.plain?.whatItMeans,
    nextActions: pres.checklist || mw.nextActions || mw.plain?.nextActions
  };

  const macroTag = mw.macroOutlook?.tag || mw.outlookTag || "biasa";
  const fundTag = mw.fundamentalsOutlook?.tag || null;

  // Ensure indicators pack exists even if agent skipped attach
  if (!b.indicators) attachIndicatorsToBriefing(b, b);
  const marketInd = b.indicators?.market || packMarketIndicators(b);
  const cards = (b.shortlist || []).map((s) => renderTickerCard(s)).join("");
  const chain = Array.isArray(mw.reasoningChain) ? mw.reasoningChain : [];
  const links = Array.isArray(mw.crossTickerLinks)
    ? mw.crossTickerLinks
    : Array.isArray(b.crossTickerLinks)
      ? b.crossTickerLinks
      : [];
  const aMeta = b.analysisMeta || b.verify || {};
  const sections = Array.isArray(pres.sections) ? pres.sections : [];

  const headline =
    pres.headline ||
    plainM.plainHeadline ||
    b.sentiment?.judgeRationale ||
    plainMarketFromHard({ marketRegime: regime, ihsg, breadth: b.breadth }).plainHeadline;
  const lede =
    pres.lede ||
    b.sentiment?.analysisSummary ||
    plainM.whatItMeans ||
    "";
  const throughline = pres.throughline || mw.story || "";
  const punchline = pres.punchline || b.sentiment?.analysisSummary || "";

  return `
<div class="rpt ${isDark() ? "rpt-dark" : ""}">
<div class="rpt-wrap">
  <header class="rpt-hero">
    <p class="rpt-kicker">${esc(pres.kicker || "IHSG briefing")}</p>
    <p class="rpt-hero-title">${esc(headline || `IHSG · ${b.asOfSession || ""}`)}</p>
    ${lede ? `<p class="rpt-lede-hero">${esc(lede)}</p>` : ""}
    <div class="rpt-badges">
      <span class="rpt-badge ${leanCls}">Bias ${esc(leanId(lean))}</span>
      <span class="rpt-badge ${priority === "avoid_exit_liq" ? "down" : priority === "follow_money" ? "up" : "neutral"}">${esc(priorityId(priority))}</span>
      <span class="rpt-badge ${outlookBadgeClass(macroTag)}">${esc(outlookLabel(macroTag))} makro</span>
      ${fundTag ? `<span class="rpt-badge ${outlookBadgeClass(fundTag)}">Funda ${esc(outlookLabel(fundTag))}</span>` : ""}
      <span class="rpt-badge accent">${esc(regime.tag || "—")}</span>
    </div>
    <p class="rpt-meta">
      <span class="rpt-mono">${esc(b.asOfSession || "—")}</span>
      · IHSG <span class="rpt-mono">${fmtNum(ihsg.close)}</span>
      · <span class="rpt-mono ${clsSign(ihsg.changePct)}">${signed(ihsg.changePct)}%</span>
      · coverage ${fmt(b.dataQuality?.coveragePct)}%
      ${b.writerMeta?.mode ? ` · writer ${esc(b.writerMeta.mode)}` : ""}
    </p>
    <div class="rpt-export-bar">
      <button type="button" class="rpt-export-btn primary" data-export="html">Export HTML</button>
      <button type="button" class="rpt-export-btn" data-export="json">Export JSON</button>
    </div>
  </header>

  <details class="rpt-section" open>
    <summary>Cerita &amp; keputusan</summary>
    <div class="rpt-body">
      ${throughline ? `<p class="rpt-story">${esc(throughline)}</p>` : ""}
      ${punchline ? `<p class="rpt-insight">${esc(punchline)}</p>` : ""}
      ${
        sections.length
          ? sections
              .map(
                (sec) =>
                  `<div class="rpt-panel" style="margin-top:.65rem">
                    <h4>${esc(sec.title || sec.id || "Bagian")}</h4>
                    <p>${esc(sec.body || "—")}</p>
                  </div>`
              )
              .join("")
          : `<div class="rpt-qa">
        <div class="rpt-qa-item">
          <p class="q">Apa artinya</p>
          <p class="a">${esc(plainM.whatItMeans || regime.note || "—")}</p>
        </div>
        <div class="rpt-qa-item">
          <p class="q">Ikuti uang / jebakan</p>
          <p class="a">${esc(mw.followMoneyThesis || b.sentiment?.flowWatch || "—")}</p>
        </div>
        <div class="rpt-qa-item do">
          <p class="q">Lakukan sekarang</p>
          <p class="a">${esc(mw.bestMoveOverall || "—")}</p>
        </div>
      </div>`
      }
      ${
        chain.length
          ? `<p class="rpt-subh">Rantai reasoning</p><ol class="rpt-chain">${chain
              .map((step, i) => `<li><strong>${i + 1}.</strong> ${esc(String(step))}</li>`)
              .join("")}</ol>`
          : ""
      }
      ${
        (plainM.nextActions || []).length
          ? `<p class="rpt-subh">Checklist</p><ul class="rpt-actions">${(plainM.nextActions || [])
              .map((x) => `<li>${esc(x)}</li>`)
              .join("")}</ul>`
          : ""
      }
      ${pres.closingNote ? `<p class="rpt-muted" style="margin-top:.75rem">${esc(pres.closingNote)}</p>` : ""}
      <div class="rpt-callout ${esc(String(macroTag).toLowerCase())}" style="margin-top:1rem">
        <p class="co-title">Outlook tape / makro · ${esc(outlookLabel(macroTag))}</p>
        <p class="co-body">${esc(
          mw.macroOutlook?.why ||
            mw.outlookWhy ||
            plainM.macroBackdrop ||
            regime.note ||
            "—"
        )}</p>
      </div>
      <p class="rpt-subh">Tema</p>
      ${chips(mw.themes || []) || `<p class="rpt-muted">—</p>`}
      <p class="rpt-subh">Yang belum ketemu sebabnya</p>
      ${chips(mw.unexplained || [], "warn") || `<p class="rpt-muted">—</p>`}
    </div>
  </details>

  <details class="rpt-section">
    <summary>Indikator pasar (JSON)</summary>
    <div class="rpt-body">
      ${indicatorsPanel("IHSG · breadth · regime", marketInd, chipsFromMarketPack(marketInd), true)}
    </div>
  </details>

  <details class="rpt-section" open>
    <summary>Analysis · crosscheck</summary>
    <div class="rpt-body">
      <div class="rpt-panel" style="margin-bottom:.75rem">
        <h4>Punch</h4>
        <p>${esc(b.sentiment?.analysisSummary || b.sentiment?.judgeRationale || "—")}</p>
      </div>
      <div class="rpt-grid-2">
        <div class="rpt-panel">
          <h4>Jebakan / trap</h4>
          <p>${esc(b.sentiment?.trapWatch || b.sentiment?.fear?.summary || "—")}</p>
        </div>
        <div class="rpt-panel">
          <h4>Flow / uang hidup</h4>
          <p>${esc(b.sentiment?.flowWatch || b.sentiment?.positive?.summary || "—")}</p>
        </div>
      </div>
      ${
        links.length
          ? `<p class="rpt-subh">Hubungan antar emiten</p><ul class="rpt-list">${links
              .map((x) => `<li>${esc(typeof x === "string" ? x : x.note || JSON.stringify(x))}</li>`)
              .join("")}</ul>`
          : ""
      }
      ${renderAnalysisMeta(aMeta)}
      <p class="rpt-muted" style="margin-top:.75rem">Lean: <strong>${esc(leanId(lean))}</strong> — ${esc(b.sentiment?.judgeRationale || "")}</p>
    </div>
  </details>

  <details class="rpt-section">
    <summary>Globals</summary>
    <div class="rpt-body">
      <table class="rpt-table">
        <thead><tr><th>Indeks</th><th>1 hari</th><th>Arti singkat</th></tr></thead>
        <tbody>${(b.globals || [])
          .map((g) => {
            const c = g.changePct;
            const ggloss = glossChangePct(c, g.label || "global");
            return `<tr>
              <td>${esc(g.label || g.symbol)}</td>
              <td class="num ${clsSign(c)}">${signed(c)}%</td>
              <td class="rpt-muted">${esc(g.context?.summary || g.contextSummary || ggloss.meaning)}</td>
            </tr>`;
          })
          .join("") || `<tr><td colspan="3" class="rpt-muted">—</td></tr>`}</tbody>
      </table>
    </div>
  </details>

  <details class="rpt-section" open>
    <summary>Shortlist · ${(b.shortlist || []).length} emiten</summary>
    <div class="rpt-body">
      ${cards || `<p class="rpt-muted">Kosong</p>`}
    </div>
  </details>

  <details class="rpt-section">
    <summary>Alur keputusan</summary>
    <div class="rpt-body">${flowSteps(b)}</div>
  </details>

  <footer class="rpt-footer">
    <p>${esc(b.disclaimer || "Bukan saran investasi. Keputusan akhir di user.")}</p>
    <p>Research → Analysis → Writer · narasi terpisah dari indikator JSON</p>
  </footer>
</div>
</div>`;
}

export function renderDeepDiveHtml(d) {
  if (!d) return emptyBox("Empty deep dive");
  if (!d.indicators) attachIndicatorsToDeepDive(d, { metrics: d.metrics, context: d.context || d.marketContext, vsIhsg: d.vsIhsg });

  const c = d.company || {};
  const f = d.financials || {};
  const p = d.prospects || {};
  const ca = d.corporateActions || [];
  const risks = d.risks || [];
  const cats = d.catalysts || [];
  const needles = d.needles || [];
  const fc = d.forecast || {};
  const plain = d.plain || {};
  const outlook = d.outlook || {};
  const ind = d.indicators || packTickerIndicators({
    ticker: d.ticker,
    metrics: d.metrics,
    context: d.context || d.marketContext,
    vsIhsg: d.vsIhsg
  });
  const hardRow = {
    metrics: d.metrics,
    context: d.context || d.marketContext
  };
  const priceTag =
    outlook.price || fc.priceOutlook || heuristicPriceOutlook(hardRow).tag;
  const fundTag = outlook.fundamentals || f.outlookTag || "biasa";
  const combTag =
    outlook.combined ||
    (fc.lean === "positive" ? "cerah" : fc.lean === "fear" ? "suram" : fundTag);

  return `
<div class="rpt ${isDark() ? "rpt-dark" : ""}">
<div class="rpt-wrap">
  <header class="rpt-hero">
    <p class="rpt-kicker">Deep dive · ${esc(d.ticker || "")}</p>
    <p class="rpt-hero-title">${esc(d.ticker || "")}${c.name ? ` · ${esc(c.name)}` : ""}</p>
    ${c.oneLiner ? `<p class="rpt-lede-hero">${esc(c.oneLiner)}</p>` : ""}
    <div class="rpt-badges">
      <span class="rpt-badge neutral">${esc(c.sector || "sektor?")}</span>
      <span class="rpt-badge ${outlookBadgeClass(combTag)}">${esc(outlookLabel(combTag))} gabungan</span>
      <span class="rpt-badge ${outlookBadgeClass(priceTag)}">Tape ${esc(outlookLabel(priceTag))}</span>
      <span class="rpt-badge ${outlookBadgeClass(fundTag)}">Lapkeu ${esc(outlookLabel(fundTag))}</span>
      <span class="rpt-badge ${fc.lean === "positive" ? "up" : fc.lean === "fear" ? "down" : "neutral"}">Lean ${esc(fc.lean || "—")}</span>
    </div>
    <p class="rpt-meta"><span class="rpt-mono">${esc(d.asOfSession || d.day || "—")}</span></p>
    <div class="rpt-export-bar">
      <button type="button" class="rpt-export-btn primary" data-export="html">Export HTML</button>
      <button type="button" class="rpt-export-btn" data-export="json">Export JSON</button>
    </div>
  </header>

  <details class="rpt-section" open>
    <summary>Narasi: apa · kenapa · lakukan</summary>
    <div class="rpt-body">
      ${d.story ? `<p class="rpt-story">${esc(d.story)}</p>` : ""}
      <div class="rpt-qa">
        <div class="rpt-qa-item">
          <p class="q">Apa yang terjadi</p>
          <p class="a">${esc(plain.whatHappened || fc.thesis || c.oneLiner || "—")}</p>
        </div>
        <div class="rpt-qa-item">
          <p class="q">Kenapa penting</p>
          <p class="a">${esc(plain.whyItMatters || outlook.why || "—")}</p>
        </div>
        <div class="rpt-qa-item do">
          <p class="q">Lakukan</p>
          <p class="a">${esc(plain.whatToDo || fc.bestMove || "—")}</p>
        </div>
        <div class="rpt-qa-item warn">
          <p class="q">Batal jika (invalidation)</p>
          <p class="a">${esc(fc.invalidation || "—")}</p>
        </div>
      </div>
      ${
        Array.isArray(d.reasoningChain) && d.reasoningChain.length
          ? `<p class="rpt-subh">Rantai reasoning</p><ol class="rpt-chain">${d.reasoningChain
              .map((step, i) => `<li><strong>${i + 1}.</strong> ${esc(String(step))}</li>`)
              .join("")}</ol>`
          : ""
      }
      <div class="rpt-callout ${esc(String(combTag).toLowerCase())}" style="margin-top:1rem">
        <p class="co-title">Proyeksi · ${esc(outlookLabel(combTag))}</p>
        <p class="co-body">${esc(
          outlook.why ||
            fc.thesis ||
            "Gabungkan tape harga + lapkeu/sentimen/makro — lihat bagian di bawah."
        )}</p>
      </div>
      ${indicatorsPanel(`Indikator ${d.ticker || ""} (JSON)`, ind, chipsFromTickerPack(ind))}
    </div>
  </details>

  <details class="rpt-section" open>
    <summary>Bisnis</summary>
    <div class="rpt-body">
      <dl class="rpt-kv">
        <dt>Perusahaan</dt><dd>${esc(c.name || "—")}</dd>
        <dt>Sektor</dt><dd>${esc(c.sector || "—")}</dd>
        <dt>Bisnis</dt><dd>${esc(c.business || "—")}</dd>
        <dt>Produk / jasa</dt><dd>${esc(c.products || "—")}</dd>
        <dt>Posisi</dt><dd>${esc(c.positioning || "—")}</dd>
      </dl>
    </div>
  </details>

  <details class="rpt-section" open>
    <summary>Lapkeu &amp; prospek funda (${esc(outlookLabel(fundTag))})</summary>
    <div class="rpt-body">
      <div class="rpt-callout ${esc(String(fundTag).toLowerCase())}">
        <p class="co-title">Outlook fundamental</p>
        <p class="co-body">${esc(f.outlookWhy || outlook.fundamentalsWhy || f.summary || "Belum ada ringkas lapkeu — unexplained, jangan mengarang.")}</p>
      </div>
      <dl class="rpt-kv">
        <dt>Ringkas lapkeu</dt><dd>${esc(f.summary || "—")}</dd>
        <dt>Revenue / margin</dt><dd>${esc(f.revenueMargin || "—")}</dd>
        <dt>Neraca / utang</dt><dd>${esc(f.balanceSheet || "—")}</dd>
        <dt>Arus kas</dt><dd>${esc(f.cashFlow || "—")}</dd>
        <dt>Valuasi kasar</dt><dd>${esc(f.valuationNotes || "—")}</dd>
        <dt>Makro / sentimen</dt><dd>${esc(d.macroDrivers || outlook.macro || p.macro || "—")}</dd>
        <dt>Sumber</dt><dd>${esc((f.sources || []).join(" · ") || "—")}</dd>
      </dl>
      <p class="rpt-subh">Proyek / pipeline</p>
      <p>${esc(p.projects || p.summary || "—")}</p>
    </div>
  </details>

  <details class="rpt-section" open>
    <summary>Aksi korporasi · katalis · risiko · needle</summary>
    <div class="rpt-body">
      <p class="rpt-subh">Corporate actions</p>
      ${
        ca.length
          ? `<ul class="rpt-list">${ca.map((x) => `<li><strong>${esc(x.type || "")}</strong> — ${esc(x.detail || "")} <span class="rpt-muted">(${esc(x.date || "?")})</span></li>`).join("")}</ul>`
          : `<p class="rpt-muted">Tidak ketemu / unexplained</p>`
      }
      <p class="rpt-subh">Katalis</p>
      ${listOrDash(cats)}
      <p class="rpt-subh">Risiko</p>
      ${listOrDash(risks, "warn")}
      <p class="rpt-subh">Needle (non-obvious)</p>
      ${listOrDash(needles)}
    </div>
  </details>

  <details class="rpt-section" open>
    <summary>Skenario &amp; best move</summary>
    <div class="rpt-body">
      <dl class="rpt-kv">
        <dt>Thesis</dt><dd>${esc(fc.thesis || "—")}</dd>
        <dt>Horizon</dt><dd>${esc(fc.horizon || "—")}</dd>
        <dt>Best move</dt><dd>${esc(fc.bestMove || "—")}</dd>
        <dt>Exit-liq</dt><dd>${esc(fc.exitLiquidityRisk || "—")}</dd>
      </dl>
      <div class="rpt-scenarios">
        ${scenarioBox("Base", fc.scenarios?.base)}
        ${scenarioBox("Bull", fc.scenarios?.bull)}
        ${scenarioBox("Bear", fc.scenarios?.bear)}
      </div>
    </div>
  </details>

  <details class="rpt-section">
    <summary>Sumber</summary>
    <div class="rpt-body">
      ${
        (d.sources || []).length
          ? `<ul class="rpt-list">${(d.sources || [])
              .map(
                (s) =>
                  `<li>${esc(s.title || s.url || s)} ${s.url ? `<span class="rpt-muted">— ${esc(s.url)}</span>` : ""}</li>`
              )
              .join("")}</ul>`
          : `<p class="rpt-muted">—</p>`
      }
      <p class="rpt-muted" style="margin-top:.75rem">Unexplained: ${esc((d.unexplained || []).join("; ") || "—")}</p>
    </div>
  </details>

  <footer class="rpt-footer">
    <p>${esc(d.disclaimer || "Bukan saran investasi. Verifikasi lapkeu ke sumber resmi.")}</p>
  </footer>
</div>
</div>`;
}

function renderTickerCard(s) {
  const st = s.stance || {};
  const risk = st.exitLiquidityRisk || "low";
  const agg = st.aggressionAllowed;
  const why = Array.isArray(s.whySelected) ? s.whySelected : [];
  const hardPlain = plainFromHard(s);
  const plain = {
    ...hardPlain,
    ...(s.plain || {}),
    whatHappened: s.plain?.whatHappened || hardPlain.whatHappened,
    whyItMatters: s.plain?.whyItMatters || hardPlain.whyItMatters,
    whatToDo: s.plain?.whatToDo || s.bestMoveFraming || hardPlain.whatToDo
  };
  const fund = s.fundamentals || {};
  const priceOut = s.outlook?.price || hardPlain.outlookTag;
  const fundOut = fund.outlookTag || s.outlook?.fundamentals || "biasa";
  const combOut = s.outlook?.combined || (risk === "high" ? "suram" : priceOut);
  const ind = s.indicators || packTickerIndicators(s);
  const narrative = s.narrative || "";

  return `
  <article class="rpt-card">
    <div class="rpt-card-head">
      <h3>${esc(s.ticker)}</h3>
      <div class="rpt-badges" style="margin:0">
        <span class="rpt-badge ${outlookBadgeClass(combOut)}">${esc(outlookLabel(combOut))}</span>
        <span class="rpt-badge ${agg ? "up" : "down"}">${agg ? "Boleh ikut flow" : "Jangan agresif"}</span>
        <span class="rpt-badge ${risk === "high" ? "down" : risk === "med" ? "neutral" : "up"}">Exit-liq ${esc(riskId(risk))}</span>
      </div>
    </div>

    ${s.insight ? `<p class="rpt-insight">${esc(s.insight)}</p>` : ""}
    ${narrative ? `<p class="rpt-story">${esc(narrative)}</p>` : ""}

    <div class="rpt-qa">
      <div class="rpt-qa-item">
        <p class="q">Apa yang terjadi</p>
        <p class="a">${esc(plain.whatHappened)}</p>
      </div>
      <div class="rpt-qa-item">
        <p class="q">Kenapa penting</p>
        <p class="a">${esc(plain.whyItMatters)}</p>
      </div>
      <div class="rpt-qa-item do">
        <p class="q">Lakukan</p>
        <p class="a">${esc(plain.whatToDo)}</p>
      </div>
      ${
        st.invalidation
          ? `<div class="rpt-qa-item warn"><p class="q">Batal jika</p><p class="a">${esc(st.invalidation)}</p></div>`
          : ""
      }
    </div>

    ${indicatorsPanel(`Indikator ${s.ticker} (JSON)`, ind, chipsFromTickerPack(ind), true)}

    <hr class="rpt-divider"/>

    <div class="rpt-grid-2">
      <div class="rpt-callout ${esc(String(priceOut).toLowerCase())}">
        <p class="co-title">Outlook tape · ${esc(outlookLabel(priceOut))}</p>
        <p class="co-body">${esc(s.outlook?.priceWhy || plain.outlookWhy || hardPlain.outlookWhy)}</p>
      </div>
      <div class="rpt-callout ${esc(String(fundOut).toLowerCase())}">
        <p class="co-title">Outlook lapkeu/funda · ${esc(outlookLabel(fundOut))}</p>
        <p class="co-body">${esc(
          fund.summary ||
            fund.outlookWhy ||
            s.outlook?.fundamentalsWhy ||
            "Belum ada data lapkeu di riset sesi ini — treat as unexplained, jangan tebak angka."
        )}</p>
      </div>
    </div>

    ${
      s.hiddenNotes
        ? `<p class="rpt-subh">Hidden / deep</p><p>${esc(s.hiddenNotes)}</p>`
        : ""
    }

    <p class="rpt-subh">Alasan masuk shortlist</p>
    ${chips(why) || `<p class="rpt-muted">—</p>`}

    <p class="rpt-subh">FOMO / flow (hipotesis)</p>
    <p>${esc(st.fomoThesis || s.followMoney?.asymmetryNote || "—")}</p>

    <p class="rpt-subh">Skenario</p>
    <div class="rpt-scenarios">
      ${scenarioBox("Base", s.scenarios?.base)}
      ${scenarioBox("Bull", s.scenarios?.bull)}
      ${scenarioBox("Bear", s.scenarios?.bear)}
    </div>
  </article>`;
}

function renderAnalysisMeta(aMeta) {
  if (!aMeta || typeof aMeta !== "object") return "";
  const hidden = aMeta.hiddenContext || [];
  const missed = aMeta.missedByResearch || aMeta.missedItems || [];
  const doubts = aMeta.residualDoubts || [];
  const checks = aMeta.crossChecks || [];
  const note = aMeta.note || "";
  if (!hidden.length && !missed.length && !doubts.length && !checks.length && !note) {
    return "";
  }
  return `
    <div class="rpt-panel" style="margin-top:.85rem">
      <h4>Verifikasi Analysis</h4>
      ${note ? `<p>${esc(note)}</p>` : ""}
      ${
        checks.length
          ? `<p class="rpt-subh">Crosscheck</p><ul class="rpt-list">${checks
              .map((c) => {
                if (typeof c === "string") return `<li>${esc(c)}</li>`;
                return `<li><strong>${esc(c.verdict || "—")}</strong> — ${esc(c.claim || "")} <span class="rpt-muted">(${esc(c.vs || "")}) ${esc(c.note || "")}</span></li>`;
              })
              .join("")}</ul>`
          : ""
      }
      ${
        hidden.length
          ? `<p class="rpt-subh">Hidden / deep context</p><ul class="rpt-list">${hidden
              .map((x) => `<li>${esc(typeof x === "string" ? x : x.note || JSON.stringify(x))}</li>`)
              .join("")}</ul>`
          : ""
      }
      ${
        missed.length
          ? `<p class="rpt-subh">Yang kira-kira dilewat Research</p><ul class="rpt-list">${missed
              .map((x) => `<li>${esc(String(x))}</li>`)
              .join("")}</ul>`
          : ""
      }
      ${
        doubts.length
          ? `<p class="rpt-subh">Sisa ragu</p><ul class="rpt-list">${doubts
              .map((x) => `<li>${esc(String(x))}</li>`)
              .join("")}</ul>`
          : ""
      }
    </div>`;
}

/** Collapsible vault: chips + pretty JSON — keeps numbers out of narrative */
function indicatorsPanel(title, jsonObj, chipList, open = false) {
  if (!jsonObj) return "";
  const chipsHtml = (chipList || []).length
    ? `<ul class="rpt-ind-chips">${chipList
        .map(
          (c) =>
            `<li class="rpt-ind-chip ${esc(c.tone || "")}"><span class="k">${esc(c.k)}</span><span class="v">${esc(c.v)}</span></li>`
        )
        .join("")}</ul>`
    : "";
  let pretty = "";
  try {
    pretty = JSON.stringify(jsonObj, null, 2);
  } catch {
    pretty = String(jsonObj);
  }
  return `<details class="rpt-ind"${open ? " open" : ""}>
    <summary>${esc(title || "Indikator · JSON")}</summary>
    <div class="rpt-ind-body">
      ${chipsHtml}
      <pre class="rpt-ind-json">${esc(pretty)}</pre>
    </div>
  </details>`;
}

function scenarioBox(lab, sc) {
  sc = sc || {};
  return `<div class="rpt-sc">
    <div class="lab">${esc(lab)}</div>
    <p class="body">${esc(sc.narrative || "—")}</p>
    <p class="prob">${sc.prob != null ? `peluang ~${fmt(Number(sc.prob) * (Number(sc.prob) <= 1 ? 100 : 1))}%` : ""}${sc.horizon ? ` · ${esc(sc.horizon)}` : ""}</p>
  </div>`;
}

function flowSteps(b) {
  const steps = [
    `IHSG ${b.marketRegime?.tag || "—"}`,
    b.sentiment?.judgeLean ? `Bias ${leanId(b.sentiment.judgeLean)}` : null,
    b.marketWide?.bestMoveOverall ? truncate(b.marketWide.bestMoveOverall, 56) : "Best move",
    (b.shortlist || []).some((s) => s.stance?.exitLiquidityRisk === "high")
      ? "Ada flag exit-liq"
      : "Exit-liq OK"
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

function listOrDash(items) {
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
  style.textContent = REPORT_CSS;
}

export function updateKpisFromBriefing(b) {
  const leanEl = document.getElementById("kpi-lean");
  const priEl = document.getElementById("kpi-priority");
  if (leanEl) {
    leanEl.textContent = leanId(b.sentiment?.judgeLean || "—").toUpperCase();
    leanEl.classList.remove("up", "down");
    if (b.sentiment?.judgeLean === "positive") leanEl.classList.add("up");
    if (b.sentiment?.judgeLean === "fear") leanEl.classList.add("down");
  }
  if (priEl) priEl.textContent = priorityId(b.sentiment?.judgePriority || "judge");
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

function leanId(lean) {
  if (lean === "fear") return "hati-hati";
  if (lean === "positive") return "ikut flow";
  if (lean === "neutral") return "netral";
  return lean || "—";
}
function priorityId(p) {
  if (p === "avoid_exit_liq") return "hindari exit-liq";
  if (p === "follow_money") return "ikuti uang";
  if (p === "mixed") return "campuran";
  return p || "—";
}
function riskId(r) {
  if (r === "high") return "tinggi";
  if (r === "med") return "sedang";
  if (r === "low") return "rendah";
  return r;
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
