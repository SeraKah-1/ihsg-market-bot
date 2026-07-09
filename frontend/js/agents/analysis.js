/**
 * Analysis agent — thesis + verify/crosscheck.
 * Pattern aligned with Writer (works): slim payload, medium reasoning first,
 * cascade on timeout, no mega-schema in system prompt.
 */
import { chatJson, modelFor } from "../ai.js";
import { analysisSystem } from "./constitution.js";
import { applyStanceToBriefing } from "./stance-rules.js";
import {
  plainFromHard,
  plainMarketFromHard,
  heuristicPriceOutlook
} from "../metric-gloss.js";
import { attachIndicatorsToBriefing } from "../indicators-pack.js";
import {
  chatWithNativeWebSearch,
  modelSupportsNativeSearch
} from "../search/native-search.js";

/** Compact schema hint — same idea as Writer (not 100-line template) */
const ANALYSIS_SCHEMA_HINT = `{
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
    "regimeTag": "",
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
    "whySelected": [],
    "hiddenNotes": "",
    "crossChecks": []
  }],
  "analysisMeta": {
    "crossChecks": [{"claim":"","vs":"hard|research|peer","verdict":"ok|weak|conflict","note":""}],
    "hiddenContext": [],
    "missedByResearch": [],
    "residualDoubts": [],
    "note": ""
  },
  "memoryWrite": {"compact":{"regimeTag":"","themes":[],"lean":"","top_tickers_1line":[]},"openHypotheses":[]},
  "disclaimer": "Bukan saran investasi."
}`;

/** @deprecated kept for imports that call briefingSchema */
export function briefingSchema(runId, day, searchMode) {
  return ANALYSIS_SCHEMA_HINT;
}

export async function runAnalysis({
  shortlistPack,
  research,
  memory,
  searchMode,
  runId,
  signal,
  onLog
}) {
  const model = modelFor("analysis");
  onLog?.(
    `Analysis model=${model} · slim payload + reason cascade medium→… (pola Writer)`
  );

  // Clarify web only if research thin
  let clarifications = [];
  const findingsN = (research?.findings || []).length;
  const salvageThin =
    research?.agentMeta?.mode === "agentic_salvage" || findingsN < 4;
  if (searchMode !== "DEGRADED" && salvageThin) {
    try {
      clarifications = await runAnalysisClarify({
        shortlistPack,
        research,
        model,
        searchMode,
        signal,
        onLog
      });
    } catch (e) {
      onLog?.("Analysis clarify skip (error): " + e.message, "warn");
      clarifications = [];
    }
  } else {
    onLog?.(
      `Analysis skip clarify web (research findings=${findingsN} mode=${research?.agentMeta?.mode || "?"})`
    );
  }

  const userPayload = buildSlimAnalysisUser({
    shortlistPack,
    research,
    memory,
    clarifications,
    runId,
    searchMode
  });
  const userStr = JSON.stringify(userPayload);
  onLog?.(
    `Analysis payload ready · ~${Math.round(userStr.length / 1024)}KB · tickers=${(userPayload.tickers || []).length}`
  );

  let briefing;
  try {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    briefing = await chatJson({
      model,
      system:
        analysisSystem() +
        "\n\nIsi JSON lengkap: sentiment + marketWide + shortlist (SEMUA ticker) + analysisMeta." +
        "\nJANGAN dump rvol/HH_HL/m1% ke prose. Metrics = fakta diam." +
        "\nSchema ringkas:\n" +
        ANALYSIS_SCHEMA_HINT,
      user: userStr,
      signal,
      temperature: null,
      // Cognitive Sandbox pattern: stream + no forced high reasoning on plain Grok
      reasoningEffort: "off",
      timeoutMs: 180_000,
      onLog
    });
    onLog?.(
      `Analysis LLM OK lean=${briefing?.sentiment?.judgeLean || "?"} reason=${briefing?.__meta?.reasoningEffort || "?"}`
    );
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    onLog?.("Analysis gagal → heuristic: " + (e.message || e), "err");
    briefing = buildHeuristicBriefing({ shortlistPack, research, searchMode, runId });
  }

  briefing = stampBriefingMeta(briefing, shortlistPack, searchMode, runId);
  briefing = mergeSentimentShapes(briefing);
  briefing = applyStanceToBriefing(briefing);
  briefing = enrichBriefingForHumans(briefing, shortlistPack, research);
  briefing = attachIndicatorsToBriefing(briefing, shortlistPack);

  if (!briefing.analysisMeta) {
    briefing.analysisMeta = {
      note: "analysis pass",
      crossChecks: [],
      hiddenContext: [],
      missedByResearch: [],
      residualDoubts: [],
      clarifications
    };
  } else if (clarifications.length && !briefing.analysisMeta.clarifications?.length) {
    briefing.analysisMeta.clarifications = clarifications;
  }
  briefing.verify = {
    note: briefing.analysisMeta.note || "analysis+verify",
    residualDoubts: briefing.analysisMeta.residualDoubts || [],
    clarificationsUsed: briefing.analysisMeta.clarifications || clarifications
  };

  onLog?.(
    `Analysis done lean=${briefing.sentiment?.judgeLean} hidden=${(briefing.analysisMeta?.hiddenContext || []).length} missed=${(briefing.analysisMeta?.missedByResearch || []).length}`
  );
  return briefing;
}

function buildSlimAnalysisUser({
  shortlistPack,
  research,
  memory,
  clarifications,
  runId,
  searchMode
}) {
  const r = research || {};
  const perTicker = r.perTicker || {};
  return {
    task: "Analisis + verifikasi IHSG. Output JSON murni. Isi semua ticker.",
    runId,
    searchMode,
    day: shortlistPack?.day,
    market: {
      regimeTag: shortlistPack?.marketRegime?.tag,
      regimeNote: shortlistPack?.marketRegime?.note,
      ihsgClose: shortlistPack?.ihsg?.close,
      ihsgChangePct: shortlistPack?.ihsg?.changePct,
      ihsgSummary: clip(shortlistPack?.ihsg?.context?.summary, 280),
      breadth: shortlistPack?.breadth,
      globals: (shortlistPack?.globals || []).slice(0, 6).map((g) => ({
        label: g.label,
        changePct: g.changePct
      }))
    },
    researchSlim: {
      mode: r.agentMeta?.mode,
      macroNote: clip(r.macroNote, 500),
      macroOutlookTag: r.macroOutlookTag,
      hotTakes: (r.hotTakes || []).slice(0, 6).map((x) => clip(x, 180)),
      marketNotes: (r.marketNotes || []).slice(0, 10).map((x) => clip(x, 180)),
      unexplainedMarket: (r.unexplainedMarket || []).slice(0, 8).map((x) => clip(x, 160)),
      findings: (r.findings || []).slice(0, 16).map((f) => ({
        claim: clip(f.claim || f.title || f.snippet, 200),
        url: (f.url || "").slice(0, 120),
        sourceTier: f.sourceTier || "unknown",
        ticker: f.ticker || null
      }))
    },
    tickers: (shortlistPack?.shortlist || []).map((s) => {
      const pr = perTicker[s.ticker] || {};
      return {
        ticker: s.ticker,
        whySelected: s.whySelected,
        tape: {
          changePct: s.metrics?.changePct,
          rvol: s.metrics?.rvol,
          zRet: s.metrics?.zRet,
          m1struct: s.context?.m1?.structure,
          m1ret: s.context?.m1?.retPct,
          w1struct: s.context?.w1?.structure,
          volTrend: s.context?.vol?.volumeTrend,
          flowAlive: s.flowHints?.flowAlive,
          exitLiq: s.flowHints?.exitLiquidityHint,
          summary: clip(s.context?.summary, 200)
        },
        research: {
          catalysts: (pr.catalysts || []).slice(0, 4).map((c) =>
            typeof c === "string" ? clip(c, 140) : clip(c.claim || c.title, 140)
          ),
          unexplained: !!pr.unexplained,
          notes: clip(pr.notes, 240),
          fundamentalsNote: clip(pr.fundamentalsNote, 240),
          outlookTag: pr.outlookTag || null
        }
      };
    }),
    clarificationsFromWeb: (clarifications || []).slice(0, 6).map((c) => ({
      hole: clip(c.hole, 120),
      claim: clip(c.claim, 180),
      url: (c.url || "").slice(0, 100)
    })),
    memoryRecent: (memory || []).slice(0, 4).map((m) => ({
      date: m.date,
      lean: m.lean,
      regimeTag: m.regimeTag,
      themes: (m.themes || []).slice(0, 4)
    }))
  };
}

function clip(s, n) {
  if (s == null) return s;
  const t = String(s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

async function runAnalysisClarify({
  shortlistPack,
  research,
  model,
  searchMode,
  signal,
  onLog
}) {
  const holes = collectHoles(shortlistPack, research);
  if (!holes.length) return [];
  if (!modelSupportsNativeSearch(model) || searchMode === "FALLBACK") {
    onLog?.(`Analysis clarify: ${holes.length} holes (no native web) — pakai research saja`);
    return holes.slice(0, 4).map((h) => ({ hole: h, claim: "", sourceTier: "unknown" }));
  }
  onLog?.(`Analysis clarify web · holes=${holes.slice(0, 3).join(" | ")}`);
  try {
    const q = holes.slice(0, 3).join(" ; ");
    const out = await chatWithNativeWebSearch({
      model,
      system:
        "Klarifikasi singkat hole riset IHSG. Jawab JSON: {clarifications:[{hole,claim,url,sourceTier}]}",
      user: `Holes:\n${holes.slice(0, 5).join("\n")}\nDay ${shortlistPack.day}`,
      signal,
      unrestrictedWeb: true,
      reasoningEffort: "medium",
      onLog
    });
    const text = out?.content || out?.text || "";
    try {
      const { parseJsonLoose } = await import("../ai.js");
      const parsed = parseJsonLoose(text);
      if (Array.isArray(parsed?.clarifications)) return parsed.clarifications.slice(0, 8);
    } catch {
      /* */
    }
    return holes.slice(0, 3).map((h) => ({
      hole: h,
      claim: String(text).slice(0, 200),
      sourceTier: "unknown"
    }));
  } catch (e) {
    onLog?.("clarify web fail: " + e.message, "warn");
    return holes.slice(0, 3).map((h) => ({ hole: h, claim: "", sourceTier: "unknown" }));
  }
}

function collectHoles(shortlistPack, research) {
  const holes = [];
  if (research?.agentMeta?.mode === "agentic_output_not_json" || research?.agentMeta?.mode === "agentic_salvage") {
    holes.push("agentic_output_not_json");
  }
  for (const s of shortlistPack?.shortlist || []) {
    const t = s.ticker;
    const pr = research?.perTicker?.[t];
    const rvol = s.metrics?.rvol;
    const ch = s.metrics?.changePct;
    if ((rvol >= 1.5 || Math.abs(ch || 0) >= 3) && (!pr?.catalysts?.length || pr?.unexplained)) {
      holes.push(`${t}: tape aneh / berita tipis — cari katalis`);
    }
    if (!pr?.fundamentalsNote && !pr?.catalysts?.length) {
      holes.push(`${t}: funda/lapkeu/proyek — cek aksi korp`);
    }
  }
  if (!(research?.findings || []).length) {
    holes.push("research findings kosong — IHSG headline hari ini");
  }
  return [...new Set(holes)].slice(0, 8);
}

export function stampBriefingMeta(briefing, shortlistPack, searchMode, runId) {
  if (!briefing || typeof briefing !== "object") briefing = {};
  briefing.schemaVersion = briefing.schemaVersion || 2;
  briefing.runId = runId || briefing.runId;
  briefing.asOfSession = shortlistPack?.day || briefing.asOfSession;
  briefing.searchMode = searchMode || briefing.searchMode;
  briefing.ihsg = shortlistPack?.ihsg || briefing.ihsg;
  briefing.marketRegime = shortlistPack?.marketRegime || briefing.marketRegime;
  briefing.breadth = shortlistPack?.breadth || briefing.breadth;
  briefing.globals = shortlistPack?.globals || briefing.globals;
  briefing.dataQuality = shortlistPack?.dataQuality || briefing.dataQuality;
  // merge hard metrics onto shortlist rows
  const hardBy = Object.fromEntries(
    (shortlistPack?.shortlist || []).map((s) => [s.ticker, s])
  );
  if (Array.isArray(briefing.shortlist)) {
    briefing.shortlist = briefing.shortlist.map((row) => {
      const h = hardBy[row.ticker];
      if (!h) return row;
      return {
        ...row,
        metrics: h.metrics || row.metrics,
        context: h.context || row.context,
        vsIhsg: h.vsIhsg || row.vsIhsg,
        flowHints: h.flowHints || row.flowHints,
        whySelected: h.whySelected || row.whySelected
      };
    });
    // ensure all hard tickers present
    for (const h of shortlistPack?.shortlist || []) {
      if (!briefing.shortlist.find((r) => r.ticker === h.ticker)) {
        briefing.shortlist.push({
          ticker: h.ticker,
          whySelected: h.whySelected,
          metrics: h.metrics,
          context: h.context,
          vsIhsg: h.vsIhsg,
          flowHints: h.flowHints,
          plain: plainFromHard(h),
          insight: "",
          outlook: { price: heuristicPriceOutlook(h).tag, fundamentals: "biasa", combined: "biasa" }
        });
      }
    }
  } else {
    briefing.shortlist = (shortlistPack?.shortlist || []).map((h) => ({
      ticker: h.ticker,
      whySelected: h.whySelected,
      metrics: h.metrics,
      context: h.context,
      vsIhsg: h.vsIhsg,
      flowHints: h.flowHints,
      plain: plainFromHard(h)
    }));
  }
  return briefing;
}

export function mergeSentimentShapes(briefing) {
  if (!briefing.sentiment) briefing.sentiment = {};
  const s = briefing.sentiment;
  if (!s.judgeLean && s.lean) s.judgeLean = s.lean;
  if (!s.analysisSummary && s.summary) s.analysisSummary = s.summary;
  return briefing;
}

export function enrichBriefingForHumans(briefing, shortlistPack, research) {
  if (!briefing) return briefing;
  const plainM = plainMarketFromHard({
    marketRegime: shortlistPack?.marketRegime || briefing.marketRegime,
    ihsg: shortlistPack?.ihsg || briefing.ihsg,
    breadth: shortlistPack?.breadth || briefing.breadth
  });
  if (!briefing.marketWide) briefing.marketWide = {};
  const mw = briefing.marketWide;
  if (!mw.plainHeadline) mw.plainHeadline = plainM.plainHeadline;
  if (!mw.whatItMeans) mw.whatItMeans = plainM.whatItMeans;
  if (!mw.story || /LLM gagal|heuristic|rvol|HH_HL|volumeTrend/i.test(mw.story || "")) {
    // leave LLM story if good; heuristic fill only if empty
    if (!mw.story) mw.story = plainM.whatItMeans || plainM.plainHeadline;
  }
  for (const row of briefing.shortlist || []) {
    const hard = (shortlistPack?.shortlist || []).find((s) => s.ticker === row.ticker);
    if (!hard) continue;
    const p = plainFromHard(hard);
    if (!row.plain) row.plain = p;
    else {
      if (!row.plain.whatHappened) row.plain.whatHappened = p.whatHappened;
      if (!row.plain.whyItMatters) row.plain.whyItMatters = p.whyItMatters;
      if (!row.plain.whatToDo) row.plain.whatToDo = p.whatToDo;
    }
  }
  void research;
  return briefing;
}

function buildHeuristicBriefing({ shortlistPack, research, searchMode, runId }) {
  const plainM = plainMarketFromHard({
    marketRegime: shortlistPack.marketRegime,
    ihsg: shortlistPack.ihsg,
    breadth: shortlistPack.breadth
  });
  const shortlist = (shortlistPack.shortlist || []).map((s) => {
    const p = plainFromHard(s);
    const po = heuristicPriceOutlook(s);
    return {
      ticker: s.ticker,
      whySelected: s.whySelected,
      metrics: s.metrics,
      context: s.context,
      vsIhsg: s.vsIhsg,
      flowHints: s.flowHints,
      plain: p,
      insight: p.whyItMatters,
      outlook: {
        price: po.tag,
        fundamentals: "biasa",
        combined: po.tag,
        priceWhy: po.why,
        fundamentalsWhy: "TIDAK KETEMU di hunt / analysis timeout"
      },
      stance: {
        aggressionAllowed: !!s.flowHints?.flowAlive && s.flowHints?.exitLiquidityHint !== "high",
        exitLiquidityRisk: s.flowHints?.exitLiquidityHint || "low",
        fomoThesis: "",
        invalidation: "breakdown volume/price structure",
        timeHorizon: "1-5d",
        judgePriority: s.flowHints?.flowAlive ? "follow_money" : "avoid_exit_liq"
      },
      scenarios: {
        base: { narrative: "ikut tape harian", horizon: "1-5d", prob: 0.5 },
        bull: { narrative: "continuation volume hold", horizon: "1-5d", prob: 0.25 },
        bear: { narrative: "fade climax", horizon: "1-5d", prob: 0.25 }
      },
      bestMoveFraming: p.whatToDo,
      fundamentals: { summary: "analysis timeout — cek research mentah", outlookTag: "biasa" }
    };
  });
  return {
    schemaVersion: 2,
    runId,
    asOfSession: shortlistPack.day,
    searchMode,
    sentiment: {
      analysisSummary: "Analysis LLM timeout/gagal — baca shortlist + research. Writer masih bisa polish.",
      trapWatch: "Cek thin volume & spike tanpa berita.",
      flowWatch: "Lihat flow di shortlist.",
      judgeLean: "neutral",
      judgeRationale: "Fallback heuristic tanpa Analysis LLM penuh",
      judgePriority: "mixed",
      confidenceLabel: "uncalibrated"
    },
    marketWide: {
      regimeTag: shortlistPack.marketRegime?.tag,
      plainHeadline: plainM.plainHeadline,
      story: plainM.whatItMeans,
      reasoningChain: ["Data hard only — LLM analysis tidak selesai"],
      whatItMeans: plainM.whatItMeans,
      themes: (research?.hotTakes || []).slice(0, 4),
      unexplained: (research?.unexplainedMarket || []).slice(0, 6),
      bestMoveOverall: "Manual: shortlist + invalidation flow.",
      followMoneyThesis: "Lihat flowAlive di shortlist.",
      nextActions: [
        "Baca shortlist per emiten: apa / kenapa / lakukan",
        "Prioritas: hindari exit-liq & tape sepi"
      ],
      macroOutlook: { tag: "biasa", why: shortlistPack.marketRegime?.note || "" },
      fundamentalsOutlook: { tag: "biasa", why: "analysis timeout" }
    },
    shortlist,
    analysisMeta: {
      note: "heuristic — LLM analysis timeout/gagal",
      residualDoubts: ["analysis_llm_failed"],
      hiddenContext: [],
      missedByResearch: [],
      crossChecks: []
    },
    disclaimer: "Bukan saran investasi. Keputusan akhir di user."
  };
}
