/**
 * Deep dive emiten — Option C:
 * Agentic native web tools + reasoning (model milih query sendiri).
 * Fallback: news/Jina search pack + chatJson tanpa tools (no page fetch).
 */
import { chatJson, modelFor, extractJson } from "../ai.js";
import { GLOBAL_RULES } from "./constitution.js";
import { modelSupportsNativeSearch } from "../search/native-search.js";
import { runAgenticNativeLoop } from "../search/agentic-web.js";
import { hybridResearchSearch, researchModel } from "../search/native-search.js";
import { plainFromHard, heuristicPriceOutlook } from "../metric-gloss.js";

export function deepDiveSystem() {
  return (
    GLOBAL_RULES +
    `

ROLE: Deep-dive analyst emiten IDX (needle-in-haystack) — output DIBACA MANUSIA.
1) Baca metrics/context hard dulu (fakta code).
2) Dynamic search: query sendiri — bisnis, lapkeu, proyek, aksi korp, denda, right issue, makro sektor.
3) Wajib coba: ringkas lapkeu + proyeksi cerah|biasa|suram (funda) + tape harga cerah|biasa|suram + gabungan.
4) Field plain: whatHappened / whyItMatters / whatToDo (bukan rantai singkatan).
5) Bedakan official / media / rumor. JANGAN mengarang angka lapkeu.
6) Forecast + invalidation + exit-liq.
7) Bahasa ID lurus.

Output JSON ketat sesuai schema.`
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
  "plain": {
    "whatHappened": "apa yang terjadi — bahasa orang",
    "whyItMatters": "kenapa penting",
    "whatToDo": "lakukan / skip / watch + syarat"
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
    "positioning": ""
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
 * Seed hints only — agent should NOT treat as mandatory query list.
 * Used for FALLBACK hybrid path when native tools unavailable.
 */
export function deepDiveQueries(ticker, day) {
  const t = String(ticker || "").toUpperCase().replace(/\.JK$/, "");
  return [
    `${t} saham perusahaan profil bisnis`,
    `${t} IDX aksi korporasi OR right issue OR buyback`,
    `${t} berita ${day || ""}`.trim(),
    `${t} risiko OR denda OR litigasi OR OJK`,
    `${t} proyek OR kontrak OR ekspansi`
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
    instruction: [
      `Deep dive ${ticker}.`,
      "1) Reason dari metrics/context: apa yang aneh/menarik (bahasa orang).",
      "2) Search dinamis: bisnis, lapkeu, proyek, aksi korp, sentimen, makro sektor.",
      "3) Isi plain + outlook cerah|biasa|suram (price vs funda vs combined).",
      "4) Jangan mengarang angka lapkeu. unexplained jika kosong.",
      "5) JSON deep_dive lengkap."
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
  return out;
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
  pageContents = [],
  searchMode,
  memory,
  runId,
  signal,
  onLog
}) {
  // Research model default (any model — native+reasoning tried with cascade)
  let model = researchModel();
  try {
    if (!String(model || "").trim()) model = modelFor("judge");
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
      maxRounds: 3,
      unrestrictedWeb: true,

      finalSchemaHint: "Schema deep_dive (JSON):\n" + schema
    });

    if (agentic.content && agentic.mode !== "NATIVE_FAILED") {
      try {
        const raw =
          typeof agentic.content === "string"
            ? extractJson(agentic.content)
            : JSON.stringify(agentic.content);
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
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
        onLog?.(`Parse agentic gagal (${e.message}) — fallback pack`, "warn");
        // stash prose as search note
        if (agentic.content) {
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
          searchResults.push({
            title: c.title,
            url: c.url,
            snippet: "",
            provider: "native-citation"
          });
        }
      }
    } else {
      onLog?.(
        `Agentic native gagal (${agentic.error || agentic.mode}) — fallback pack`,
        "warn"
      );
    }
  }

  // --- Path B: FALLBACK / DEGRADED / native failed — hybrid search (no page fetch) + chatJson ---
  let packResults = searchResults || [];
  if (searchMode !== "DEGRADED" && packResults.length < 3) {
    onLog?.("Deep dive fallback: Jina/news pack (tanpa page fetch)…");
    try {
      const hybrid = await hybridResearchSearch({
        model,
        queries: deepDiveQueries(ticker, marketPack?.day),
        searchMode: searchMode === "FULL" ? "FALLBACK" : searchMode,
        signal,
        onLog,
        unrestrictedWeb: true,
        fetchPages: false,
        fetchLimit: 0
      });
      packResults = [...packResults, ...(hybrid.results || [])];
    } catch (e) {
      onLog?.("Hybrid pack error: " + (e.message || e), "warn");
    }
  }

  // void unused legacy
  void pageContents;

  try {
    onLog?.(`Deep dive synthesize chatJson · hits=${packResults.length}`);
    const payload = {
      ...hard,
      searchMode,
      searchResults: packResults.slice(0, 40),
      note:
        searchMode === "DEGRADED"
          ? "Tanpa web live. Jangan mengarang berita."
          : "Pakai searchResults. Query generik hanya seed — prioritaskan klaim yang relevan data hard."
    };
    const out = await chatJson({
      model: modelFor("judge") || model,
      system,
      user:
        JSON.stringify(payload, null, 2) +
        "\n\nTugas: deep dive " +
        ticker +
        ". Cari needle dari searchResults. Jangan kosongkan section tanpa unexplained.",
      signal,
      temperature: 0.35
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
