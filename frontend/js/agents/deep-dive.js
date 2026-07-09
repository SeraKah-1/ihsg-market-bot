/**
 * Deep dive emiten — Option C:
 * Agentic native web tools + reasoning (model milih query sendiri).
 * Fallback: news/Jina search pack + chatJson tanpa tools (no page fetch).
 */
import { chatJson, modelFor, parseJsonLoose, salvageFindingsFromText } from "../ai.js";
import { GLOBAL_RULES, deepDiveNarrativeRules } from "./constitution.js";
import { modelSupportsNativeSearch } from "../search/native-search.js";
import { runAgenticNativeLoop } from "../search/agentic-web.js";
import { hybridResearchSearch, researchModel } from "../search/native-search.js";
import { plainFromHard, heuristicPriceOutlook } from "../metric-gloss.js";
import { attachIndicatorsToDeepDive } from "../indicators-pack.js";

export function deepDiveSystem() {
  return (
    GLOBAL_RULES +
    "\n\n" +
    deepDiveNarrativeRules() +
    `

ROLE: Deep-dive emiten IDX — analist yang ngeburu fakta + cerita kuat.
1) Baca hard metrics (referensi) — JANGAN dump ke prose.
2) Web hunt KOMPREHENSIF (multi-round):
   - profil bisnis + peer sektor
   - lapkeu / guidance / dividen (multi sumber)
   - aksi korp: right issue, buyback, private placement, stock split
   - proyek / kontrak / ekspansi / capex
   - litigasi, denda, OJK/BEI, free float
   - sentimen media + makro sektor
3) story + reasoningChain yang nyambung (setup → bukti search → keputusan).
4) plain + outlook tape/funda/combined.
5) Official / media / rumor. Jangan mengarang angka lapkeu.
6) Forecast + invalidation + exit-liq.

Output JSON ketat. Prose tanpa rantai indikator.`
  );
}

export function deepDiveSchema() {
  return `{
  "kind": "deep_dive",
  "schemaVersion": 1,
  "runId": "",
  "ticker": "",
  "asOfSession": "",
  "searchMode": "",
  "confidenceLabel": "uncalibrated",
  "agentMeta": {
    "mode": "agentic_native|fallback_pack",
    "rounds": 0,
    "reasoningEffort": null,
    "queriesNote": ""
  },
  "story": "1-2 paragraf throughline emiten — koheren, tanpa dump angka",
  "reasoningChain": ["langkah 1", "langkah 2", "langkah 3"],
  "plain": {
    "whatHappened": "narasi — NO dump rvol/m1",
    "whyItMatters": "",
    "whatToDo": ""
  },
  "outlook": {
    "price": "cerah|biasa|suram",
    "fundamentals": "cerah|biasa|suram",
    "combined": "cerah|biasa|suram",
    "why": "gabungan tape + funda + sentimen/makro",
    "fundamentalsWhy": "",
    "macro": "backdrop sektor/makro singkat"
  },
  "company": {
    "name": "",
    "sector": "",
    "oneLiner": "",
    "business": "",
    "products": "",
    "positioning": "",
    "peers": ""
  },
  "financials": {
    "summary": "",
    "revenueMargin": "",
    "balanceSheet": "",
    "cashFlow": "",
    "valuationNotes": "",
    "outlookTag": "cerah|biasa|suram",
    "outlookWhy": "",
    "sources": []
  },
  "prospects": { "summary": "", "projects": "", "macro": "" },
  "corporateActions": [{"type":"", "detail":"", "date":""}],
  "catalysts": [{"title":"", "detail":""}],
  "risks": [{"title":"", "detail":""}],
  "needles": [{"title":"", "detail":""}],
  "forecast": {
    "lean": "fear|neutral|positive",
    "thesis": "",
    "horizon": "1-4w",
    "invalidation": "",
    "bestMove": "",
    "exitLiquidityRisk": "low|med|high",
    "scenarios": {
      "base": {"narrative":"","prob":0.5},
      "bull": {"narrative":"","prob":0.25},
      "bear": {"narrative":"","prob":0.25}
    }
  },
  "unexplained": [],
  "sources": [{"title":"", "url":""}],
  "disclaimer": ""
}`;
}

/**
 * Comprehensive seed queries for hybrid fallback + agent hints.
 */
export function deepDiveQueries(ticker, day) {
  const t = String(ticker || "").toUpperCase().replace(/\.JK$/, "");
  const d = day || "";
  return [
    `${t} perusahaan profil bisnis sektor IDX`,
    `${t} peer kompetitor sektor saham Indonesia`,
    `${t} laporan keuangan OR laba OR revenue OR guidance OR EPS`,
    `${t} laporan keuangan kuartal terbaru`,
    `${t} dividen OR payout OR yield OR DPS`,
    `${t} aksi korporasi OR right issue OR buyback OR private placement OR stock split`,
    `${t} proyek OR kontrak OR ekspansi OR capex OR joint venture`,
    `${t} berita ${d}`.trim(),
    `${t} saham kenapa naik OR turun volume`,
    `${t} risiko OR denda OR litigasi OR OJK OR BEI OR default`,
    `${t} free float OR pemegang saham pengendali OR ultimated beneficial`,
    `${t} outlook OR target harga OR analis OR rating`,
    `${t} IDX disclosure OR keterbukaan informasi OR public expose`,
    `${t} utang OR bond OR sukuk OR refinancing`,
    `${t} sektor industri sentimen makro Indonesia`,
    `${t} related party OR afiliasi OR transaksi material`
  ];
}

function buildHardContextPayload(ticker, marketPack, memory) {
  const stock = marketPack?.stock || null;
  return {
    ticker,
    asOfSession: marketPack?.day,
    marketRegime: marketPack?.marketRegime,
    ihsgContext: marketPack?.ihsg?.context,
    stock: stock
      ? {
          metrics: {
            close: stock.close,
            changePct: stock.changePct,
            rvol: stock.rvol,
            zRet: stock.zRet
          },
          context: stock.context,
          vsIhsg: stock.vsIhsg
        }
      : null,
    memoryRecent: (memory || []).slice(0, 6),
    searchCoverageChecklist: [
      "profil + peer",
      "lapkeu/guidance/dividen",
      "aksi korporasi",
      "proyek/kontrak",
      "regulasi/litigasi",
      "sentimen + makro sektor",
      "berita sesi / kenapa gerak"
    ],
    instruction: [
      `Deep dive KOMPREHENSIF ${ticker}.`,
      "Multi-round web_search: tutup checklist di atas.",
      "Narasi story + reasoningChain; prose TANPA dump indikator (ada di UI JSON).",
      "Jangan mengarang angka lapkeu. unexplained jika kosong.",
      "JSON deep_dive lengkap."
    ].join(" ")
  };
}

function finalizeReport(out, { ticker, marketPack, searchMode, runId, stock, agentMeta, citations, searchResults }) {
  out.kind = "deep_dive";
  out.runId = runId;
  out.ticker = ticker;
  out.asOfSession = marketPack?.day;
  out.searchMode = searchMode;
  out.confidenceLabel = out.confidenceLabel || "uncalibrated";
  out.agentMeta = { ...(out.agentMeta || {}), ...agentMeta };
  out.marketContext = stock?.context || null;
  out.context = stock?.context || null;
  out.vsIhsg = stock?.vsIhsg || null;
  out.metrics = stock?.metrics || out.metrics || null;
  out.marketRegime = marketPack?.marketRegime || null;
  out.disclaimer =
    out.disclaimer ||
    "Bukan saran investasi. Deep dive dari data publik + search dinamis; angka lapkeu verifikasi ke sumber resmi.";
  if (!out.sources?.length) {
    const fromCitations = (citations || []).slice(0, 12).map((c) => ({
      title: c.title || "",
      url: c.url || ""
    }));
    const fromSearch = (searchResults || []).slice(0, 12).map((r) => ({
      title: r.title || "",
      url: r.url || ""
    }));
    out.sources = fromCitations.length ? fromCitations : fromSearch;
  }
  // Human plain + outlook fallbacks from hard data
  const hardStock = {
    ticker,
    metrics: stock?.metrics,
    context: stock?.context,
    whySelected: ["deep_dive"],
    flowHints: stock?.flowHints
  };
  const hard = plainFromHard(hardStock);
  const priceH = heuristicPriceOutlook(hardStock);
  out.plain = {
    whatHappened: out.plain?.whatHappened || hard.whatHappened,
    whyItMatters: out.plain?.whyItMatters || hard.whyItMatters,
    whatToDo: out.plain?.whatToDo || out.forecast?.bestMove || hard.whatToDo
  };
  out.outlook = out.outlook || {};
  out.outlook.price = out.outlook.price || priceH.tag;
  out.outlook.fundamentals =
    out.outlook.fundamentals || out.financials?.outlookTag || "biasa";
  out.outlook.combined =
    out.outlook.combined ||
    (out.forecast?.exitLiquidityRisk === "high"
      ? "suram"
      : out.outlook.price === "cerah" && out.outlook.fundamentals === "cerah"
        ? "cerah"
        : out.outlook.price === "suram" || out.outlook.fundamentals === "suram"
          ? "suram"
          : "biasa");
  out.outlook.why = out.outlook.why || out.forecast?.thesis || priceH.why;
  if (!out.financials) out.financials = {};
  if (!out.financials.outlookTag) out.financials.outlookTag = out.outlook.fundamentals;
  return attachIndicatorsToDeepDive(out, stock);
}

function errorReport({ ticker, marketPack, searchMode, runId, stock, err, searchResults }) {
  return {
    kind: "deep_dive",
    runId,
    ticker,
    asOfSession: marketPack?.day,
    searchMode,
    confidenceLabel: "uncalibrated",
    agentMeta: { mode: "error", rounds: 0 },
    company: {
      name: ticker,
      oneLiner: "Deep dive gagal",
      business: String(err?.message || err || "unknown")
    },
    financials: { summary: "unavailable" },
    prospects: { summary: "unavailable", projects: "" },
    corporateActions: [],
    catalysts: [],
    risks: [{ title: "pipeline_error", detail: String(err?.message || err) }],
    needles: [],
    forecast: {
      lean: "neutral",
      thesis: "Tidak bisa menyimpulkan — agent error",
      horizon: "—",
      invalidation: "—",
      bestMove: "Tunda keputusan sampai deep dive sukses",
      exitLiquidityRisk: "med",
      scenarios: {
        base: { narrative: "—", prob: 0.34 },
        bull: { narrative: "—", prob: 0.33 },
        bear: { narrative: "—", prob: 0.33 }
      }
    },
    unexplained: ["deep_dive_llm_failed"],
    sources: (searchResults || []).slice(0, 8).map((r) => ({
      title: r.title,
      url: r.url
    })),
    marketContext: stock?.context,
    context: stock?.context,
    vsIhsg: stock?.vsIhsg,
    marketRegime: marketPack?.marketRegime,
    disclaimer: "Error path — bukan analisa lengkap."
  };
}

/**
 * Option C entry: prefer agentic native tools + reasoning.
 * @param {{ searchResults?: any[], pageContents?: any[] }} opts — pageContents ignored (legacy)
 */
export async function runDeepDiveAgent({
  ticker,
  marketPack,
  searchResults = [],
  pageContents: _legacyPages = [],
  searchMode,
  memory,
  runId,
  signal,
  onLog
}) {
  void _legacyPages;
  // Research model default (any model — native+reasoning tried with cascade)
  let model = researchModel();
  try {
    if (!String(model || "").trim()) model = modelFor("research") || modelFor("analysis");
  } catch {
    /* */
  }
  onLog?.(`DeepDive model=${model} ticker=${ticker} mode=${searchMode}`);

  const stock = marketPack?.stock || null;
  const schema = deepDiveSchema();
  const hard = buildHardContextPayload(ticker, marketPack, memory);
  const system = deepDiveSystem() + "\nSchema:\n" + schema;

  // --- Path A: agentic native for any model unless DEGRADED / explicit FALLBACK ---
  // FULL + auto both try native; FALLBACK skips to pack; DEGRADED no web.
  const canAgentic =
    searchMode !== "DEGRADED" &&
    searchMode !== "FALLBACK" &&
    modelSupportsNativeSearch(model);

  if (canAgentic) {
    onLog?.(
      "Deep dive agentic: native tools + reasoning cascade (high→med→low→off) untuk SEMUA model…"
    );
    const agentic = await runAgenticNativeLoop({
      model,
      system,
      user: JSON.stringify(hard, null, 2),
      signal,
      onLog,
      maxRounds: 7,
      unrestrictedWeb: true,
      temperature: null,
      reasoningEffort: "auto",
      intermediateHint: `Deep dive HUNT KOMPREHENSIF multi-round. Tutup SEMUA bucket sebelum done:
business, peer, financials (multi sumber), corp_action, project/capex, legal/OJK, free_float/ownership, sentiment, macro_sector, session_news.
Jangan skim. Query spesifik. Hidden angle (related party, refinancing, peer pressure) diutamakan.
Return JSON:
{
  "status": "continue|done",
  "reasoning_brief": "hipotesis dari hard data + gap",
  "queries_used": [],
  "findings": [{"claim":"","sourceTier":"media|official|rumor|unknown","url":"","query":"","bucket":"business|peer|financials|corp_action|project|legal|ownership|sentiment|macro|session"}],
  "coverage": {"business":false,"peer":false,"financials":false,"corp_action":false,"project":false,"legal":false,"ownership":false,"sentiment":false,"macro":false,"session":false},
  "gaps": [],
  "next_queries": [],
  "hiddenAngles": []
}
status=done hanya jika ≥7/10 coverage true ATAU residual gaps = unexplained eksplisit.`,
      finalSchemaHint: "Schema deep_dive (JSON):\n" + schema
    });

    if ((agentic.content || agentic.citations?.length) && agentic.mode !== "NATIVE_FAILED") {
      try {
        let parsed =
          typeof agentic.content === "object" && agentic.content
            ? agentic.content
            : parseJsonLoose(agentic.content);

        if (!parsed) {
          const salvaged = salvageFindingsFromText(agentic.content);
          for (const f of salvaged) {
            searchResults.push({
              title: f.claim,
              snippet: f.claim,
              url: f.url,
              provider: "agentic-salvage"
            });
          }
          for (const c of agentic.citations || []) {
            searchResults.push({
              title: c.title,
              url: c.url,
              snippet: "",
              provider: "native-citation"
            });
          }
          onLog?.(
            `Deep dive agentic non-JSON → salvage hits=${salvaged.length + (agentic.citations || []).length}`,
            "warn"
          );
          throw new Error("non_json_salvaged");
        }

        // reject intermediate-only payload
        if (parsed.status === "continue" && !parsed.company && !parsed.forecast) {
          throw new Error("intermediate_only");
        }
        // if intermediate with findings only, fall through to pack path with findings
        if (parsed.findings && !parsed.forecast && !parsed.company) {
          searchResults = [
            ...searchResults,
            ...parsed.findings.map((f) => ({
              title: f.claim || "",
              snippet: f.claim || "",
              url: f.url || "",
              sourceTier: f.sourceTier || "media",
              provider: "agentic-finding",
              query: f.query || ""
            }))
          ];
          onLog?.("Agentic hanya findings — synthesize via fallback JSON", "warn");
        } else {
          return finalizeReport(parsed, {
            ticker,
            marketPack,
            searchMode: searchMode === "FALLBACK" ? "FULL" : searchMode,
            runId,
            stock,
            agentMeta: {
              mode: "agentic_native",
              rounds: agentic.rounds,
              reasoningEffort: agentic.reasoningEffort || null,
              nativeMode: agentic.mode,
              searchLog: agentic.searchLog,
              queriesNote: "Model menyusun query sendiri via tools"
            },
            citations: agentic.citations,
            searchResults
          });
        }
      } catch (e) {
        if (e.message !== "non_json_salvaged") {
          onLog?.(`Parse agentic gagal (${e.message}) — fallback pack`, "warn");
        }
        if (agentic.content && e.message !== "non_json_salvaged") {
          searchResults = [
            ...searchResults,
            {
              title: "agentic_prose",
              snippet: String(
                typeof agentic.content === "string"
                  ? agentic.content
                  : JSON.stringify(agentic.content)
              ).slice(0, 4000),
              url: "",
              provider: "agentic-prose"
            }
          ];
        }
        for (const c of agentic.citations || []) {
          if (!searchResults.some((r) => r.url && r.url === c.url)) {
            searchResults.push({
              title: c.title,
              url: c.url,
              snippet: "",
              provider: "native-citation"
            });
          }
        }
      }
    } else {
      onLog?.(
        `Agentic native gagal (${agentic.error || agentic.mode}) — fallback pack`,
        "warn"
      );
    }
  }

  // --- Path B: FALLBACK / DEGRADED / native failed — comprehensive hybrid + optional page fetch ---
  let packResults = searchResults || [];
  let pageContents = [];
  if (searchMode !== "DEGRADED" && packResults.length < 8) {
    onLog?.("Deep dive hybrid: comprehensive seed queries + fetch pages…");
    try {
      const hybrid = await hybridResearchSearch({
        model,
        queries: deepDiveQueries(ticker, marketPack?.day),
        searchMode: searchMode === "FULL" ? "FALLBACK" : searchMode,
        signal,
        onLog,
        unrestrictedWeb: true,
        fetchPages: true,
        fetchLimit: 8
      });
      packResults = [...packResults, ...(hybrid.results || [])];
      pageContents = hybrid.pages || [];
      onLog?.(
        `Deep dive hybrid hits=${packResults.length} pages=${pageContents.length} layer=${hybrid.layer}`
      );
    } catch (e) {
      onLog?.("Hybrid pack error: " + (e.message || e), "warn");
    }
  }

  try {
    onLog?.(
      `Deep dive synthesize chatJson · hits=${packResults.length} pages=${pageContents.length}`
    );
    const payload = {
      ...hard,
      searchMode,
      searchResults: packResults.slice(0, 70),
      pageContents: (pageContents || []).slice(0, 8).map((p) => ({
        url: p.url || p.source || "",
        title: p.title || "",
        text: String(p.content || p.text || p.markdown || "").slice(0, 7000)
      })),
      note:
        searchMode === "DEGRADED"
          ? "Tanpa web live. Jangan mengarang berita."
          : "Hunt komprehensif: gabungkan searchResults + pageContents. Prose tanpa dump indikator. story + reasoningChain wajib."
    };
    const out = await chatJson({
      model: modelFor("analysis") || model,
      system,
      user:
        JSON.stringify(payload, null, 2) +
        "\n\nTugas: deep dive komprehensif " +
        ticker +
        ". Narasi koheren + insight. Tutup seksi bisnis/lapkeu/aksi korp/proyek/risiko. unexplained jika kosong.",
      signal,
      temperature: null,
      reasoningEffort: "auto",
      onLog
    });
    return finalizeReport(out, {
      ticker,
      marketPack,
      searchMode,
      runId,
      stock,
      agentMeta: {
        mode: "fallback_pack",
        rounds: 0,
        reasoningEffort: null,
        queriesNote: "Fixed seed queries + pack (native agentic unavailable)"
      },
      citations: [],
      searchResults: packResults
    });
  } catch (e) {
    onLog?.("DeepDive gagal: " + e.message, "err");
    return errorReport({
      ticker,
      marketPack,
      searchMode,
      runId,
      stock,
      err: e,
      searchResults: packResults
    });
  }
}
