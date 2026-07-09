import { chatJson, modelFor } from "../ai.js";
import { judgeSystem } from "./constitution.js";
import { applyStanceToBriefing } from "./stance-rules.js";

export async function runJudge({
  shortlistPack,
  research,
  fear,
  positive,
  memory,
  searchMode,
  runId,
  signal,
  onLog
}) {
  const model = modelFor("judge");
  onLog?.(`Judge model=${model}`);

  const schema = `{
  "schemaVersion": 1,
  "runId": "${runId}",
  "asOfSession": "${shortlistPack.day}",
  "searchMode": "${searchMode}",
  "sentiment": {
    "fear": {"summary":""},
    "positive": {"summary":""},
    "judgeLean": "fear|neutral|positive",
    "judgeRationale": "",
    "judgePriority": "follow_money|avoid_exit_liq|mixed",
    "confidenceRaw": 0.5,
    "confidenceLabel": "uncalibrated"
  },
  "marketWide": {
    "regimeTag": "",
    "themes": [],
    "unexplained": [],
    "bestMoveOverall": "",
    "followMoneyThesis": ""
  },
  "shortlist": [{
    "ticker": "",
    "whySelected": [],
    "metrics": {},
    "catalysts": [],
    "psychology": "",
    "followMoney": {"flowAlive": true, "whoIsPushing": "", "fuelLeft": "unknown", "asymmetryNote": ""},
    "stance": {
      "aggressionAllowed": true,
      "exitLiquidityRisk": "low",
      "fomoThesis": "",
      "invalidation": "",
      "timeHorizon": "1-5d",
      "judgePriority": "follow_money"
    },
    "scenarios": {
      "base": {"narrative":"","horizon":"1-5d","prob":0.5},
      "bull": {"narrative":"","horizon":"1-5d","prob":0.25},
      "bear": {"narrative":"","horizon":"1-5d","prob":0.25}
    },
    "bestMoveFraming": ""
  }],
  "diagrams": {"flowMermaid": "flowchart TD\\n  A[IHSG] --> B[Flow]"},
  "memoryWrite": {
    "compact": {"regimeTag":"","themes":[],"lean":"","top_tickers_1line":[]},
    "openHypotheses": [{"id":"","claim":"","prob":0.5,"horizon_end":"","resolution_rule":""}]
  },
  "disclaimer": "Bukan saran investasi. Keputusan akhir di user. Confidence uncalibrated."
}`;

  let briefing;
  try {
    briefing = await chatJson({
      model,
      system: judgeSystem() + "\nIsi SEMUA field penting. metrics shortlist SALIN dari input code (jangan ubah angka).\nSchema contoh:\n" + schema,
      user: JSON.stringify(
        {
          shortlistPack,
          research,
          fear,
          positive,
          memoryRecent: memory
        },
        null,
        2
      ),
      signal,
      temperature: 0.4
    });
  } catch (e) {
    onLog?.("Judge gagal, pakai template heuristic: " + e.message, "err");
    briefing = buildHeuristicBriefing({ shortlistPack, research, fear, positive, searchMode, runId });
  }

  // Force metadata + metrics from code
  briefing.schemaVersion = 1;
  briefing.runId = runId;
  briefing.asOfSession = shortlistPack.day;
  briefing.searchMode = searchMode;
  briefing.generatedAt = new Date().toISOString();
  briefing.dataQuality = shortlistPack.dataQuality;
  briefing.ihsg = shortlistPack.ihsg;
  briefing.globals = shortlistPack.globals;
  briefing.breadth = shortlistPack.breadth;
  briefing.disclaimer =
    briefing.disclaimer ||
    "Bukan saran investasi. Keputusan akhir di user. Confidence uncalibrated.";

  // Patch metrics from shortlistPack
  const byTicker = Object.fromEntries((shortlistPack.shortlist || []).map((s) => [s.ticker, s]));
  briefing.shortlist = (briefing.shortlist || shortlistPack.shortlist || []).map((row) => {
    const src = byTicker[row.ticker] || shortlistPack.shortlist.find((s) => s.ticker === row.ticker);
    if (src) {
      row.metrics = src.metrics;
      row.whySelected = src.whySelected || row.whySelected;
      row.flowHints = src.flowHints;
    }
    return row;
  });

  // Ensure all shortlist tickers present
  for (const s of shortlistPack.shortlist || []) {
    if (!briefing.shortlist.find((x) => x.ticker === s.ticker)) {
      briefing.shortlist.push({
        ticker: s.ticker,
        metrics: s.metrics,
        whySelected: s.whySelected,
        stance: {
          exitLiquidityRisk: s.flowHints?.exitLiquidityHint || "low",
          aggressionAllowed: s.flowHints?.flowAlive && s.flowHints?.exitLiquidityHint !== "high",
          fomoThesis: "",
          invalidation: "",
          timeHorizon: "1-5d"
        },
        scenarios: {
          base: { narrative: "menunggu konfirmasi", horizon: "1-5d", prob: 0.5 },
          bull: { narrative: "", horizon: "1-5d", prob: 0.25 },
          bear: { narrative: "", horizon: "1-5d", prob: 0.25 }
        }
      });
    }
  }

  briefing.sentiment = {
    fear: { summary: fear?.summary || "", points: fear?.points || [] },
    positive: { summary: positive?.summary || "", points: positive?.points || [] },
    ...(briefing.sentiment || {}),
    confidenceLabel: "uncalibrated"
  };

  briefing = applyStanceToBriefing(briefing);
  return briefing;
}

function buildHeuristicBriefing({ shortlistPack, fear, positive, searchMode, runId }) {
  return {
    schemaVersion: 1,
    runId,
    asOfSession: shortlistPack.day,
    searchMode,
    sentiment: {
      fear: { summary: fear?.summary || "" },
      positive: { summary: positive?.summary || "" },
      judgeLean: "neutral",
      judgeRationale: "Fallback heuristic tanpa Judge LLM",
      judgePriority: "mixed",
      confidenceLabel: "uncalibrated"
    },
    marketWide: {
      regimeTag: "unknown",
      themes: [],
      unexplained: ["judge_llm_failed"],
      bestMoveOverall: "Evaluasi shortlist manual; cek exit-liq flags",
      followMoneyThesis: ""
    },
    shortlist: (shortlistPack.shortlist || []).map((s) => ({
      ticker: s.ticker,
      metrics: s.metrics,
      whySelected: s.whySelected,
      stance: {
        exitLiquidityRisk: s.flowHints?.exitLiquidityHint || "low",
        aggressionAllowed: !!(s.flowHints?.flowAlive && s.flowHints?.exitLiquidityHint !== "high"),
        fomoThesis: s.flowHints?.flowAlive ? "flow heuristic hidup" : "",
        invalidation: "breakdown volume/price structure",
        timeHorizon: "1-5d",
        judgePriority: s.flowHints?.exitLiquidityHint === "high" ? "avoid_exit_liq" : "follow_money"
      },
      scenarios: {
        base: { narrative: "lanjut sesuai flow harian", horizon: "1-5d", prob: 0.5 },
        bull: { narrative: "continuation jika rvol hold", horizon: "1-5d", prob: 0.25 },
        bear: { narrative: "fade jika climax", horizon: "1-5d", prob: 0.25 }
      },
      bestMoveFraming: s.flowHints?.exitLiquidityHint === "high" ? "jangan nampung" : "ikut flow dengan invalidation"
    })),
    diagrams: { flowMermaid: "flowchart TD\n  IHSG --> Shortlist\n  Shortlist --> Judge" },
    memoryWrite: {
      compact: {
        regimeTag: "unknown",
        themes: [],
        lean: "neutral",
        top_tickers_1line: (shortlistPack.shortlist || []).slice(0, 5).map((s) => s.ticker)
      },
      openHypotheses: []
    }
  };
}
