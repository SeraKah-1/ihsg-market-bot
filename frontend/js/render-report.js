/**
 * Structured JSON → human-readable HTML (briefing + deep dive).
 * Setiap angka: tile terpisah + warna + makna. Bukan dump jargon.
 */
import { REPORT_CSS, wrapStandaloneHtml } from "./report-theme.js";
import {
  glossRvol,
  glossChangePct,
  glossZret,
  glossStructure,
  glossVolumeTrend,
  glossRegime,
  glossExcess,
  plainFromHard,
  plainMarketFromHard,
  heuristicPriceOutlook,
  outlookBadgeClass,
  outlookLabel
} from "./metric-gloss.js";

export function renderBriefingHtml(b) {
  if (!b) return emptyBox("Empty briefing");

  updateKpisFromBriefing(b);

  const lean = b.sentiment?.judgeLean || "—";
  const priority = b.sentiment?.judgePriority || "mixed";
  const ihsg = b.ihsg || {};
  const regime = b.marketRegime || {};
  const leanCls = lean === "positive" ? "up" : lean === "fear" ? "down" : "neutral";
  const mw = b.marketWide || {};
  const plainM = {
    ...plainMarketFromHard({
      marketRegime: regime,
      ihsg,
      breadth: b.breadth
    }),
    ...(mw.plain || {}),
    plainHeadline: mw.plainHeadline || mw.plain?.plainHeadline,
    whatItMeans: mw.whatItMeans || mw.plain?.whatItMeans,
    nextActions: mw.nextActions || mw.plain?.nextActions
  };

  const macroTag = mw.macroOutlook?.tag || mw.outlookTag || "biasa";
  const fundTag = mw.fundamentalsOutlook?.tag || null;

  const cards = (b.shortlist || []).map((s) => renderTickerCard(s)).join("");

  const ihsgMetrics = [
    glossChangePct(ihsg.changePct, "IHSG 1 hari"),
    glossRegime(regime.tag || mw.regimeTag),
    glossVolumeTrend(ihsg.context?.vol?.volumeTrend),
    {
      label: "Breadth (naik/turun)",
      value:
        b.breadth?.total != null
          ? `${b.breadth.adv ?? 0} / ${b.breadth.dec ?? 0}`
          : "—",
      tone:
        (b.breadth?.adv || 0) > (b.breadth?.dec || 0)
          ? "up"
          : (b.breadth?.adv || 0) < (b.breadth?.dec || 0)
            ? "down"
            : "neutral",
      meaning:
        b.breadth?.total != null
          ? `Dari sampel: ${b.breadth.adv ?? 0} emiten naik, ${b.breadth.dec ?? 0} turun. Breadth lemah = drop indeks tidak “sehat” untuk beta chase.`
          : "Breadth tidak tersedia."
    }
  ];

  return `
<div class="rpt ${isDark() ? "rpt-dark" : ""}">
<div class="rpt-wrap">
  <header class="rpt-head">
    <p class="rpt-kicker">Market briefing · dibaca manusia</p>
    <h1>IHSG · ${esc(b.asOfSession || "")}</h1>
    <div class="rpt-badges">
      <span class="rpt-badge ${leanCls}">Bias ${esc(leanId(lean))}</span>
      <span class="rpt-badge ${priority === "avoid_exit_liq" ? "down" : priority === "follow_money" ? "up" : "neutral"}">${esc(priorityId(priority))}</span>
      <span class="rpt-badge ${outlookBadgeClass(macroTag)}">${esc(outlookLabel(macroTag))} (makro/tape)</span>
      ${fundTag ? `<span class="rpt-badge ${outlookBadgeClass(fundTag)}">Funda ${esc(outlookLabel(fundTag))}</span>` : ""}
      <span class="rpt-badge neutral">${esc(regime.tag || "—")}</span>
    </div>
    <p class="rpt-meta">IHSG <span class="rpt-mono">${fmtNum(ihsg.close)}</span>
      · <span class="rpt-mono ${clsSign(ihsg.changePct)}">${signed(ihsg.changePct)}%</span>
      · coverage ${fmt(b.dataQuality?.coveragePct)}%</p>
  </header>

  <details class="rpt-section" open>
    <summary>Inti: apa yang terjadi &amp; apa yang dilakukan</summary>
    <div class="rpt-body">
      <p class="rpt-lead">${esc(
        plainM.plainHeadline ||
          b.sentiment?.judgeRationale ||
          plainMarketFromHard({ marketRegime: regime, ihsg, breadth: b.breadth }).plainHeadline
      )}</p>
      <div class="rpt-qa">
        <div class="rpt-qa-item">
          <p class="q">Apa artinya</p>
          <p class="a">${esc(
            plainM.whatItMeans ||
              b.sentiment?.judgeRationale ||
              regime.note ||
              "—"
          )}</p>
        </div>
        <div class="rpt-qa-item">
          <p class="q">Ikuti uang / jebakan</p>
          <p class="a">${esc(mw.followMoneyThesis || "—")}</p>
        </div>
        <div class="rpt-qa-item do">
          <p class="q">Lakukan sekarang</p>
          <p class="a">${esc(mw.bestMoveOverall || "—")}</p>
        </div>
      </div>
      ${
        (plainM.nextActions || []).length
          ? `<p class="rpt-subh">Checklist</p><ul class="rpt-actions">${(plainM.nextActions || [])
              .map((x) => `<li>${esc(x)}</li>`)
              .join("")}</ul>`
          : ""
      }
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
    </div>
  </details>

  <details class="rpt-section" open>
    <summary>Angka IHSG (tiap angka = 1 kartu + makna)</summary>
    <div class="rpt-body">
      ${metricGrid(ihsgMetrics)}
      <p class="rpt-subh">Horizon IHSG</p>
      ${horizonTable(ihsg.context)}
      <p class="rpt-subh">Tema</p>
      ${chips(mw.themes || []) || `<p class="rpt-muted">—</p>`}
      <p class="rpt-subh">Yang belum ketemu sebabnya</p>
      ${chips(mw.unexplained || [], "warn") || `<p class="rpt-muted">—</p>`}
    </div>
  </details>

  <details class="rpt-section" open>
    <summary>Suara Fear vs Positive (ringkas)</summary>
    <div class="rpt-body">
      <div class="rpt-grid-2">
        <div class="rpt-panel">
          <h4>Fear · jebakan exit-liq</h4>
          <p>${esc(b.sentiment?.fear?.summary || "—")}</p>
        </div>
        <div class="rpt-panel">
          <h4>Positive · flow / FOMO fuel</h4>
          <p>${esc(b.sentiment?.positive?.summary || "—")}</p>
        </div>
      </div>
      <p class="rpt-muted" style="margin-top:.75rem">Putusan Judge: <strong>${esc(leanId(lean))}</strong> — ${esc(b.sentiment?.judgeRationale || "")}</p>
    </div>
  </details>

  <details class="rpt-section">
    <summary>Globals (konteks luar)</summary>
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
    <summary>Shortlist · apa / kenapa / lakukan (${(b.shortlist || []).length})</summary>
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
    <p>Stance: follow the money · FOMO boleh · jangan exit liquidity · angka code = fakta · prose AI = hipotesis</p>
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
  const plain = d.plain || {};
  const outlook = d.outlook || {};
  const priceTag = outlook.price || fc.priceOutlook || heuristicPriceOutlook({ context: ctx, metrics: d.metrics }).tag;
  const fundTag = outlook.fundamentals || f.outlookTag || "biasa";
  const combTag =
    outlook.combined ||
    (fc.lean === "positive" ? "cerah" : fc.lean === "fear" ? "suram" : fundTag);

  const metrics = [];
  if (d.metrics || ctx?.d1) {
    metrics.push(glossChangePct(d.metrics?.changePct ?? ctx?.d1?.retPct, "1 hari"));
    metrics.push(glossRvol(d.metrics?.rvol ?? ctx?.d1?.rvol));
    metrics.push(glossStructure(ctx?.m1?.structure || ctx?.w1?.structure));
    metrics.push(glossVolumeTrend(ctx?.vol?.volumeTrend));
    metrics.push(glossExcess(d.vsIhsg));
  }

  return `
<div class="rpt ${isDark() ? "rpt-dark" : ""}">
<div class="rpt-wrap">
  <header class="rpt-head">
    <p class="rpt-kicker">Deep dive · dibaca manusia</p>
    <h1>${esc(d.ticker || "")} · ${esc(c.name || "—")}</h1>
    <div class="rpt-badges">
      <span class="rpt-badge neutral">${esc(c.sector || "sektor?")}</span>
      <span class="rpt-badge ${outlookBadgeClass(combTag)}">${esc(outlookLabel(combTag))} (gabungan)</span>
      <span class="rpt-badge ${outlookBadgeClass(priceTag)}">Tape ${esc(outlookLabel(priceTag))}</span>
      <span class="rpt-badge ${outlookBadgeClass(fundTag)}">Lapkeu ${esc(outlookLabel(fundTag))}</span>
      <span class="rpt-badge ${fc.lean === "positive" ? "up" : fc.lean === "fear" ? "down" : "neutral"}">Lean ${esc(fc.lean || "—")}</span>
    </div>
    <p class="rpt-meta">${esc(c.oneLiner || "")}</p>
  </header>

  <details class="rpt-section" open>
    <summary>Inti: apa · kenapa · lakukan</summary>
    <div class="rpt-body">
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
      <div class="rpt-callout ${esc(String(combTag).toLowerCase())}" style="margin-top:1rem">
        <p class="co-title">Proyeksi · ${esc(outlookLabel(combTag))}</p>
        <p class="co-body">${esc(
          outlook.why ||
            fc.thesis ||
            "Gabungkan tape harga + lapkeu/sentimen/makro — lihat bagian di bawah."
        )}</p>
      </div>
    </div>
  </details>

  ${
    metrics.length
      ? `<details class="rpt-section" open>
    <summary>Angka harga (makna per kartu)</summary>
    <div class="rpt-body">
      ${metricGrid(metrics)}
      ${horizonTable(ctx)}
    </div>
  </details>`
      : ""
  }

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

  const tiles = [
    glossChangePct(s.metrics?.changePct, "1 hari"),
    glossRvol(s.metrics?.rvol),
    glossZret(s.metrics?.zRet),
    glossStructure(s.context?.m1?.structure || s.context?.w1?.structure),
    glossVolumeTrend(s.context?.vol?.volumeTrend),
    glossExcess(s.vsIhsg)
  ];

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

    <p class="rpt-subh">Angka (terpisah · berwarna · bermakna)</p>
    ${metricGrid(tiles)}

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

    <p class="rpt-subh">Horizon harga</p>
    ${horizonTable(s.context)}

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

function metricGrid(items) {
  const arr = (items || []).filter(Boolean);
  if (!arr.length) return "";
  return `<div class="rpt-metrics">${arr
    .map(
      (m) => `<div class="rpt-metric">
      <span class="m-lab">${esc(m.label)}</span>
      <span class="m-val ${esc(m.tone || "")}">${esc(m.value)}</span>
      <span class="m-hint">${esc(m.meaning || "")}</span>
    </div>`
    )
    .join("")}</div>`;
}

function scenarioBox(lab, sc) {
  sc = sc || {};
  return `<div class="rpt-sc">
    <div class="lab">${esc(lab)}</div>
    <p class="body">${esc(sc.narrative || "—")}</p>
    <p class="prob">${sc.prob != null ? `peluang ~${fmt(Number(sc.prob) * (Number(sc.prob) <= 1 ? 100 : 1))}%` : ""}${sc.horizon ? ` · ${esc(sc.horizon)}` : ""}</p>
  </div>`;
}

function horizonTable(ctx) {
  if (!ctx || !ctx.ok) {
    return `<p class="rpt-muted" style="margin-top:.75rem">Context horizon tidak tersedia (force refresh data).</p>`;
  }
  const rows = [
    {
      h: "1 hari",
      ret: ctx.d1?.retPct,
      slope: null,
      struct: null,
      note: ctx.d1?.rvol != null ? glossRvol(ctx.d1.rvol).meaning : "—"
    },
    {
      h: "1 minggu",
      ret: ctx.w1?.retPct,
      slope: ctx.w1?.slopeDeg,
      struct: ctx.w1?.structure,
      note: glossStructure(ctx.w1?.structure).meaning
    },
    {
      h: "1 bulan",
      ret: ctx.m1?.retPct,
      slope: ctx.m1?.slopeDeg,
      struct: ctx.m1?.structure,
      note:
        ctx.m1?.volAnnPct != null
          ? `Vol ~${fmt(ctx.m1.volAnnPct)}% ann. ${glossStructure(ctx.m1?.structure).meaning}`
          : glossStructure(ctx.m1?.structure).meaning
    }
  ];
  if (ctx.y1) {
    rows.push({
      h: "1 tahun",
      ret: ctx.y1.retPct,
      slope: ctx.y1.slopeDeg,
      struct: null,
      note: ctx.y1.volAnnPct != null ? `Vol ~${fmt(ctx.y1.volAnnPct)}% ann` : "—"
    });
  }
  const body = rows
    .map(
      (r) => `<tr>
      <td>${esc(r.h)}</td>
      <td class="num ${clsSign(r.ret)}">${signed(r.ret)}%</td>
      <td class="num">${r.slope == null ? "—" : signed(r.slope) + "°"}</td>
      <td>${esc(r.struct || "—")}</td>
      <td class="rpt-muted">${esc(r.note)}</td>
    </tr>`
    )
    .join("");
  const vt = glossVolumeTrend(ctx.vol?.volumeTrend);
  return `
  <table class="rpt-table">
    <thead>
      <tr>
        <th>Jangka</th>
        <th>Return</th>
        <th>Kemiringan</th>
        <th>Struktur</th>
        <th>Arti</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
  <p class="rpt-meta" style="margin-top:.5rem">
    ATR ~${fmt(ctx.vol?.atrPct14)}% · vol realisasi ~${fmt(ctx.vol?.realizedVol20dAnnPct)}%/th ·
    volume: <span class="${vt.tone}">${esc(vt.value)}</span> — ${esc(vt.meaning)}
  </p>`;
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
