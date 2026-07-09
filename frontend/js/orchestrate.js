import { appSettings, loadSettings, logLine, setStatus } from "./state.js";
import { detectSearchMode, searchModeBanner } from "./search/capability.js";
import { runResearch } from "./agents/research.js";
import { runFear } from "./agents/fear.js";
import { runPositive } from "./agents/positive.js";
import { runJudge } from "./agents/judge.js";
import { renderBriefingHtml } from "./render-report.js";

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
  const rows = (pack.shortlist || [])
    .map(
      (s) => `<tr>
      <td><strong>${esc(s.ticker)}</strong></td>
      <td class="${(s.metrics?.changePct || 0) >= 0 ? "up" : "down"}">${fmt(s.metrics?.changePct)}%</td>
      <td>${fmt(s.metrics?.rvol)}</td>
      <td>${fmt(s.metrics?.zRet)}</td>
      <td>${esc((s.whySelected || []).join(", "))}</td>
      <td>${esc(s.flowHints?.exitLiquidityHint || "")}</td>
    </tr>`
    )
    .join("");
  const ihsg = pack.ihsg;
  el.innerHTML = `
    <div class="meta-strip">
      <span>Day <b>${esc(pack.day)}</b></span>
      <span>IHSG ${ihsg?.close != null ? fmt(ihsg.close) : "—"} (${fmt(ihsg?.changePct)}%)</span>
      <span>Breadth ${pack.breadth?.adv}/${pack.breadth?.dec}</span>
      <span>Coverage ${fmt(pack.dataQuality?.coveragePct)}%</span>
      <span>${pack.dataQuality?.fromCache ? "CACHE" : "FRESH"}</span>
    </div>
    <table>
      <thead><tr><th>Ticker</th><th>%</th><th>rvol</th><th>z</th><th>Why</th><th>ExitLiq hint</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function fmt(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return typeof n === "number" ? (Math.round(n * 100) / 100).toString() : String(n);
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
  const inner = renderBriefingHtml(b);
  const full = `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>IHSG Briefing ${b.asOfSession || ""}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"/>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"><\/script>
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: true, theme: "dark" });
<\/script>
<style>
  body{font-family:system-ui,sans-serif;background:#0c0c0f;color:#e4e4e7;margin:0;padding:1.5rem;line-height:1.45}
  table{border-collapse:collapse;width:100%;margin:1rem 0}
  th,td{border:1px solid #3f3f46;padding:.4rem .55rem;text-align:left;font-size:.9rem}
  th{background:#27272a}
  .badge{display:inline-block;padding:.15rem .5rem;border-radius:4px;font-size:.75rem;font-weight:600}
  .badge-follow{background:#14532d;color:#bbf7d0}
  .badge-exit{background:#7f1d1d;color:#fecaca}
  .badge-lean{background:#1e3a5f;color:#bfdbfe}
  .card{border:1px solid #3f3f46;border-radius:8px;padding:1rem;margin:.75rem 0;background:#18181b}
  .up{color:#4ade80}.down{color:#f87171}
  h1,h2,h3{margin:.6rem 0}
</style>
</head><body>
<script type="application/json" id="report-data">${JSON.stringify(b).replace(/</g, "\\u003c")}</script>
${inner}
<script>
  document.addEventListener("DOMContentLoaded",()=>{
    if(window.renderMathInElement) renderMathInElement(document.body,{delimiters:[{left:"$$",right:"$$",display:true},{left:"$",right:"$",display:false}],throwOnError:false});
  });
<\/script>
</body></html>`;
  const blob = new Blob([full], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `briefing-${b.asOfSession || "run"}.html`;
  a.click();
}
