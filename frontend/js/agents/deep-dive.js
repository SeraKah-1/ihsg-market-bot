import { chatJson, modelFor } from "../ai.js";
import { GLOBAL_RULES } from "./constitution.js";

export function deepDiveSystem() {
  return (
    GLOBAL_RULES +
    `

ROLE: Deep-dive analyst emiten IDX (neurodivergent scan / needle-in-haystack).
Kamu BUKAN ringkas generik. Kamu:
1) Baca data harga/context yang diberi (fakta code) dulu.
2) Baca SEMUA hasil web search — cari yang non-obvious: aksi korporasi, denda, resign, proyek, right issue, buyback, litigasi, related party, free float, belanja modal.
3) Bedakan: official / media / rumor.
4) Jika data finansial tidak ada di search: tulis unexplained, JANGAN mengarang angka lapkeu.
5) Forecast berani tapi dengan invalidation + exit-liq.
6) Bahasa ID, structured, no fluff.

Output JSON ketat sesuai schema user.`
  );
}

/**
 * Intensive query pack for one ticker.
 */
export function deepDiveQueries(ticker, day) {
  const t = String(ticker || "").toUpperCase().replace(/\.JK$/, "");
  return [
    `${t} saham perusahaan profil bisnis`,
    `${t} IDX laporan keuangan OR lapkeu OR earnings`,
    `${t} aksi korporasi OR right issue OR buyback OR dividen OR stock split`,
    `${t} proyek OR kontrak OR investasi OR ekspansi`,
    `${t} berita ${day || ""}`.trim(),
    `${t} risiko OR denda OR litigasi OR OJK OR BEI`,
    `${t} prospek OR outlook OR target harga`,
    `${t} pemegang saham OR free float OR afiliasi`
  ];
}

export async function runDeepDiveAgent({
  ticker,
  marketPack,
  searchResults,
  pageContents = [],
  searchMode,
  memory,
  runId,
  signal,
  onLog
}) {
  const model = modelFor("judge"); // deep use judge/heavy model
  onLog?.(`DeepDive model=${model} ticker=${ticker}`);

  const schema = `{
  "kind": "deep_dive",
  "schemaVersion": 1,
  "runId": "",
  "ticker": "",
  "asOfSession": "",
  "searchMode": "",
  "confidenceLabel": "uncalibrated",
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

  const stock = marketPack?.stock || null;
  const payload = {
    ticker,
    searchMode,
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
    searchResults: (searchResults || []).slice(0, 40),
    // full-page extracts (9r-fetch or free Jina) — prefer over title-only
    pageContents: (pageContents || []).slice(0, 5).map((p) => ({
      url: p.url,
      title: p.title,
      text: String(p.text || "").slice(0, 6000),
      provider: p.provider || p.layer
    })),
    memoryRecent: memory || []
  };

  try {
    const out = await chatJson({
      model,
      system: deepDiveSystem() + "\nSchema:\n" + schema,
      user:
        JSON.stringify(payload, null, 2) +
        "\n\nTugas: deep dive " +
        ticker +
        ". Utamakan pageContents (full text) lalu searchResults. Cari needle. Jangan kosongkan section tanpa unexplained.",
      signal,
      temperature: 0.35
    });
    out.kind = "deep_dive";
    out.runId = runId;
    out.ticker = ticker;
    out.asOfSession = marketPack?.day;
    out.searchMode = searchMode;
    out.confidenceLabel = out.confidenceLabel || "uncalibrated";
    out.marketContext = stock?.context || null;
    out.context = stock?.context || null;
    out.vsIhsg = stock?.vsIhsg || null;
    out.marketRegime = marketPack?.marketRegime || null;
    out.disclaimer =
      out.disclaimer ||
      "Bukan saran investasi. Deep dive dari data publik + search; angka lapkeu harus diverifikasi ke sumber resmi.";
    // attach sources from search if model omitted
    if (!out.sources?.length && searchResults?.length) {
      out.sources = searchResults.slice(0, 12).map((r) => ({
        title: r.title || "",
        url: r.url || ""
      }));
    }
    return out;
  } catch (e) {
    onLog?.("DeepDive gagal: " + e.message, "err");
    return {
      kind: "deep_dive",
      runId,
      ticker,
      asOfSession: marketPack?.day,
      searchMode,
      confidenceLabel: "uncalibrated",
      company: { name: ticker, oneLiner: "Deep dive LLM gagal", business: String(e.message || e) },
      financials: { summary: "unavailable" },
      prospects: { summary: "unavailable", projects: "" },
      corporateActions: [],
      catalysts: [],
      risks: [{ title: "pipeline_error", detail: String(e.message || e) }],
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
      sources: (searchResults || []).slice(0, 8).map((r) => ({ title: r.title, url: r.url })),
      marketContext: stock?.context,
      context: stock?.context,
      vsIhsg: stock?.vsIhsg,
      marketRegime: marketPack?.marketRegime,
      disclaimer: "Error path — bukan analisa lengkap."
    };
  }
}
