/**
 * Writer / Presenter — narrative polish only.
 * Slim payload (NOT full analysis dump) so the LLM request always fires.
 */
import { chatJson, modelFor } from "../ai.js";
import { writerSystem } from "./constitution.js";
import {
  enrichBriefingForHumans,
  stampBriefingMeta,
  mergeSentimentShapes
} from "./analysis.js";
import { applyStanceToBriefing } from "./stance-rules.js";
import { attachIndicatorsToBriefing } from "../indicators-pack.js";

/** Compact schema — short, not a 100-line template in the system prompt */
const WRITER_SCHEMA_HINT = `{
  "presentation": {
    "kicker": "string",
    "headline": "string 1 kalimat",
    "lede": "2-4 kalimat",
    "throughline": "1 paragraf setup→uang→keputusan",
    "punchline": "1 kalimat nempel",
    "sections": [
      {"id":"setup|tension|money|decision|hidden","title":"","body":""}
    ],
    "checklist": ["aksi esok"],
    "closingNote": ""
  },
  "sentiment": {
    "analysisSummary": "",
    "trapWatch": "",
    "flowWatch": "",
    "judgeLean": "fear|neutral|positive",
    "judgeRationale": "",
    "judgePriority": "follow_money|avoid_exit_liq|mixed",
    "confidenceLabel": "uncalibrated"
  },
  "marketWide": {
    "plainHeadline": "",
    "story": "",
    "reasoningChain": ["langkah"],
    "whatItMeans": "",
    "themes": [],
    "unexplained": [],
    "bestMoveOverall": "",
    "followMoneyThesis": "",
    "nextActions": [],
    "crossTickerLinks": [],
    "macroOutlook": {"tag":"cerah|biasa|suram","why":""},
    "fundamentalsOutlook": {"tag":"cerah|biasa|suram","why":""}
  },
  "shortlist": [{
    "ticker": "",
    "insight": "",
    "narrative": "",
    "plain": {"whatHappened":"","whyItMatters":"","whatToDo":""},
    "fundamentals": {"summary":"","outlookTag":"biasa","outlookWhy":""},
    "outlook": {"price":"biasa","fundamentals":"biasa","combined":"biasa","priceWhy":"","fundamentalsWhy":""},
    "followMoney": {"flowAlive":false,"whoIsPushing":"","fuelLeft":"unknown","asymmetryNote":""},
    "stance": {"aggressionAllowed":false,"exitLiquidityRisk":"low|med|high","fomoThesis":"","invalidation":"","timeHorizon":"1-5d","judgePriority":"mixed"},
    "scenarios": {
      "base":{"narrative":"","horizon":"1-5d","prob":0.5},
      "bull":{"narrative":"","horizon":"1-5d","prob":0.25},
      "bear":{"narrative":"","horizon":"1-5d","prob":0.25}
    },
    "bestMoveFraming": "",
    "whySelected": []
  }],
  "writerMeta": {"note":"","fromAnalysis":true},
  "memoryWrite": {"compact":{"regimeTag":"","themes":[],"lean":"","top_tickers_1line":[]},"openHypotheses":[]},
  "disclaimer": "Bukan saran investasi."
}`;

/**
 * @returns presentation-ready briefing
 */
export async function runWriter({
  shortlistPack,
  research,
  analysis,
  searchMode,
  runId,
  signal,
  onLog
}) {
  const model = modelFor("writer");
  onLog?.(`Writer START model=${model} · presentasi (slim payload, no Firebase wait)`);

  // Build SLIM user pack immediately — never wait on network for this
  const slimUser = buildSlimWriterUser({
    shortlistPack,
    research,
    analysis,
    runId,
    searchMode
  });
  const userStr = JSON.stringify(slimUser);
  onLog?.(
    `Writer payload ready · ~${Math.round(userStr.length / 1024)}KB · tickers=${(slimUser.tickers || []).length}`
  );

  try {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const written = await chatJson({
      model,
      system:
        writerSystem() +
        "\n\nROLE: WRITER — polish narasi. Jangan dump rvol/HH_HL/m1% ke prose." +
        "\nPertahankan lean/priority dari analysis; perjelas bahasa." +
        "\nIsi SEMUA ticker di shortlist." +
        "\nSchema ringkas:\n" +
        WRITER_SCHEMA_HINT,
      user: userStr,
      signal,
      temperature: null,
      // medium first — faster than high cascade for pure prose
      reasoningEffort: "medium",
      timeoutMs: 90_000,
      onLog
    });

    onLog?.("Writer LLM OK · merge ke analysis");
    let out = mergeWriterOntoAnalysis(analysis, written);
    out = stampBriefingMeta(out, shortlistPack, searchMode, runId);
    out = mergeSentimentShapes(out);
    out = applyStanceToBriefing(out);
    out = enrichBriefingForHumans(out, shortlistPack, research);
    out = attachIndicatorsToBriefing(out, shortlistPack);
    out.writerMeta = {
      ...(written.writerMeta || {}),
      note: written.writerMeta?.note || "written",
      fromAnalysis: true,
      mode: "llm"
    };
    out.analysisMeta = analysis?.analysisMeta || analysis?.verify || null;
    if (analysis?.verify && !out.analysisMeta) out.analysisMeta = analysis.verify;
    onLog?.(
      `Writer done · headline=${(out.presentation?.headline || out.marketWide?.plainHeadline || "").slice(0, 72)}`
    );
    return out;
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    onLog?.("Writer gagal — polish heuristic (analysis tetap dipakai): " + (e.message || e), "err");
    let out = analysis && typeof analysis === "object" ? { ...analysis } : {};
    out.presentation = buildHeuristicPresentation(analysis, shortlistPack);
    out.writerMeta = { note: "writer skip: " + (e.message || e), fromAnalysis: true, mode: "heuristic" };
    out.analysisMeta = analysis?.analysisMeta || analysis?.verify || null;
    out = stampBriefingMeta(out, shortlistPack, searchMode, runId);
    out = mergeSentimentShapes(out);
    out = applyStanceToBriefing(out);
    out = enrichBriefingForHumans(out, shortlistPack, research);
    out = attachIndicatorsToBriefing(out, shortlistPack);
    return out;
  }
}

function buildSlimWriterUser({ shortlistPack, research, analysis, runId, searchMode }) {
  const a = analysis || {};
  const mw = a.marketWide || {};
  const s = a.sentiment || {};
  const meta = a.analysisMeta || a.verify || {};

  return {
    task: "Tulis ulang briefing agar enak dibaca. Output JSON murni.",
    runId,
    searchMode,
    day: shortlistPack?.day,
    marketHard: {
      regimeTag: shortlistPack?.marketRegime?.tag,
      regimeNote: shortlistPack?.marketRegime?.note,
      ihsgChangePct: shortlistPack?.ihsg?.changePct,
      ihsgClose: shortlistPack?.ihsg?.close,
      breadth: shortlistPack?.breadth
    },
    analysisLean: {
      judgeLean: s.judgeLean,
      judgePriority: s.judgePriority,
      analysisSummary: clip(s.analysisSummary, 500),
      trapWatch: clip(s.trapWatch, 400),
      flowWatch: clip(s.flowWatch, 400),
      judgeRationale: clip(s.judgeRationale, 500)
    },
    marketStory: {
      plainHeadline: clip(mw.plainHeadline, 240),
      story: clip(mw.story, 800),
      whatItMeans: clip(mw.whatItMeans, 500),
      bestMoveOverall: clip(mw.bestMoveOverall, 400),
      followMoneyThesis: clip(mw.followMoneyThesis, 400),
      themes: (mw.themes || []).slice(0, 8),
      unexplained: (mw.unexplained || []).slice(0, 8),
      reasoningChain: (mw.reasoningChain || []).slice(0, 6).map((x) => clip(x, 200)),
      nextActions: (mw.nextActions || []).slice(0, 6),
      crossTickerLinks: (mw.crossTickerLinks || []).slice(0, 6).map((x) =>
        typeof x === "string" ? clip(x, 160) : clip(x?.note || JSON.stringify(x), 160)
      ),
      macroOutlook: mw.macroOutlook || null,
      fundamentalsOutlook: mw.fundamentalsOutlook || null
    },
    verifyNotes: {
      note: clip(meta.note, 300),
      hiddenContext: (meta.hiddenContext || []).slice(0, 5).map((x) => clip(x, 200)),
      missedByResearch: (meta.missedByResearch || []).slice(0, 5).map((x) => clip(x, 200)),
      residualDoubts: (meta.residualDoubts || []).slice(0, 5).map((x) => clip(x, 200)),
      crossChecks: (meta.crossChecks || []).slice(0, 6).map((c) => ({
        claim: clip(c.claim, 120),
        verdict: c.verdict,
        note: clip(c.note, 120)
      }))
    },
    researchPunch: {
      macroNote: clip(research?.macroNote, 400),
      hotTakes: (research?.hotTakes || []).slice(0, 5).map((x) => clip(x, 160)),
      unexplainedMarket: (research?.unexplainedMarket || []).slice(0, 6).map((x) => clip(x, 160))
    },
    tickers: (shortlistPack?.shortlist || []).map((hard) => {
      const row = (a.shortlist || []).find((r) => r.ticker === hard.ticker) || {};
      return {
        ticker: hard.ticker,
        whySelected: hard.whySelected || row.whySelected || [],
        tape: {
          direction:
            hard.metrics?.changePct == null
              ? null
              : hard.metrics.changePct >= 0
                ? "hijau"
                : "merah",
          rvolBand:
            hard.metrics?.rvol == null
              ? null
              : hard.metrics.rvol >= 1.2
                ? "hidup"
                : hard.metrics.rvol < 0.4
                  ? "sepi"
                  : "biasa",
          structure: hard.context?.m1?.structure || hard.context?.w1?.structure || null,
          volTrend: hard.context?.vol?.volumeTrend || null,
          flowAlive: hard.flowHints?.flowAlive ?? row.followMoney?.flowAlive,
          exitLiq: hard.flowHints?.exitLiquidityHint || row.stance?.exitLiquidityRisk
        },
        fromAnalysis: {
          insight: clip(row.insight, 220),
          plain: row.plain
            ? {
                whatHappened: clip(row.plain.whatHappened, 280),
                whyItMatters: clip(row.plain.whyItMatters, 280),
                whatToDo: clip(row.plain.whatToDo, 220)
              }
            : null,
          narrative: clip(row.narrative, 360),
          outlook: row.outlook || null,
          bestMoveFraming: clip(row.bestMoveFraming, 200),
          stance: row.stance
            ? {
                aggressionAllowed: row.stance.aggressionAllowed,
                exitLiquidityRisk: row.stance.exitLiquidityRisk,
                invalidation: clip(row.stance.invalidation, 160),
                fomoThesis: clip(row.stance.fomoThesis, 160),
                judgePriority: row.stance.judgePriority
              }
            : null,
          fundamentals: row.fundamentals
            ? {
                summary: clip(row.fundamentals.summary, 240),
                outlookTag: row.fundamentals.outlookTag
              }
            : null
        }
      };
    })
  };
}

function clip(s, n) {
  if (s == null) return s;
  const t = String(s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function mergeWriterOntoAnalysis(analysis, written) {
  if (!written || typeof written !== "object") return analysis || {};
  const base = analysis && typeof analysis === "object" ? analysis : {};
  const out = {
    ...base,
    ...written,
    presentation: written.presentation || base.presentation,
    sentiment: { ...(base.sentiment || {}), ...(written.sentiment || {}) },
    marketWide: { ...(base.marketWide || {}), ...(written.marketWide || {}) },
    memoryWrite: written.memoryWrite || base.memoryWrite
  };

  const byT = Object.fromEntries((base.shortlist || []).map((r) => [r.ticker, r]));
  if (Array.isArray(written.shortlist) && written.shortlist.length) {
    out.shortlist = written.shortlist.map((row) => {
      const o = byT[row.ticker] || {};
      return {
        ...o,
        ...row,
        metrics: o.metrics,
        context: o.context,
        vsIhsg: o.vsIhsg,
        flowHints: o.flowHints || row.flowHints,
        whySelected: o.whySelected || row.whySelected,
        indicators: undefined
      };
    });
    for (const o of base.shortlist || []) {
      if (!out.shortlist.find((x) => x.ticker === o.ticker)) out.shortlist.push(o);
    }
  } else {
    out.shortlist = base.shortlist;
  }
  return out;
}

function buildHeuristicPresentation(analysis, pack) {
  const mw = analysis?.marketWide || {};
  const s = analysis?.sentiment || {};
  return {
    kicker: "Market briefing",
    headline: mw.plainHeadline || s.analysisSummary || `IHSG · ${pack?.day || ""}`,
    lede: s.analysisSummary || mw.whatItMeans || "",
    throughline: mw.story || mw.followMoneyThesis || s.judgeRationale || "",
    punchline: s.analysisSummary || mw.bestMoveOverall || "",
    sections: [
      { id: "setup", title: "Setup hari ini", body: mw.plainHeadline || "" },
      {
        id: "tension",
        title: "Yang aneh / tegang",
        body: (mw.unexplained || []).join("; ")
      },
      {
        id: "money",
        title: "Uang ke mana",
        body: mw.followMoneyThesis || s.flowWatch || ""
      },
      { id: "decision", title: "Keputusan", body: mw.bestMoveOverall || "" },
      {
        id: "hidden",
        title: "Yang sering dilewat",
        body:
          (analysis?.analysisMeta?.hiddenContext || analysis?.verify?.residualDoubts || []).join(
            "; "
          ) || "—"
      }
    ],
    checklist: mw.nextActions || [],
    closingNote: "Bukan saran investasi — keputusan di user."
  };
}

/** Legacy alias */
export async function runVerify(opts) {
  return runWriter({
    ...opts,
    analysis: opts.briefing || opts.analysis
  });
}
