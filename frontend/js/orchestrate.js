import { appSettings, loadSettings, logLine, setStatus } from "./state.js";
import { detectSearchMode, searchModeBanner } from "./search/capability.js";
import { runResearcher } from "./agents/researcher.js";
import { runAnalysis } from "./agents/analysis.js";
import { runWriter } from "./agents/writer.js";
import {
  renderBriefingHtml,
  renderDeepDiveHtml,
  buildExportHtml,
  updateKpisFromShortlist,
  injectReportStylesOnce
} from "./render-report.js";
import { runDeepDiveAgent } from "./agents/deep-dive.js";
import {
  initAgentMemory,
  startRunMemory,
  saveAgentStep,
  loadAgentStep,
  loadCompactMemory,
  appendCompactMemory,
  finishRunMemory,
  compactResearchForDownstream,
  compactAnalysisForDownstream,
  getRunProgress,
  markRunFailed,
  cacheLastBriefing
} from "./agent-memory.js";
import { isOnline } from "./offline-store.js";

let abortCtrl = null;

export function abortRun() {
  if (abortCtrl) abortCtrl.abort();
}

/**
 * Pipeline v3 + memory bus + resume:
 * Research SAVE → Analysis LOAD → Writer LOAD
 * @param {{ skipAi?: boolean, resumeRunId?: string }} opts
 */
export async function runPipeline({ skipAi = false, resumeRunId = null } = {}) {
  loadSettings();
  if (abortCtrl) abortCtrl.abort();
  abortCtrl = new AbortController();
  const signal = abortCtrl.signal;

  let runId = resumeRunId || `run_${Date.now()}`;
  const k = appSettings.shortlistK || 8;
  const force = !!appSettings.forceRefresh;
  const max = appSettings.maxIngest > 0 ? appSettings.maxIngest : undefined;
  const resuming = !!resumeRunId;

  try {
    setStatus("Memory / auth…", "busy");
    await initAgentMemory(logLine);

    let shortlistPack = null;
    let startFrom = "research";

    if (resuming) {
      logLine(`Resume run ${runId}…`);
      const prog = await getRunProgress(runId, logLine);
      startFrom = prog.next || "research";
      shortlistPack = await loadAgentStep(runId, "shortlist", logLine);
      if (!shortlistPack) {
        throw new Error(
          "Resume gagal: shortlist tidak ada di memory. Jalankan briefing baru."
        );
      }
      renderShortlistTable(shortlistPack);
      logLine(
        `Resume next=${startFrom} steps=${Object.keys(prog.steps || {}).join(",")}`
      );
      // re-open shell as running
      await startRunMemory(
        runId,
        {
          kind: "briefing",
          day: shortlistPack.day,
          k,
          searchMode: detectSearchMode(),
          models: appSettings.models,
          resumed: true
        },
        logLine
      );
    } else {
      if (!isOnline() && !skipAi) {
        logLine("Offline — AI agents butuh router online. Data-only / lihat cache OK.", "warn");
      }
      setStatus("Ingest OHLCV…", "busy");
      logLine(`Start ${runId} K=${k} force=${force}`);

      const q = new URLSearchParams({ k: String(k) });
      if (force) q.set("force", "1");
      if (max) {
        logLine(`Ingest max=${max} tickers…`);
        const ohlcvRes = await fetch(
          "/api/market/ohlcv?" +
            new URLSearchParams({ force: force ? "1" : "0", max: String(max) }),
          { signal }
        );
        if (!ohlcvRes.ok) throw new Error(await ohlcvRes.text());
        const ohlcv = await ohlcvRes.json();
        logLine(
          `OHLCV day=${ohlcv.day} coverage=${ohlcv.coveragePct}% ok=${ohlcv.fetchedOk}/${ohlcv.universeSize} cache=${ohlcv.fromCache} ${ohlcv.elapsedMs || 0}ms`
        );
        const slRes = await fetch("/api/market/shortlist?" + q.toString(), { signal });
        if (!slRes.ok) throw new Error(await slRes.text());
        shortlistPack = await slRes.json();
      } else {
        const slRes = await fetch(
          "/api/market/shortlist?" + q.toString() + (force ? "&force=1" : ""),
          { signal }
        );
        if (!slRes.ok) throw new Error(await slRes.text());
        shortlistPack = await slRes.json();
        logLine(
          `Shortlist day=${shortlistPack.day} coverage=${shortlistPack.dataQuality?.coveragePct}% items=${shortlistPack.shortlist?.length}`
        );
      }

      renderShortlistTable(shortlistPack);

      await startRunMemory(
        runId,
        {
          kind: "briefing",
          day: shortlistPack.day,
          k,
          searchMode: detectSearchMode(),
          models: appSettings.models
        },
        logLine
      );
      await saveAgentStep(runId, "shortlist", shortlistPack, logLine);
    }

    if (skipAi) {
      await finishRunMemory(runId, "data_only", logLine);
      setStatus("Shortlist only (skip AI)", "ok");
      return { shortlistPack, briefing: null, runId };
    }

    const memory = await loadCompactMemory(10, logLine);
    const searchMode = detectSearchMode();
    logLine(searchModeBanner(searchMode));
    logLine(
      "Memory bus: Research → save → Analysis → save → Writer (Firebase+IDB)"
    );

    let researchFromMem = null;
    let researchForAnalysis = null;
    let analysisFromMem = null;
    let analysisForWriter = null;

    // 1) Research (skip if resuming past it)
    if (startFrom === "research") {
      setStatus("Research (web)…", "busy");
      let research = await runResearcher({
        shortlistPack,
        searchMode,
        memory,
        signal,
        onLog: logLine,
        runId
      });
      research.memoryRef = { runId, step: "research" };
      await saveAgentStep(runId, "research", research, logLine);
      logLine(
        `Research done mode=${research.agentMeta?.mode || "?"} findings=${(research.findings || []).length} → saved`
      );
      researchFromMem = (await loadAgentStep(runId, "research", logLine)) || research;
    } else {
      researchFromMem = await loadAgentStep(runId, "research", logLine);
      if (!researchFromMem) throw new Error("Resume: research pack hilang");
      logLine("Resume: skip Research (pakai memory)");
    }
    researchForAnalysis = compactResearchForDownstream(researchFromMem);

    // 2) Analysis
    if (startFrom === "research" || startFrom === "analysis") {
      setStatus("Analysis + verify…", "busy");
      let analysis = await runAnalysis({
        shortlistPack,
        research: researchForAnalysis,
        memory,
        searchMode,
        runId,
        signal,
        onLog: logLine
      });
      analysis.memoryRef = { runId, step: "analysis" };
      await saveAgentStep(runId, "analysis", analysis, logLine);
      logLine(
        `Analysis done lean=${analysis.sentiment?.judgeLean || "?"} → saved`
      );
      analysisFromMem = (await loadAgentStep(runId, "analysis", logLine)) || analysis;
    } else {
      analysisFromMem = await loadAgentStep(runId, "analysis", logLine);
      if (!analysisFromMem) throw new Error("Resume: analysis pack hilang");
      logLine("Resume: skip Analysis (pakai memory)");
    }
    analysisForWriter = compactAnalysisForDownstream(analysisFromMem);

    // 3) Writer
    setStatus("Writer…", "busy");
    let briefing = await runWriter({
      shortlistPack,
      research: researchForAnalysis,
      analysis: analysisForWriter,
      searchMode,
      runId,
      signal,
      onLog: logLine
    });
    briefing.researchPack = {
      hotTakes: researchFromMem.hotTakes,
      macroNote: researchFromMem.macroNote,
      searchPlan: researchFromMem.searchPlan,
      agentMeta: researchFromMem.agentMeta
    };
    briefing.pipeline = "research→analysis→writer";
    briefing.runId = runId;
    briefing.memoryBus = { runId, db: "market", path: `users/{uid}/ihsg_runs/${runId}` };
    await saveAgentStep(runId, "writer", briefing, logLine);

    // final run + compact memory
    try {
      await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...briefing, runId, final: true })
      });
    } catch {
      /* */
    }

    if (briefing.memoryWrite?.compact) {
      await appendCompactMemory(
        {
          date: briefing.asOfSession,
          ...briefing.memoryWrite.compact,
          openHypotheses: briefing.memoryWrite.openHypotheses || [],
          runId
        },
        logLine
      );
    }

    await finishRunMemory(runId, "done", logLine);

    injectReportStylesOnce();
    const html = renderBriefingHtml(briefing);
    const reportEl = document.getElementById("report-view");
    if (reportEl) reportEl.innerHTML = html;
    window.__lastBriefing = briefing;
    window.__lastShortlist = shortlistPack;
    window.__lastResearch = researchFromMem;
    window.__lastRunId = runId;
    await cacheLastBriefing(briefing, html);

    await postRender();
    refreshResumeBanner?.();

    setStatus("Selesai — " + (briefing.sentiment?.judgeLean || "?"), "ok");
    logLine(
      "Done. lean=" +
        briefing.sentiment?.judgeLean +
        " runId=" +
        runId +
        " writer=" +
        (briefing.presentation?.headline || briefing.writerMeta?.note || "").slice(0, 60)
    );
    return { shortlistPack, briefing, research: researchFromMem, analysis: analysisFromMem, runId };
  } catch (e) {
    if (e.name === "AbortError") {
      await markRunFailed(runId, "aborted", logLine);
      setStatus("Dibatalkan — bisa Resume", "warn");
      logLine("Aborted — progress tersimpan", "warn");
      refreshResumeBanner?.();
      return null;
    }
    console.error(e);
    await markRunFailed(runId, e.message || e, logLine);
    setStatus("Error — progress tersimpan, Resume OK", "err");
    logLine(String(e.message || e) + ` · runId=${runId} → Resume`, "err");
    refreshResumeBanner?.();
    throw e;
  }
}

/** Hook set by app.js for resume UI */
export let refreshResumeBanner = null;
export function setResumeBannerRefresh(fn) {
  refreshResumeBanner = fn;
}

export async function resumePipeline(runId) {
  if (!runId) throw new Error("runId kosong");
  return runPipeline({ skipAi: false, resumeRunId: runId });
}

export async function runDeepDive(tickerRaw) {
  loadSettings();
  if (abortCtrl) abortCtrl.abort();
  abortCtrl = new AbortController();
  const signal = abortCtrl.signal;
  const ticker = String(tickerRaw || "")
    .toUpperCase()
    .replace(/\.JK$/i, "")
    .trim();
  if (!/^[A-Z]{3,4}$/.test(ticker)) {
    setStatus("Ticker invalid (3–4 huruf)", "err");
    logLine("Deep dive: ticker invalid " + tickerRaw, "err");
    return null;
  }

  const runId = `deep_${ticker}_${Date.now()}`;
  try {
    await initAgentMemory(logLine);

    setStatus(`Deep dive ${ticker}: data…`, "busy");
    logLine(`Deep dive start ${ticker} runId=${runId}`);

    const packRes = await fetch(`/api/market/ticker/${ticker}`, { signal });
    if (!packRes.ok) throw new Error(await packRes.text());
    const marketPack = await packRes.json();
    logLine(
      `Data ${ticker}: ${marketPack.stock?.context?.summary || "ok"} · regime ${marketPack.marketRegime?.tag || "?"}`
    );

    if (marketPack.ihsg) {
      updateKpisFromShortlist({
        ihsg: marketPack.ihsg,
        breadth: { adv: "—", dec: "—", total: null },
        dataQuality: { coveragePct: 100, fromCache: marketPack.fromCache }
      });
    }

    await startRunMemory(
      runId,
      { kind: "deep_dive", ticker, day: marketPack.day || null },
      logLine
    );
    await saveAgentStep(runId, "market_pack", marketPack, logLine);

    const searchMode = detectSearchMode();
    logLine(searchModeBanner(searchMode));
    if (searchMode === "FULL") {
      logLine("Deep dive FULL — agentic native + reasoning + Firebase save");
    } else if (searchMode === "DEGRADED") {
      logLine("DEGRADED — deep dive tanpa search live", "warn");
    } else {
      logLine("Deep dive FALLBACK — pack search seed");
    }

    const memory = await loadCompactMemory(8, logLine);

    setStatus(`Deep dive ${ticker}: agentic AI…`, "busy");
    const report = await runDeepDiveAgent({
      ticker,
      marketPack,
      searchResults: [],
      pageContents: [],
      searchMode,
      memory,
      runId,
      signal,
      onLog: logLine
    });

    await saveAgentStep(runId, "deep_dive", report, logLine);
    await finishRunMemory(runId, "done", logLine);

    try {
      await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...report, runId, final: true })
      });
    } catch {
      /* */
    }

    injectReportStylesOnce();
    const html = renderDeepDiveHtml(report);
    const reportEl = document.getElementById("report-view");
    if (reportEl) reportEl.innerHTML = html;
    window.__lastBriefing = report;
    window.__lastRunId = runId;

    const sl = document.getElementById("shortlist-table");
    if (sl && marketPack.stock) {
      const s = marketPack.stock;
      sl.innerHTML = `
        <div class="meta-strip">
          <span>Deep dive <b>${esc(ticker)}</b></span>
          <span>Regime <b>${esc(marketPack.marketRegime?.tag || "—")}</b></span>
          <span>${esc(marketPack.marketRegime?.ihsgSummary || "")}</span>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Ticker</th><th>1d%</th><th>RVOL</th><th>Context</th></tr></thead>
            <tbody>
              <tr>
                <td><span class="ticker">${esc(ticker)}</span></td>
                <td class="${(s.changePct || 0) >= 0 ? "up" : "down"}">${fmtSigned(s.changePct)}%</td>
                <td>${fmt(s.rvol)}</td>
                <td class="ctx-cell">${esc(s.context?.summary || "—")}</td>
              </tr>
            </tbody>
          </table>
        </div>`;
    }

    await postRender();
    setStatus(`Deep dive ${ticker} selesai · ${report.forecast?.lean || "?"}`, "ok");
    logLine(`Deep dive done ${ticker} · Firebase agents/deep_dive`);
    return report;
  } catch (e) {
    if (e.name === "AbortError") {
      setStatus("Dibatalkan", "warn");
      logLine("Deep dive aborted", "warn");
      return null;
    }
    console.error(e);
    setStatus("Deep dive error: " + e.message, "err");
    logLine(String(e.message || e), "err");
    throw e;
  }
}

function renderShortlistTable(pack) {
  const el = document.getElementById("shortlist-table");
  if (!el) return;
  updateKpisFromShortlist(pack);

  const rows = (pack.shortlist || [])
    .map((s) => {
      const risk = s.flowHints?.exitLiquidityHint || "low";
      const riskClass =
        risk === "high" ? "chip-risk-high" : risk === "med" ? "chip-risk-med" : "";
      const flowChip = s.flowHints?.flowAlive
        ? `<span class="chip chip-flow">flow hidup</span>`
        : `<span class="chip">flow mati</span>`;
      const chg = s.metrics?.changePct;
      const rvol = s.metrics?.rvol;
      const struct = s.context?.m1?.structure || s.context?.w1?.structure || "—";
      const m1 = s.context?.m1?.retPct;
      const volT = s.context?.vol?.volumeTrend || "—";
      const rvolHint =
        rvol == null
          ? ""
          : rvol >= 1.2
            ? "volume hidup"
            : rvol < 0.4
              ? "volume sepi"
              : "volume biasa";
      const whyHtml = (s.whySelected || [])
        .map((w) => `<span class="chip">${esc(humanWhy(w))}</span>`)
        .join(" ");
      return `<tr>
      <td><span class="ticker">${esc(s.ticker)}</span></td>
      <td class="${(chg || 0) >= 0 ? "up" : "down"}"><strong>${fmtSigned(chg)}%</strong><div class="cell-hint">hari ini</div></td>
      <td><strong>${fmt(rvol)}×</strong><div class="cell-hint">${esc(rvolHint)}</div></td>
      <td class="ctx-cell">
        <div class="ctx-grid">
          <span><b class="${(m1 || 0) >= 0 ? "up" : "down"}">${m1 != null ? fmtSigned(m1) + "%" : "—"}</b> <span class="cell-hint">1 bulan</span></span>
          <span><b>${esc(struct)}</b> <span class="cell-hint">struktur</span></span>
          <span><b>${esc(volT)}</b> <span class="cell-hint">tren vol</span></span>
        </div>
      </td>
      <td><div class="chip-row">${whyHtml || "—"}</div></td>
      <td><div class="chip-row"><span class="chip ${riskClass}">exit-liq ${esc(risk === "high" ? "tinggi" : risk === "med" ? "sedang" : "rendah")}</span> ${flowChip}</div></td>
    </tr>`;
    })
    .join("");

  const regime = pack.marketRegime;
  const ihsgChg = pack.ihsg?.changePct;
  el.innerHTML = `
    <div class="meta-strip">
      <span>Hari <b>${esc(pack.day)}</b></span>
      <span>Regime <b>${esc(regime?.tag || "—")}</b></span>
      <span>IHSG <b class="${(ihsgChg || 0) >= 0 ? "up" : "down"}">${fmtSigned(ihsgChg)}%</b></span>
      <span>Breadth <b>${pack.breadth?.adv ?? "—"} naik / ${pack.breadth?.dec ?? "—"} turun</b></span>
      <span>Coverage <b>${fmt(pack.dataQuality?.coveragePct)}%</b></span>
      <span><b>${pack.dataQuality?.fromCache ? "cache" : "fresh"}</b></span>
    </div>
    ${
      regime?.note
        ? `<div class="meta-strip meta-note"><span>${esc(regime.note)}</span></div>`
        : ""
    }
    <div class="table-wrap">
      <table class="data data-readable">
        <thead>
          <tr>
            <th scope="col">Emiten</th>
            <th scope="col">Return 1h</th>
            <th scope="col">Volume relatif</th>
            <th scope="col">Konteks (pisah)</th>
            <th scope="col">Kenapa dipilih</th>
            <th scope="col">Risiko</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="6" class="muted">Tidak ada pick</td></tr>`}</tbody>
      </table>
    </div>
    <p class="table-legend muted">Volume relatif (RVOL): &gt;1.2 hidup · 0.7–1.2 biasa · &lt;0.4 sepi (hati-hati ngejar). Struktur HH_HL = tren naik utuh; LH_LL = lemah.</p>`;
}

function humanWhy(w) {
  const m = {
    top_gainer: "lonjakan harian",
    top_loser: "anjlok harian",
    rvol_spike: "volume melonjak",
    return_z_anomaly: "gerak harian tidak biasa",
    flow: "indikasi flow"
  };
  return m[w] || w;
}

function fmt(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return typeof n === "number" ? (Math.round(n * 100) / 100).toString() : String(n);
}
function fmtSigned(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const x = Math.round(Number(n) * 100) / 100;
  return (x > 0 ? "+" : "") + x;
}
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function postRender() {
  if (window.mermaid) {
    try {
      await window.mermaid.run({ querySelector: ".mermaid" });
    } catch (e) {
      console.warn("mermaid", e);
    }
  }
  if (window.renderMathInElement) {
    try {
      window.renderMathInElement(document.getElementById("report-view") || document.body, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false }
        ],
        throwOnError: false
      });
    } catch {
      /* */
    }
  }
}

export function downloadJson() {
  const b = window.__lastBriefing;
  if (!b) return alert("Belum ada briefing");
  const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `briefing-${b.asOfSession || "run"}.json`;
  a.click();
}

export function downloadHtml() {
  const b = window.__lastBriefing;
  if (!b) return alert("Belum ada briefing");
  const full = buildExportHtml(b);
  const blob = new Blob([full], { type: "text/html;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const name =
    b.kind === "deep_dive"
      ? `deep-${b.ticker || "emiten"}-${b.asOfSession || "run"}.html`
      : `briefing-${b.asOfSession || "run"}.html`;
  a.download = name;
  a.click();
}
