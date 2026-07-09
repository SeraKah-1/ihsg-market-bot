import { chatJson, modelFor } from "../ai.js";
import { judgeSystem } from "./constitution.js";
import { applyStanceToBriefing } from "./stance-rules.js";
import {
  plainFromHard,
  plainMarketFromHard,
  heuristicPriceOutlook
} from "../metric-gloss.js";

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
    "fear": {"summary":"bahasa orang, jebakan apa"},
    "positive": {"summary":"bahasa orang, flow mana"},
    "judgeLean": "fear|neutral|positive",
    "judgeRationale": "2-4 kalimat manusiawi, JANGAN rantai singkatan",
    "judgePriority": "follow_money|avoid_exit_liq|mixed",
    "confidenceLabel": "uncalibrated"
  },
  "marketWide": {
    "regimeTag": "",
    "plainHeadline": "1 kalimat: apa yang terjadi di IHSG hari ini",
    "whatItMeans": "2-3 kalimat makna untuk trader/investor",
    "themes": ["tema manusiawi"],
    "unexplained": ["apa yang aneh tanpa berita"],
    "bestMoveOverall": "instruksi konkret",
    "followMoneyThesis": "uang ke mana / mati di mana",
    "nextActions": ["checklist 1","checklist 2"],
    "macroOutlook": {"tag":"cerah|biasa|suram","why":"makro+sentimen+tape indeks"},
    "fundamentalsOutlook": {"tag":"cerah|biasa|suram","why":"hanya jika ada sinyal; else biasa + unexplained"}
  },
  "shortlist": [{
    "ticker": "",
    "whySelected": [],
    "plain": {
      "whatHappened": "apa yang terjadi di ticker ini",
      "whyItMatters": "kenapa relevan hari ini",
      "whatToDo": "lakukan / skip / watch + syarat"
    },
    "fundamentals": {
      "summary": "lapkeu/proyek/aksi korp dari research atau unexplained",
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
      "fomoThesis": "bahasa orang",
      "invalidation": "kapan batal",
      "timeHorizon": "1-5d",
      "judgePriority": "follow_money|avoid_exit_liq|mixed"
    },
    "scenarios": {
      "base": {"narrative":"cerita manusiawi","horizon":"1-5d","prob":0.5},
      "bull": {"narrative":"","horizon":"1-5d","prob":0.25},
      "bear": {"narrative":"","horizon":"1-5d","prob":0.25}
    },
    "bestMoveFraming": ""
  }],
  "memoryWrite": {
    "compact": {"regimeTag":"","themes":[],"lean":"","top_tickers_1line":[]},
    "openHypotheses": []
  },
  "disclaimer": "Bukan saran investasi. Keputusan akhir di user. Confidence uncalibrated."
}`;

  let briefing;
  try {
    briefing = await chatJson({
      model,
      system:
        judgeSystem() +
        "\nIsi SEMUA field plain + outlook + fundamentals. metrics/context SALIN dari input." +
        "\nResearch.perTicker.*.notes dan fundamentalsNote adalah sumber funda — jangan mengarang angka." +
        "\nSchema:\n" +
        schema,
      user: JSON.stringify(
        {
          // pruned pack for token efficiency
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
  briefing.marketRegime = shortlistPack.marketRegime;
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
      row.context = src.context;
      row.vsIhsg = src.vsIhsg;
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
  briefing = enrichBriefingForHumans(briefing, shortlistPack, research);
  return briefing;
}

/**
 * Fill plain language + outlook if Judge skipped / wrote jargon only.
 * Hard metrics stay from code; prose fallback from metric-gloss + research.
 */
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
        ? "Prioritas: jangan jadi exit liquidity. Skip tape sepi & spike tanpa berita."
        : "Pilih flow hidup dengan invalidation; skip yang volume mati.";
  }
  if (!mw.followMoneyThesis) {
    mw.followMoneyThesis = packPlain.whatItMeans;
  }

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
          ? "Tidak ketemu berita/lapkeu relevan di search sesi ini (unexplained)."
          : "Data funda terbatas di sesi ini.");
    }
    if (!row.fundamentals.outlookTag) {
      row.fundamentals.outlookTag = r.outlookTag || "biasa";
    }
    if (!row.fundamentals.outlookWhy) {
      row.fundamentals.outlookWhy =
        r.fundamentalsNote ||
        "Outlook funda default biasa sampai ada lapkeu/proyek yang terbaca.";
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

  // Soften judge rationale if pure jargon
  if (looksLikeJargonSoup(briefing.sentiment?.judgeRationale)) {
    briefing.sentiment = briefing.sentiment || {};
    briefing.sentiment.judgeRationale =
      mw.plainHeadline + " " + (mw.bestMoveOverall || "");
  }
  return briefing;
}

function looksLikeJargonSoup(s) {
  const t = String(s || "");
  if (t.length < 12) return true;
  const hits = (t.match(/flowAlive|volumeTrend|rvol|m1\+|y1\+|exit-liq|HH_HL|LH_LL|post-parabolic/gi) || [])
    .length;
  const hasSpaces = (t.match(/\s/g) || []).length;
  // many tech tokens + few spaces relative to length, or 3+ jargon tokens
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
