import { appSettings, loadSettings, logLine, setStatus } from "./state.js";
import { detectSearchMode, searchModeBanner } from "./search/capability.js";
import { runResearcher } from "./agents/researcher.js";
import { runAnalysis } from "./agents/analysis.js";
import { runVerify } from "./agents/verify.js";
import {
  renderBriefingHtml,
  renderDeepDiveHtml,
  buildExportHtml,
  updateKpisFromShortlist,
  injectReportStylesOnce
} from "./render-report.js";
import { runDeepDiveAgent } from "./agents/deep-dive.js";

let abortCtrl = null;

export function abortRun() {
  if (abortCtrl) abortCtrl.abort();
}

/**
 * Pipeline v2: Researcher (web) → Analysis → Verify (optional web).
 * No Fear/Positive/Judge split.
 */
export async function runPipeline({ skipAi = false } = {}) {
  loadSettings();
  if (abortCtrl) abortCtrl.abort();
  abortCtrl = new AbortController();
  const signal = abortCtrl.signal;

  const runId = `run_${Date.now()}`;
  const k = appSettings.shortlistK || 8;
  const force = !!appSettings.forceRefresh;
  const max = appSettings.maxIngest > 0 ? appSettings.maxIngest : undefined;

  try {
    setStatus("Ingest OHLCV…", "busy");
    logLine(`Start ${runId} K=${k} force=${force}`);

    const q = new URLSearchParams({ k: String(k) });
    if (force) q.set("force", "1");
    let shortlistPack;
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

    if (skipAi) {
      setStatus("Shortlist only (skip AI)", "ok");
      return { shortlistPack, briefing: null };
    }

    const memRes = await fetch("/api/memory/compact?n=10", { signal });
    const memJson = memRes.ok ? await memRes.json() : { items: [] };
    const memory = memJson.items || [];

    const searchMode = detectSearchMode();
    logLine(searchModeBanner(searchMode));

    // 1) Researcher — owns search plan + web
    setStatus("Researcher (web)…", "busy");
    const research = await runResearcher({
      shortlistPack,
      searchMode,
      memory,
      signal,
      onLog: logLine
    });
    logLine(
      `Research done mode=${research.agentMeta?.mode || "?"} hotTakes=${(research.hotTakes || []).length}`
    );

    // 2) Analysis — full briefing
    setStatus("Analysis…", "busy");
    let briefing = await runAnalysis({
      shortlistPack,
      research,
      memory,
      searchMode,
      runId,
      signal,
      onLog: logLine
    });

    // 3) Verify — skeptic + optional clarify search
    setStatus("Verify…", "busy");
    briefing = await runVerify({
      shortlistPack,
      research,
      briefing,
      searchMode,
      runId,
      signal,
      onLog: logLine
    });
    briefing.researchPack = {
      hotTakes: research.hotTakes,
      macroNote: research.macroNote,
      searchPlan: research.searchPlan,
      agentMeta: research.agentMeta
    };

    await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(briefing)
    });
    if (briefing.memoryWrite?.compact) {
      await fetch("/api/memory/compact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: briefing.asOfSession,
          ...briefing.memoryWrite.compact,
          openHypotheses: briefing.memoryWrite.openHypotheses || []
        })
      });
    }

    injectReportStylesOnce();
    const html = renderBriefingHtml(briefing);
    const reportEl = document.getElementById("report-view");
    if (reportEl) reportEl.innerHTML = html;
    window.__lastBriefing = briefing;
    window.__lastShortlist = shortlistPack;
    window.__lastResearch = research;

    await postRender();

    setStatus("Selesai — " + (briefing.sentiment?.judgeLean || "?"), "ok");
    logLine(
      "Done. lean=" +
        briefing.sentiment?.judgeLean +
        " verify=" +
        (briefing.verify?.note || "").slice(0, 80)
    );
    return { shortlistPack, briefing, research };
  } catch (e) {
    if (e.name === "AbortError") {
      setStatus("Dibatalkan", "warn");
      logLine("Aborted", "warn");
      return null;
    }
    console.error(e);
    setStatus("Error: " + e.message, "err");
    logLine(String(e.message || e), "err");
    throw e;
  }
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
    setStatus(`Deep dive ${ticker}: data…`, "busy");
    logLine(`Deep dive start ${ticker}`);

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

    const searchMode = detectSearchMode();
    logLine(searchModeBanner(searchMode));
    if (searchMode === "FULL") {
      logLine("Deep dive FULL — agentic native + reasoning");
    } else if (searchMode === "DEGRADED") {
      logLine("DEGRADED — deep dive tanpa search live", "warn");
    } else {
      logLine("Deep dive FALLBACK — pack search seed");
    }

    const memRes = await fetch("/api/memory/compact?n=8", { signal });
    const memJson = memRes.ok ? await memRes.json() : { items: [] };

    setStatus(`Deep dive ${ticker}: agentic AI…`, "busy");
    const report = await runDeepDiveAgent({
      ticker,
      marketPack,
      searchResults: [],
      pageContents: [],
      searchMode,
      memory: memJson.items || [],
      runId,
      signal,
      onLog: logLine
    });

    await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report)
    });

    injectReportStylesOnce();
    const html = renderDeepDiveHtml(report);
    const reportEl = document.getElementById("report-view");
    if (reportEl) reportEl.innerHTML = html;
    window.__lastBriefing = report;

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

    setStatus(`Deep dive ${ticker} selesai · ${report.forecast?.lean || "?"}`, "ok");
    logLine(`Deep dive done ${ticker} lean=${report.forecast?.lean}`);
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
