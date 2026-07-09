/**
 * Analysis agent — full briefing + verification/crosscheck/hidden context.
 * Writer agent owns presentation polish separately.
 */
import { chatJson, modelFor, parseJsonLoose } from "../ai.js";
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

export function briefingSchema(runId, day, searchMode) {
  return `{
  "schemaVersion": 2,
  "runId": "${runId}",
  "asOfSession": "${day}",
  "searchMode": "${searchMode}",
  "sentiment": {
    "analysisSummary": "2-4 kalimat punch insight — TANPA dump angka",
    "trapWatch": "jebakan exit-liq / late chase",
    "flowWatch": "di mana uang hidup / mati",
    "judgeLean": "fear|neutral|positive",
    "judgeRationale": "kenapa lean itu — naratif, witty OK, TANPA rantai indikator",
    "judgePriority": "follow_money|avoid_exit_liq|mixed",
    "confidenceLabel": "uncalibrated"
  },
  "marketWide": {
    "regimeTag": "",
    "plainHeadline": "1 kalimat ngena",
    "story": "1 paragraf throughline: setup → ketegangan → uang → keputusan",
    "reasoningChain": ["karena A maka B", "karena B maka C", "karena C maka D"],
    "whatItMeans": "2-3 kalimat arti buat posisi/cash",
    "themes": ["tema manusiawi"],
    "unexplained": ["yang aneh tanpa berita"],
    "bestMoveOverall": "instruksi konkret",
    "followMoneyThesis": "uang ke mana",
    "nextActions": ["checklist"],
    "crossTickerLinks": ["hubungan antar emiten shortlist"],
    "macroOutlook": {"tag":"cerah|biasa|suram","why":""},
    "fundamentalsOutlook": {"tag":"cerah|biasa|suram","why":""}
  },
  "shortlist": [{
    "ticker": "",
    "whySelected": [],
    "insight": "1 kalimat insight kuat",
    "plain": {
      "whatHappened": "narasi — NO dump rvol/m1%/HH_HL",
      "whyItMatters": "nyambung ke story pasar",
      "whatToDo": "lakukan / skip / watch + syarat"
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
      "priceWhy": "makna tape tanpa dump metrics",
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
      "base": {"narrative":"cerita base","horizon":"1-5d","prob":0.5},
      "bull": {"narrative":"","horizon":"1-5d","prob":0.25},
      "bear": {"narrative":"","horizon":"1-5d","prob":0.25}
    },
    "bestMoveFraming": "",
    "hiddenNotes": "konteks tersembunyi bila ada",
    "crossChecks": ["claim vs tape"]
  }],
  "analysisMeta": {
    "crossChecks": [{"claim":"","vs":"hard|research|peer","verdict":"ok|weak|conflict","note":""}],
    "hiddenContext": ["deep context yang sering dilewat"],
    "missedByResearch": ["apa yang kira-kira dilewat researcher"],
    "residualDoubts": ["sisa ragu jujur"],
    "clarifications": [{"hole":"","claim":"","url":"","sourceTier":""}],
    "note": "ringkas apa yang diverifikasi / di-patch"
  },
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
  onLog?.(`Analysis model=${model} · analyse + verify/crosscheck · temp=omit`);

  // Optional clarify — skip if research already thin/failed (save router budget)
  let clarifications = [];
  const researchThin =
    (research?.findings || []).length < 2 ||
    research?.agentMeta?.mode === "agentic_salvage" ||
    research?.agentMeta?.mode === "error_fallback";
  if (searchMode !== "DEGRADED" && !researchThin) {
    clarifications = await runAnalysisClarify({
      shortlistPack,
      research,
      model,
      searchMode,
      signal,
      onLog
    });
  } else if (researchThin) {
    onLog?.(
      "Analysis skip clarify web (research tipis) — langsung thesis dari hard+research",
      "warn"
    );
  }

  const schema = briefingSchema(runId, shortlistPack.day, searchMode);
  let briefing;

  try {
    briefing = await chatJson({
      model,
      system:
        analysisSystem() +
        "\n\nIsi SEMUA field narasi + analysisMeta (verifikasi)." +
        "\nJANGAN salin metrics ke prose — UI punya indicators JSON terpisah." +
        "\nResearch pack + clarifications = sumber. Tulis story + reasoningChain yang saling nyambung." +
        "\nWajib isi: crossChecks, hiddenContext, missedByResearch, residualDoubts." +
        "\nSchema:\n" +
        schema,
      user: JSON.stringify(
        {
          day: shortlistPack.day,
          note:
            "Field metrics/context = FAKTA referensi diam-diam. Narasi = makna + insight, bukan dump angka. " +
            "Lakukan verifikasi & crosscheck. Cari hidden context & yang dilewat research. JSON murni.",
          marketRegime: shortlistPack.marketRegime,
          ihsg: {
            close: shortlistPack.ihsg?.close,
            changePct: shortlistPack.ihsg?.changePct,
            // compact context only
            contextSummary: shortlistPack.ihsg?.context?.summary,
            volTrend: shortlistPack.ihsg?.context?.vol?.volumeTrend,
            m1: shortlistPack.ihsg?.context?.m1
              ? {
                  retPct: shortlistPack.ihsg.context.m1.retPct,
                  structure: shortlistPack.ihsg.context.m1.structure
                }
              : null
          },
          breadth: shortlistPack.breadth,
          globals: (shortlistPack.globals || []).slice(0, 8).map((g) => ({
            label: g.label,
            changePct: g.changePct
          })),
          shortlist: (shortlistPack.shortlist || []).map((s) => ({
            ticker: s.ticker,
            whySelected: s.whySelected,
            metrics: {
              close: s.metrics?.close,
              changePct: s.metrics?.changePct ?? s.metrics?.ret1dPct,
              rvol: s.metrics?.rvol,
              zRet: s.metrics?.zRet ?? s.metrics?.returnZ
            },
            structure:
              s.context?.m1?.structure || s.context?.w1?.structure || null,
            m1Ret: s.context?.m1?.retPct,
            volTrend: s.context?.vol?.volumeTrend,
            vsIhsg: s.vsIhsg,
            flowHints: s.flowHints
          })),
          research: {
            macroNote: research?.macroNote,
            macroOutlookTag: research?.macroOutlookTag,
            hotTakes: research?.hotTakes,
            unexplainedMarket: research?.unexplainedMarket,
            searchPlan: (research?.searchPlan || []).slice(0, 12),
            findings: (research?.findings || []).slice(0, 24),
            marketNotes: (research?.marketNotes || []).slice(0, 12),
            perTicker: research?.perTicker,
            agentMeta: research?.agentMeta
          },
          clarificationsFromWeb: clarifications,
          memoryRecent: (memory || []).slice(0, 4)
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
  // indicators attached after writer too; attach early so analysis draft has them if writer fails
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
  // legacy slot for old renderers
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
    const native = await chatWithNativeWebSearch({
      model,
      system:
        analysisSystem() +
        `\nKamu HANYA klarifikasi hole. Return JSON:
{"clarifications":[{"hole":"","claim":"","sourceTier":"media|official|rumor|unknown","url":"","changesMind":false,"hiddenAngle":""}]}
Max 4 hole paling kritis. Skeptis pragmatis, bukan overhate.`,
      user: `Day=${shortlistPack.day} regime=${shortlistPack.marketRegime?.tag}
Research macro: ${research?.macroNote || "—"}
Hot: ${(research?.hotTakes || []).join(" · ")}
Holes:
${holes.map((h, i) => `${i + 1}. ${h}`).join("\n")}
Cari hidden angle bila ada (ownership, peer, calendar, sector).`,
      signal,
      isJson: true,
      unrestrictedWeb: true,
      temperature: null,
      reasoningEffort: "auto",
      onLog
    });
    if (native.ok !== false && native.content) {
      const p =
        typeof native.content === "object" && native.content
          ? native.content
          : parseJsonLoose(native.content);
      if (p?.clarifications?.length) {
        onLog?.(`Analysis clarifications=${p.clarifications.length}`);
        return p.clarifications;
      }
      if (String(native.content).length > 40) {
        return [
          {
            hole: "raw",
            claim: String(native.content).slice(0, 800),
            sourceTier: "media"
          }
        ];
      }
    }
  } catch (e) {
    onLog?.("Analysis clarify fail: " + e.message, "warn");
  }
  return [];
}

function collectHoles(shortlistPack, research) {
  const holes = [];
  for (const u of research?.unexplainedMarket || []) holes.push(String(u));
  const per = research?.perTicker || {};
  for (const s of shortlistPack.shortlist || []) {
    const r = per[s.ticker] || {};
    if (r.unexplained || !r.catalysts?.length) {
      holes.push(`${s.ticker}: tape aneh / berita tipis — cari katalis atau konfirm unexplained`);
    }
    if (
      String(r.fundamentalsNote || "")
        .toUpperCase()
        .includes("TIDAK") ||
      !r.fundamentalsNote
    ) {
      holes.push(`${s.ticker}: funda/lapkeu/proyek — cek aksi korp atau guidance`);
    }
    if (s.flowHints?.exitLiquidityHint === "high") {
      holes.push(`${s.ticker}: exit-liq high — pure tape atau ada berita?`);
    }
    if (s.metrics?.rvol != null && s.metrics.rvol >= 1.5) {
      holes.push(`${s.ticker}: volume lonjak — apa katalis sesi?`);
    }
  }
  if ((shortlistPack.ihsg?.changePct || 0) <= -1.2) {
    holes.push("IHSG drop tajam — penopang/pemberat + vs global");
  }
  return [...new Set(holes.filter(Boolean))].slice(0, 8);
}

/** Map new sentiment fields + legacy fear/positive for render */
export function mergeSentimentShapes(briefing) {
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
  briefing.schemaVersion = briefing.schemaVersion || 2;
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
        ? "Jangan nampung spike sepi. Skip thin tape."
        : "Ikut flow yang volume-nya hidup; skip yang mati.";
  }
  if (!mw.followMoneyThesis) mw.followMoneyThesis = packPlain.whatItMeans;
  if (!mw.story) mw.story = mw.plainHeadline + " " + (mw.whatItMeans || "");
  if (!mw.reasoningChain?.length) {
    mw.reasoningChain = [
      packPlain.plainHeadline,
      packPlain.whatItMeans,
      mw.bestMoveOverall
    ].filter(Boolean);
  }

  const researchPer = research?.perTicker || {};
  briefing.shortlist = (briefing.shortlist || []).map((row) => {
    const hard = plainFromHard(row);
    const priceH = heuristicPriceOutlook(row);
    row.plain = {
      whatHappened: stripJargon(row.plain?.whatHappened) || hard.whatHappened,
      whyItMatters: stripJargon(row.plain?.whyItMatters) || hard.whyItMatters,
      whatToDo: stripJargon(row.plain?.whatToDo) || row.bestMoveFraming || hard.whatToDo
    };
    if (looksLikeJargonSoup(row.plain.whatHappened)) {
      row.plain.whatHappened = hard.whatHappened;
    }
    if (row.narrative && looksLikeJargonSoup(row.narrative)) {
      row.narrative = row.plain.whatHappened + " " + row.plain.whyItMatters;
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
    row.outlook.priceWhy = stripJargon(row.outlook.priceWhy) || priceH.why;
    row.outlook.fundamentals = row.outlook.fundamentals || row.fundamentals.outlookTag;
    row.outlook.fundamentalsWhy =
      stripJargon(row.outlook.fundamentalsWhy) || row.fundamentals.outlookWhy;
    row.outlook.combined =
      row.outlook.combined ||
      combineOutlook(
        row.outlook.price,
        row.outlook.fundamentals,
        row.stance?.exitLiquidityRisk
      );
    if (!row.bestMoveFraming) row.bestMoveFraming = row.plain.whatToDo;
    if (!row.insight) {
      row.insight = row.plain.whyItMatters?.slice(0, 160) || row.ticker;
    }
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
    t.match(/flowAlive|volumeTrend|rvol|m1\+|y1\+|exit-liq|HH_HL|LH_LL|post-parabolic|ret1d|zRet/gi) ||
    []
  ).length;
  const hasSpaces = (t.match(/\s/g) || []).length;
  return hits >= 3 || (hits >= 2 && hasSpaces < 8);
}

/** Soft-clean metric dumps inside otherwise ok prose */
function stripJargon(s) {
  if (!s) return "";
  let t = String(s);
  if (looksLikeJargonSoup(t)) return "";
  // light scrub of code tokens
  t = t
    .replace(/\brvol\s*[=~]?\s*[\d.]+/gi, "volume relatif")
    .replace(/\bHH_HL\b/g, "struktur naik")
    .replace(/\bLH_LL\b/g, "struktur lemah")
    .replace(/\bvolumeTrend\s*=\s*\w+/gi, "tren volume");
  return t.trim();
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
    schemaVersion: 2,
    runId,
    asOfSession: shortlistPack.day,
    searchMode,
    sentiment: {
      analysisSummary: hot || "Analysis LLM gagal — baca shortlist + research mentah.",
      trapWatch: "Cek thin volume & spike tanpa berita.",
      flowWatch: "Lihat flow di shortlist.",
      judgeLean: "neutral",
      judgeRationale: "Fallback heuristic tanpa Analysis LLM",
      judgePriority: "mixed",
      confidenceLabel: "uncalibrated"
    },
    marketWide: {
      regimeTag: shortlistPack.marketRegime?.tag || "unknown",
      story: hot || shortlistPack.marketRegime?.note || "",
      reasoningChain: [hot || "Data hard only"].filter(Boolean),
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
    analysisMeta: {
      note: "heuristic — LLM analysis gagal",
      crossChecks: [],
      hiddenContext: [],
      missedByResearch: [],
      residualDoubts: ["analysis_llm_failed"],
      clarifications: []
    },
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
