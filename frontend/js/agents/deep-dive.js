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

export function deepDiveSystem() {
  return (
    GLOBAL_RULES +
    `

ROLE: Deep-dive analyst emiten IDX (neurodivergent scan / needle-in-haystack).
Kamu BUKAN ringkas generik. Kamu:
1) Baca data harga/context hard (fakta code) dulu — itu peta anomali.
2) Dari anomali itu, TENTUKAN sendiri apa yang harus di-search (query dinamis).
3) Pakai web search tools berkali-kali. Cari non-obvious: aksi korporasi, denda, resign, proyek, right issue, buyback, litigasi, related party, free float, belanja modal.
4) Bedakan: official / media / rumor.
5) Jika data finansial tidak ketemu: unexplained, JANGAN mengarang angka lapkeu.
6) Forecast berani tapi invalidation + exit-liq.
7) Bahasa ID, structured, no fluff.

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
    "sources": []
  },
  "prospects": { "summary": "", "projects": "" },
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
      "1) Reason: dari metrics/context hard, apa yang mencurigakan atau menarik?",
      "2) Dynamic search: susun query sendiri (boleh ID/EN), ikuti needle.",
      "3) Jangan mengarang angka lapkeu. unexplained jika kosong.",
      "4) Akhir: JSON schema deep_dive lengkap."
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
      temperature: 0.35,
      reasoningEffort: "auto",
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
