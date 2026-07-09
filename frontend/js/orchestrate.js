import { appSettings, loadSettings, logLine, setStatus } from "./state.js";
import { detectSearchMode, searchModeBanner } from "./search/capability.js";
import { runResearch } from "./agents/research.js";
import { runFear } from "./agents/fear.js";
import { runPositive } from "./agents/positive.js";
import { runJudge } from "./agents/judge.js";
import {
  renderBriefingHtml,
  renderDeepDiveHtml,
  buildExportHtml,
  updateKpisFromShortlist,
  injectReportStylesOnce
} from "./render-report.js";
import { deepDiveQueries, runDeepDiveAgent } from "./agents/deep-dive.js";
import { hybridResearchSearch, researchModel } from "./search/native-search.js";

let abortCtrl = null;

export function abortRun() {
  if (abortCtrl) abortCtrl.abort();
}

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
    // shortlist endpoint does ohlcv+rank
    // for max limit use ohlcv first
    let shortlistPack;
    if (max) {
      logLine(`Ingest max=${max} tickers…`);
      const ohlcvRes = await fetch("/api/market/ohlcv?" + new URLSearchParams({ force: force ? "1" : "0", max: String(max) }), {
        signal
      });
      if (!ohlcvRes.ok) throw new Error(await ohlcvRes.text());
      const ohlcv = await ohlcvRes.json();
      logLine(
        `OHLCV day=${ohlcv.day} coverage=${ohlcv.coveragePct}% ok=${ohlcv.fetchedOk}/${ohlcv.universeSize} cache=${ohlcv.fromCache} ${ohlcv.elapsedMs || 0}ms`
      );
      const slRes = await fetch("/api/market/shortlist?" + q.toString(), { signal });
      // rebuild client-side if needed — call shortlist API without force (uses cache)
      if (!slRes.ok) throw new Error(await slRes.text());
      shortlistPack = await slRes.json();
    } else {
      const slRes = await fetch("/api/market/shortlist?" + q.toString() + (force ? "&force=1" : ""), {
        signal
      });
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

    // memory
    const memRes = await fetch("/api/memory/compact?n=10", { signal });
    const memJson = memRes.ok ? await memRes.json() : { items: [] };
    const memory = memJson.items || [];

    const searchMode = detectSearchMode();
    logLine(searchModeBanner(searchMode));
    setStatus(`Research ${searchMode}…`, "busy");

    let searchResults = [];
    let searchModeEffective = searchMode;
    if (searchMode !== "DEGRADED") {
      const queries = [
        `IHSG ${shortlistPack.day} penopang pemberat`,
        ...(shortlistPack.shortlist || [])
          .slice(0, 6)
          .flatMap((s) => [
            `${s.ticker} saham IDX berita`,
            `${s.ticker} aksi korporasi OR right issue OR buyback`
          ])
      ];
      const hybrid = await hybridResearchSearch({
        model: researchModel(),
        queries,
        searchMode,
        signal,
        onLog: logLine,
        unrestrictedWeb: false
      });
      searchResults = hybrid.results;
      searchModeEffective = hybrid.searchModeEffective || searchMode;
      logLine(
        `Search hits: ${searchResults.length} (effective=${searchModeEffective}, native=${hybrid.nativeMode || "—"})`
      );
    }

    const research = await runResearch({
      shortlistPack,
      searchMode: searchModeEffective,
      searchResults,
      memory,
      signal,
      onLog: logLine
    });

    setStatus("Fear ‖ Positive…", "busy");
    const [fear, positive] = await Promise.all([
      runFear({ shortlistPack, research, signal, onLog: logLine }),
      runPositive({ shortlistPack, research, signal, onLog: logLine })
    ]);

    setStatus("Judge…", "busy");
    const briefing = await runJudge({
      shortlistPack,
      research,
      fear,
      positive,
      memory,
      searchMode,
      runId,
      signal,
      onLog: logLine
    });

    // persist
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

    // mermaid / katex
    await postRender();

    setStatus("Selesai — " + (briefing.sentiment?.judgeLean || "?"), "ok");
    logLine("Done. judgeLean=" + briefing.sentiment?.judgeLean);
    return { shortlistPack, briefing };
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

async function collectSearch(shortlistPack, signal) {
  const queries = [
    `IHSG ${shortlistPack.day} penopang pemberat`,
    ...(shortlistPack.shortlist || []).slice(0, 6).map((s) => `${s.ticker} saham IDX berita`)
  ];
  const out = [];
  for (const q of queries) {
    if (signal.aborted) break;
    try {
      const res = await fetch("/api/search/ddg?q=" + encodeURIComponent(q) + "&n=4", { signal });
      if (!res.ok) continue;
      const data = await res.json();
      for (const r of data.results || []) {
        out.push({ ...r, query: q });
      }
    } catch {
      /* ignore single fail */
    }
  }
  return out;
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
        ? `<span class="chip chip-flow">flow</span>`
        : "";
      const ctx = s.context || {};
      const ctxShort = [
        ctx.d1?.retPct != null ? `1d ${fmtSigned(ctx.d1.retPct)}%` : null,
        ctx.w1?.retPct != null ? `1w ${fmtSigned(ctx.w1.retPct)}%` : null,
        ctx.w1?.structure ? ctx.w1.structure : null,
        ctx.m1?.retPct != null ? `1m ${fmtSigned(ctx.m1.retPct)}%` : null
      ]
        .filter(Boolean)
        .join(" · ");
      const whyHtml = (s.whySelected || [])
        .map((w) => `<span class="chip">${esc(w)}</span>`)
        .join(" ");
      return `<tr>
      <td><span class="ticker">${esc(s.ticker)}</span></td>
      <td class="${(s.metrics?.changePct || 0) >= 0 ? "up" : "down"}">${fmtSigned(s.metrics?.changePct)}%</td>
      <td>${fmt(s.metrics?.rvol)}</td>
      <td class="ctx-cell" title="${esc(ctx.summary || "")}">${esc(ctxShort || "—")}</td>
      <td><div class="chip-row">${whyHtml || "—"}</div></td>
      <td><div class="chip-row"><span class="chip ${riskClass}">${esc(risk)}</span> ${flowChip}</div></td>
    </tr>`;
    })
    .join("");

  const regime = pack.marketRegime;
  el.innerHTML = `
    <div class="meta-strip">
      <span>Day <b>${esc(pack.day)}</b></span>
      <span>Regime <b>${esc(regime?.tag || "—")}</b></span>
      <span>IHSG <b>${esc(regime?.ihsgSummary || pack.ihsg?.context?.summary || "—")}</b></span>
      <span>Breadth <b>${pack.breadth?.adv ?? "—"} / ${pack.breadth?.dec ?? "—"}</b></span>
      <span>Coverage <b>${fmt(pack.dataQuality?.coveragePct)}%</b></span>
      <span><b>${pack.dataQuality?.fromCache ? "cache" : "fresh"}</b></span>
    </div>
    ${regime?.note ? `<div class="meta-strip"><span>${esc(regime.note)}</span></div>` : ""}
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th scope="col">Ticker</th>
            <th scope="col">1d%</th>
            <th scope="col">RVOL</th>
            <th scope="col">Context 1d/1w/1m</th>
            <th scope="col">Why</th>
            <th scope="col">Risk</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="6" class="muted">Tidak ada pick</td></tr>`}</tbody>
      </table>
    </div>`;
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

/**
 * Deep dive one emiten: intensive search + single structured analysis.
 */
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

    // update KPI lightly from pack
    if (marketPack.ihsg) {
      updateKpisFromShortlist({
        ihsg: marketPack.ihsg,
        breadth: { adv: "—", dec: "—", total: null },
        dataQuality: { coveragePct: 100, fromCache: marketPack.fromCache }
      });
    }

    const searchMode = detectSearchMode();
    logLine(searchModeBanner(searchMode));
    setStatus(`Deep dive ${ticker}: search…`, "busy");

    let searchResults = [];
    let searchModeEffective = searchMode;
    if (searchMode !== "DEGRADED") {
      const queries = deepDiveQueries(ticker, marketPack.day);
      // Deep dive: unrestricted web for native tools (full internet, not only 5 domains)
      const hybrid = await hybridResearchSearch({
        model: researchModel(),
        queries,
        searchMode: searchMode === "auto" ? "FULL" : searchMode,
        signal,
        onLog: logLine,
        unrestrictedWeb: true
      });
      searchResults = hybrid.results;
      searchModeEffective = hybrid.searchModeEffective || searchMode;
      logLine(
        `Deep search hits: ${searchResults.length} queries=${queries.length} effective=${searchModeEffective} native=${hybrid.nativeMode || "—"}`
      );
    } else {
      logLine("DEGRADED — deep dive tanpa search live", "warn");
    }

    const memRes = await fetch("/api/memory/compact?n=8", { signal });
    const memJson = memRes.ok ? await memRes.json() : { items: [] };

    setStatus(`Deep dive ${ticker}: AI…`, "busy");
    const report = await runDeepDiveAgent({
      ticker,
      marketPack,
      searchResults,
      searchMode: searchModeEffective,
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

    // shortlist panel shows ticker snapshot
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
