/**
 * Writer / Presenter agent — pure narrative for HTML inject.
 * Does NOT re-hunt web. Does NOT dump indicators into prose.
 * Input: analysis pack (facts + verify notes). Output: presentation JSON.
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

/** Presentation-focused schema — injectable into HTML */
export function writerSchema(runId, day, searchMode) {
  return `{
  "schemaVersion": 2,
  "runId": "${runId}",
  "asOfSession": "${day}",
  "searchMode": "${searchMode}",
  "presentation": {
    "kicker": "1 baris kicker singkat",
    "headline": "headline ngena 1 kalimat",
    "lede": "2-4 kalimat pembuka — setup + ketegangan, TANPA dump angka",
    "throughline": "1 paragraf cerita pasar yang koheren (setup → bukti → uang → keputusan)",
    "punchline": "1 kalimat insight yang nempel",
    "sections": [
      {"id":"setup","title":"Setup hari ini","body":"narasi 2-4 kalimat"},
      {"id":"tension","title":"Yang aneh / tegang","body":""},
      {"id":"money","title":"Uang ke mana","body":""},
      {"id":"decision","title":"Keputusan","body":""},
      {"id":"hidden","title":"Yang sering dilewat","body":"deep/hidden context dari analysis"}
    ],
    "checklist": ["aksi konkret esok"],
    "closingNote": "1 kalimat penutup"
  },
  "sentiment": {
    "analysisSummary": "punch insight (boleh rewrite dari analysis biar enak dibaca)",
    "trapWatch": "jebakan — bahasa manusia",
    "flowWatch": "uang hidup/mati — bahasa manusia",
    "judgeLean": "fear|neutral|positive",
    "judgeRationale": "kenapa lean — naratif, witty OK",
    "judgePriority": "follow_money|avoid_exit_liq|mixed",
    "confidenceLabel": "uncalibrated"
  },
  "marketWide": {
    "regimeTag": "",
    "plainHeadline": "sama spirit headline",
    "story": "sama spirit throughline",
    "reasoningChain": ["langkah 1 yang enak dibaca", "langkah 2"],
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
    "insight": "1 kalimat yang nempel",
    "narrative": "2-4 kalimat cerita emiten nyambung ke throughline pasar — NO dump rvol/m1/HH_HL",
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
    "whySelected": []
  }],
  "writerMeta": {
    "note": "apa yang di-polish",
    "fromAnalysis": true
  },
  "analysisMeta": null,
  "memoryWrite": {
    "compact": {"regimeTag":"","themes":[],"lean":"","top_tickers_1line":[]},
    "openHypotheses": []
  },
  "disclaimer": "Bukan saran investasi. Keputusan akhir di user. Confidence uncalibrated."
}`;
}

/**
 * @returns presentation-ready briefing (metrics attached from code after)
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
  onLog?.(`Writer model=${model} · presentasi & narasi · temp=omit`);

  const schema = writerSchema(runId, shortlistPack.day, searchMode);

  try {
    const written = await chatJson({
      model,
      system:
        writerSystem() +
        "\n\nKembalikan FULL JSON presentasi (schema di bawah)." +
        "\nJANGAN salin metrics/rvol/z/HH_HL ke prose." +
        "\nRewrite analysis jadi enak dibaca, koheren, saling nyambung." +
        "\nPertahankan lean/priority/stance yang masuk akal dari analysis — boleh perjelas bahasa, jangan balik tesis tanpa alasan." +
        "\nSchema:\n" +
        schema,
      user: JSON.stringify(
        {
          task: "Tulis ulang briefing agar enak dibaca. Input = hasil Analysis (sudah diverifikasi).",
          hardFactsNote:
            "Angka harga/volume ada di shortlistHard — JANGAN dump ke teks. UI card pakai JSON terpisah.",
          shortlistHard: (shortlistPack.shortlist || []).map((s) => ({
            ticker: s.ticker,
            whySelected: s.whySelected,
            // only coarse signals for writer context, not for prose dump
            flowAlive: s.flowHints?.flowAlive,
            exitLiquidityHint: s.flowHints?.exitLiquidityHint,
            ret1dSign:
              s.metrics?.changePct != null
                ? s.metrics.changePct >= 0
                  ? "hijau"
                  : "merah"
                : null,
            rvolBand:
              s.metrics?.rvol == null
                ? null
                : s.metrics.rvol >= 1.2
                  ? "hidup"
                  : s.metrics.rvol < 0.4
                    ? "sepi"
                    : "biasa"
          })),
          marketHard: {
            day: shortlistPack.day,
            regimeTag: shortlistPack.marketRegime?.tag,
            regimeNote: shortlistPack.marketRegime?.note,
            ihsgDirection:
              shortlistPack.ihsg?.changePct != null
                ? shortlistPack.ihsg.changePct >= 0
                  ? "hijau"
                  : "merah"
                : null,
            breadth: shortlistPack.breadth
          },
          researchPunch: {
            macroNote: research?.macroNote,
            hotTakes: research?.hotTakes,
            unexplainedMarket: research?.unexplainedMarket
          },
          analysisDraft: stripForWriter(analysis)
        },
        null,
        2
      ),
      signal,
      temperature: null,
      reasoningEffort: "auto",
      onLog
    });

    let out = mergeWriterOntoAnalysis(analysis, written);
    out = stampBriefingMeta(out, shortlistPack, searchMode, runId);
    out = mergeSentimentShapes(out);
    out = applyStanceToBriefing(out);
    out = enrichBriefingForHumans(out, shortlistPack, research);
    out = attachIndicatorsToBriefing(out, shortlistPack);
    out.writerMeta = written.writerMeta || { note: "written", fromAnalysis: true };
    out.analysisMeta = analysis.analysisMeta || analysis.verify || null;
    // keep analysis verify notes under analysisMeta; writer doesn't own verify
    if (analysis.verify && !out.analysisMeta) out.analysisMeta = analysis.verify;
    onLog?.(
      `Writer done · headline=${(out.presentation?.headline || out.marketWide?.plainHeadline || "").slice(0, 60)}`
    );
    return out;
  } catch (e) {
    onLog?.("Writer gagal — pakai analysis + polish heuristic: " + e.message, "err");
    let out = { ...analysis };
    out.presentation = buildHeuristicPresentation(analysis, shortlistPack);
    out.writerMeta = { note: "writer skip: " + e.message, fromAnalysis: true };
    out.analysisMeta = analysis.analysisMeta || analysis.verify || null;
    out = stampBriefingMeta(out, shortlistPack, searchMode, runId);
    out = mergeSentimentShapes(out);
    out = applyStanceToBriefing(out);
    out = enrichBriefingForHumans(out, shortlistPack, research);
    out = attachIndicatorsToBriefing(out, shortlistPack);
    return out;
  }
}

function stripForWriter(analysis) {
  if (!analysis) return {};
  return {
    sentiment: analysis.sentiment,
    marketWide: analysis.marketWide,
    analysisMeta: analysis.analysisMeta || analysis.verify,
    verify: analysis.verify,
    shortlist: (analysis.shortlist || []).map((r) => ({
      ticker: r.ticker,
      insight: r.insight,
      plain: r.plain,
      narrative: r.narrative,
      fundamentals: r.fundamentals,
      outlook: r.outlook,
      stance: r.stance,
      scenarios: r.scenarios,
      bestMoveFraming: r.bestMoveFraming,
      followMoney: r.followMoney,
      whySelected: r.whySelected,
      // no metrics/context/indicators in writer prompt
      hiddenNotes: r.hiddenNotes,
      crossChecks: r.crossChecks
    })),
    memoryWrite: analysis.memoryWrite,
    disclaimer: analysis.disclaimer
  };
}

function mergeWriterOntoAnalysis(analysis, written) {
  if (!written || typeof written !== "object") return analysis;
  const out = {
    ...analysis,
    ...written,
    presentation: written.presentation || analysis.presentation,
    sentiment: { ...(analysis.sentiment || {}), ...(written.sentiment || {}) },
    marketWide: { ...(analysis.marketWide || {}), ...(written.marketWide || {}) },
    memoryWrite: written.memoryWrite || analysis.memoryWrite
  };

  const byT = Object.fromEntries(
    (analysis.shortlist || []).map((r) => [r.ticker, r])
  );
  if (Array.isArray(written.shortlist) && written.shortlist.length) {
    out.shortlist = written.shortlist.map((row) => {
      const o = byT[row.ticker] || {};
      return {
        ...o,
        ...row,
        // code-owned hard fields always win
        metrics: o.metrics,
        context: o.context,
        vsIhsg: o.vsIhsg,
        flowHints: o.flowHints || row.flowHints,
        whySelected: o.whySelected || row.whySelected,
        indicators: undefined // re-attached later
      };
    });
    // keep any analysis tickers writer dropped
    for (const o of analysis.shortlist || []) {
      if (!out.shortlist.find((x) => x.ticker === o.ticker)) {
        out.shortlist.push(o);
      }
    }
  } else {
    out.shortlist = analysis.shortlist;
  }
  return out;
}

function buildHeuristicPresentation(analysis, pack) {
  const mw = analysis?.marketWide || {};
  const s = analysis?.sentiment || {};
  return {
    kicker: "Market briefing",
    headline: mw.plainHeadline || s.analysisSummary || "Briefing IHSG",
    lede: s.analysisSummary || mw.whatItMeans || "",
    throughline: mw.story || mw.followMoneyThesis || s.judgeRationale || "",
    punchline: s.analysisSummary || mw.bestMoveOverall || "",
    sections: [
      { id: "setup", title: "Setup hari ini", body: mw.plainHeadline || "" },
      { id: "tension", title: "Yang aneh / tegang", body: (mw.unexplained || []).join("; ") },
      { id: "money", title: "Uang ke mana", body: mw.followMoneyThesis || s.flowWatch || "" },
      { id: "decision", title: "Keputusan", body: mw.bestMoveOverall || "" },
      {
        id: "hidden",
        title: "Yang sering dilewat",
        body: (analysis?.analysisMeta?.hiddenContext || analysis?.verify?.residualDoubts || []).join(
          "; "
        ) || "—"
      }
    ],
    checklist: mw.nextActions || [],
    closingNote: "Bukan saran investasi — keputusan di user."
  };
}

/** Legacy alias if anything still imports verify */
export async function runVerify(opts) {
  return runWriter({
    ...opts,
    analysis: opts.briefing || opts.analysis
  });
}
