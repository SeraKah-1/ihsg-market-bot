import { appSettings, loadSettings, logLine, setStatus } from "./state.js";
import { detectSearchMode, searchModeBanner } from "./search/capability.js";
import { runResearch } from "./agents/research.js";
import { runFear } from "./agents/fear.js";
import { runPositive } from "./agents/positive.js";
import { runJudge } from "./agents/judge.js";
import {
  renderBriefingHtml,
  buildExportHtml,
  updateKpisFromShortlist,
  injectReportStylesOnce
} from "./render-report.js";

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
    if (searchMode !== "DEGRADED") {
      searchResults = await collectSearch(shortlistPack, signal);
      logLine(`Search hits: ${searchResults.length}`);
    }

    const research = await runResearch({
      shortlistPack,
      searchMode,
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
      return `<tr>
      <td><span class="ticker">${esc(s.ticker)}</span></td>
      <td class="${(s.metrics?.changePct || 0) >= 0 ? "up" : "down"}">${fmtSigned(s.metrics?.changePct)}%</td>
      <td>${fmt(s.metrics?.rvol)}</td>
      <td>${fmt(s.metrics?.zRet)}</td>
      <td>${(s.whySelected || []).map((w) => `<span class="chip">${esc(w)}</span>`).join("")}</td>
      <td><span class="chip ${riskClass}">${esc(risk)}</span>${flowChip}</td>
    </tr>`;
    })
    .join("");

  el.innerHTML = `
    <div class="meta-strip">
      <span>Day <b>${esc(pack.day)}</b></span>
      <span>Breadth <b>${pack.breadth?.adv ?? "—"} / ${pack.breadth?.dec ?? "—"}</b></span>
      <span>Coverage <b>${fmt(pack.dataQuality?.coveragePct)}%</b></span>
      <span><b>${pack.dataQuality?.fromCache ? "cache" : "fresh"}</b></span>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th scope="col">Ticker</th>
            <th scope="col">%</th>
            <th scope="col">RVOL</th>
            <th scope="col">Z</th>
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
  a.download = `briefing-${b.asOfSession || "run"}.html`;
  a.click();
}
