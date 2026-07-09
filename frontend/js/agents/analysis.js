/**
 * Analysis agent — single brain full briefing (replaces Fear + Positive + Judge).
 */
import { chatJson, modelFor } from "../ai.js";
import { analysisSystem } from "./constitution.js";
import { applyStanceToBriefing } from "./stance-rules.js";
import {
  plainFromHard,
  plainMarketFromHard,
  heuristicPriceOutlook
} from "../metric-gloss.js";

export function briefingSchema(runId, day, searchMode) {
  return `{
  "schemaVersion": 1,
  "runId": "${runId}",
  "asOfSession": "${day}",
  "searchMode": "${searchMode}",
  "sentiment": {
    "analysisSummary": "2-4 kalimat punch — apa yang beneran penting hari ini",
    "trapWatch": "jebakan exit-liq / late chase (kalau ada)",
    "flowWatch": "di mana uang hidup / mati",
    "judgeLean": "fear|neutral|positive",
    "judgeRationale": "kenapa lean itu — lurus, witty OK",
    "judgePriority": "follow_money|avoid_exit_liq|mixed",
    "confidenceLabel": "uncalibrated"
  },
  "marketWide": {
    "regimeTag": "",
    "plainHeadline": "1 kalimat ngena — bukan parafrase angka",
    "whatItMeans": "2-3 kalimat: arti buat posisi / cash",
    "themes": ["tema manusiawi"],
    "unexplained": ["yang aneh tanpa berita"],
    "bestMoveOverall": "instruksi konkret esok/hari ini",
    "followMoneyThesis": "uang ke mana",
    "nextActions": ["checklist yang bisa dicek"],
    "macroOutlook": {"tag":"cerah|biasa|suram","why":""},
    "fundamentalsOutlook": {"tag":"cerah|biasa|suram","why":""}
  },
  "shortlist": [{
    "ticker": "",
    "whySelected": [],
    "plain": {
      "whatHappened": "",
      "whyItMatters": "",
      "whatToDo": ""
    },
    "fundamentals": {
      "summary": "",
      "outlookTag": "cerah|biasa|suram",
      "outlookWhy": ""
    },
    "outlook": {
      "price": "cerah|biasa|suram",
      "fundamentals": "cerah|biasa|suram",
      "combined": "cerah|biasa|suram",
      "priceWhy": "",
      "fundamentalsWhy": ""
    },
    "followMoney": {"flowAlive": true, "whoIsPushing": "", "fuelLeft": "unknown", "asymmetryNote": ""},
    "stance": {
      "aggressionAllowed": true,
      "exitLiquidityRisk": "low|med|high",
      "fomoThesis": "",
      "invalidation": "",
      "timeHorizon": "1-5d",
      "judgePriority": "follow_money|avoid_exit_liq|mixed"
    },
    "scenarios": {
      "base": {"narrative":"","horizon":"1-5d","prob":0.5},
      "bull": {"narrative":"","horizon":"1-5d","prob":0.25},
      "bear": {"narrative":"","horizon":"1-5d","prob":0.25}
    },
    "bestMoveFraming": "",
    "insight": "1 kalimat wow / call berani per ticker"
  }],
  "memoryWrite": {
    "compact": {"regimeTag":"","themes":[],"lean":"","top_tickers_1line":[]},
    "openHypotheses": []
  },
  "disclaimer": "Bukan saran investasi. Keputusan akhir di user. Confidence uncalibrated."
}`;
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
  onLog?.(`Analysis model=${model} · reason cascade · temp=omit`);

  const schema = briefingSchema(runId, shortlistPack.day, searchMode);
  let briefing;

  try {
    briefing = await chatJson({
      model,
      system:
        analysisSystem() +
        "\n\nIsi SEMUA field. metrics/context SALIN dari input, jangan diubah." +
        "\nResearch pack = sumber berita/funda. Hot takes research boleh dipakai/ditebang." +
        "\nSchema:\n" +
        schema,
      user: JSON.stringify(
        {
          day: shortlistPack.day,
          marketRegime: shortlistPack.marketRegime,
          ihsg: {
            close: shortlistPack.ihsg?.close,
            changePct: shortlistPack.ihsg?.changePct,
            context: shortlistPack.ihsg?.context
          },
          breadth: shortlistPack.breadth,
          globals: (shortlistPack.globals || []).map((g) => ({
            label: g.label,
            changePct: g.changePct,
            contextSummary: g.context?.summary
          })),
          shortlist: (shortlistPack.shortlist || []).map((s) => ({
            ticker: s.ticker,
            whySelected: s.whySelected,
            metrics: s.metrics,
            context: s.context,
            vsIhsg: s.vsIhsg,
            flowHints: s.flowHints
          })),
          research,
          memoryRecent: memory
        },
        null,
        2
      ),
      signal,
      temperature: null,
      reasoningEffort: "auto",
      onLog
    });
  } catch (e) {
    onLog?.("Analysis gagal → heuristic: " + e.message, "err");
    briefing = buildHeuristicBriefing({ shortlistPack, research, searchMode, runId });
  }

  briefing = stampBriefingMeta(briefing, shortlistPack, searchMode, runId);
  briefing = mergeSentimentShapes(briefing);
  briefing = applyStanceToBriefing(briefing);
  briefing = enrichBriefingForHumans(briefing, shortlistPack, research);
  return briefing;
}

/** Map new sentiment fields + legacy fear/positive for render */
function mergeSentimentShapes(briefing) {
  const s = briefing.sentiment || {};
  const analysisSummary =
    s.analysisSummary || s.judgeRationale || s.summary || "";
  const trap = s.trapWatch || s.fear?.summary || "";
  const flow = s.flowWatch || s.positive?.summary || "";
  briefing.sentiment = {
    ...s,
    analysisSummary,
    trapWatch: trap,
    flowWatch: flow,
    // legacy slots so old HTML still works
    fear: { summary: trap || s.fear?.summary || "", points: s.fear?.points || [] },
    positive: {
      summary: flow || s.positive?.summary || "",
      points: s.positive?.points || []
    },
    judgeLean: s.judgeLean || "neutral",
    judgeRationale: s.judgeRationale || analysisSummary,
    judgePriority: s.judgePriority || "mixed",
    confidenceLabel: "uncalibrated"
  };
  return briefing;
}

export function stampBriefingMeta(briefing, shortlistPack, searchMode, runId) {
  briefing.schemaVersion = 1;
  briefing.runId = runId;
  briefing.asOfSession = shortlistPack.day;
  briefing.searchMode = searchMode;
  briefing.generatedAt = new Date().toISOString();
  briefing.dataQuality = shortlistPack.dataQuality;
  briefing.marketRegime = shortlistPack.marketRegime;
  briefing.ihsg = shortlistPack.ihsg;
  briefing.globals = shortlistPack.globals;
  briefing.breadth = shortlistPack.breadth;
  briefing.disclaimer =
    briefing.disclaimer ||
    "Bukan saran investasi. Keputusan akhir di user. Confidence uncalibrated.";

  const byTicker = Object.fromEntries(
    (shortlistPack.shortlist || []).map((s) => [s.ticker, s])
  );
  briefing.shortlist = (briefing.shortlist || shortlistPack.shortlist || []).map((row) => {
    const src = byTicker[row.ticker] || shortlistPack.shortlist.find((s) => s.ticker === row.ticker);
    if (src) {
      row.metrics = src.metrics;
      row.context = src.context;
      row.vsIhsg = src.vsIhsg;
      row.whySelected = src.whySelected || row.whySelected;
      row.flowHints = src.flowHints;
    }
    return row;
  });

  for (const s of shortlistPack.shortlist || []) {
    if (!briefing.shortlist.find((x) => x.ticker === s.ticker)) {
      briefing.shortlist.push({
        ticker: s.ticker,
        metrics: s.metrics,
        whySelected: s.whySelected,
        stance: {
          exitLiquidityRisk: s.flowHints?.exitLiquidityHint || "low",
          aggressionAllowed:
            s.flowHints?.flowAlive && s.flowHints?.exitLiquidityHint !== "high",
          fomoThesis: "",
          invalidation: "",
          timeHorizon: "1-5d"
        },
        scenarios: {
          base: { narrative: "nunggu konfirmasi", horizon: "1-5d", prob: 0.5 },
          bull: { narrative: "", horizon: "1-5d", prob: 0.25 },
          bear: { narrative: "", horizon: "1-5d", prob: 0.25 }
        }
      });
    }
  }
  return briefing;
}

export function enrichBriefingForHumans(briefing, shortlistPack, research) {
  if (!briefing) return briefing;
  const packPlain = plainMarketFromHard(shortlistPack || {});
  briefing.marketWide = briefing.marketWide || {};
  const mw = briefing.marketWide;
  if (!mw.plainHeadline || looksLikeJargonSoup(mw.plainHeadline)) {
    mw.plainHeadline = packPlain.plainHeadline;
  }
  if (!mw.whatItMeans) mw.whatItMeans = packPlain.whatItMeans;
  if (!mw.nextActions?.length) mw.nextActions = packPlain.nextActions;
  if (!mw.macroOutlook?.tag) {
    mw.macroOutlook = {
      tag: heuristicMacroTag(shortlistPack),
      why: packPlain.macroBackdrop + " " + (shortlistPack?.marketRegime?.note || "")
    };
  }
  if (!mw.bestMoveOverall) {
    mw.bestMoveOverall =
      briefing.sentiment?.judgePriority === "avoid_exit_liq"
        ? "Jangan nampung spike sepi. Skip ACST-class thin tape."
        : "Ikut flow yang volume-nya hidup; skip yang mati.";
  }
  if (!mw.followMoneyThesis) mw.followMoneyThesis = packPlain.whatItMeans;

  const researchPer = research?.perTicker || {};
  briefing.shortlist = (briefing.shortlist || []).map((row) => {
    const hard = plainFromHard(row);
    const priceH = heuristicPriceOutlook(row);
    row.plain = {
      whatHappened: row.plain?.whatHappened || hard.whatHappened,
      whyItMatters: row.plain?.whyItMatters || hard.whyItMatters,
      whatToDo: row.plain?.whatToDo || row.bestMoveFraming || hard.whatToDo
    };
    if (looksLikeJargonSoup(row.plain.whatHappened)) {
      row.plain.whatHappened = hard.whatHappened;
    }
    const r = researchPer[row.ticker] || {};
    row.fundamentals = row.fundamentals || {};
    if (!row.fundamentals.summary) {
      row.fundamentals.summary =
        r.fundamentalsNote ||
        r.notes ||
        (r.unexplained
          ? "Hunt kosong — gak ada berita/lapkeu yang nempel."
          : "Funda tipis di sesi ini.");
    }
    if (!row.fundamentals.outlookTag) {
      row.fundamentals.outlookTag = r.outlookTag || "biasa";
    }
    if (!row.fundamentals.outlookWhy) {
      row.fundamentals.outlookWhy =
        r.fundamentalsNote || "Default biasa sampai ada angka/proyek yang kebaca.";
    }
    row.outlook = row.outlook || {};
    row.outlook.price = row.outlook.price || priceH.tag;
    row.outlook.priceWhy = row.outlook.priceWhy || priceH.why;
    row.outlook.fundamentals = row.outlook.fundamentals || row.fundamentals.outlookTag;
    row.outlook.fundamentalsWhy =
      row.outlook.fundamentalsWhy || row.fundamentals.outlookWhy;
    row.outlook.combined =
      row.outlook.combined ||
      combineOutlook(
        row.outlook.price,
        row.outlook.fundamentals,
        row.stance?.exitLiquidityRisk
      );
    if (!row.bestMoveFraming) row.bestMoveFraming = row.plain.whatToDo;
    return row;
  });

  if (looksLikeJargonSoup(briefing.sentiment?.judgeRationale)) {
    briefing.sentiment = briefing.sentiment || {};
    briefing.sentiment.judgeRationale =
      mw.plainHeadline + " " + (mw.bestMoveOverall || "");
  }
  if (
    !briefing.sentiment?.analysisSummary ||
    looksLikeJargonSoup(briefing.sentiment.analysisSummary)
  ) {
    briefing.sentiment = briefing.sentiment || {};
    briefing.sentiment.analysisSummary = briefing.sentiment.judgeRationale || mw.plainHeadline;
  }
  return briefing;
}

function looksLikeJargonSoup(s) {
  const t = String(s || "");
  if (t.length < 12) return true;
  const hits = (
    t.match(/flowAlive|volumeTrend|rvol|m1\+|y1\+|exit-liq|HH_HL|LH_LL|post-parabolic/gi) || []
  ).length;
  const hasSpaces = (t.match(/\s/g) || []).length;
  return hits >= 3 || (hits >= 2 && hasSpaces < 8);
}

function heuristicMacroTag(pack) {
  const tag = String(pack?.marketRegime?.tag || "").toLowerCase();
  const chg = pack?.ihsg?.changePct;
  if (tag.includes("risk_on") || tag.includes("trend_up")) return "cerah";
  if (tag.includes("risk_off") || tag.includes("trend_down")) return "suram";
  if (tag.includes("high_vol") || (chg != null && Math.abs(chg) >= 1.5)) return "biasa";
  return "biasa";
}

function combineOutlook(price, funda, exitRisk) {
  if (exitRisk === "high") return "suram";
  const score = (t) => (t === "cerah" ? 1 : t === "suram" ? -1 : 0);
  const s = score(price) + score(funda);
  if (s >= 1) return "cerah";
  if (s <= -1) return "suram";
  return "biasa";
}

function buildHeuristicBriefing({ shortlistPack, research, searchMode, runId }) {
  const hot = (research?.hotTakes || []).join(" · ");
  return {
    schemaVersion: 1,
    runId,
    asOfSession: shortlistPack.day,
    searchMode,
    sentiment: {
      analysisSummary: hot || "Analysis LLM gagal — baca shortlist + research mentah.",
      trapWatch: "Cek thin volume & spike tanpa berita.",
      flowWatch: "Lihat flowHints di shortlist.",
      judgeLean: "neutral",
      judgeRationale: "Fallback heuristic tanpa Analysis LLM",
      judgePriority: "mixed",
      confidenceLabel: "uncalibrated"
    },
    marketWide: {
      regimeTag: shortlistPack.marketRegime?.tag || "unknown",
      themes: research?.hotTakes || [],
      unexplained: research?.unexplainedMarket || ["analysis_llm_failed"],
      bestMoveOverall: "Manual: shortlist + invalidation flow.",
      followMoneyThesis: research?.macroNote || ""
    },
    shortlist: (shortlistPack.shortlist || []).map((s) => ({
      ticker: s.ticker,
      metrics: s.metrics,
      whySelected: s.whySelected,
      stance: {
        exitLiquidityRisk: s.flowHints?.exitLiquidityHint || "low",
        aggressionAllowed: !!(
          s.flowHints?.flowAlive && s.flowHints?.exitLiquidityHint !== "high"
        ),
        fomoThesis: s.flowHints?.flowAlive ? "flow heuristic hidup" : "",
        invalidation: "breakdown volume/price structure",
        timeHorizon: "1-5d",
        judgePriority:
          s.flowHints?.exitLiquidityHint === "high" ? "avoid_exit_liq" : "follow_money"
      },
      scenarios: {
        base: { narrative: "ikut tape harian", horizon: "1-5d", prob: 0.5 },
        bull: { narrative: "continuation volume hold", horizon: "1-5d", prob: 0.25 },
        bear: { narrative: "fade climax", horizon: "1-5d", prob: 0.25 }
      },
      bestMoveFraming:
        s.flowHints?.exitLiquidityHint === "high" ? "jangan nampung" : "ikut flow + invalidation"
    })),
    memoryWrite: {
      compact: {
        regimeTag: shortlistPack.marketRegime?.tag || "unknown",
        themes: [],
        lean: "neutral",
        top_tickers_1line: (shortlistPack.shortlist || []).slice(0, 5).map((s) => s.ticker)
      },
      openHypotheses: []
    }
  };
}
