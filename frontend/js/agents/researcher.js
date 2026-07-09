/**
 * Researcher agent — decides what to search + runs native web_search (agentic).
 * Fallback: hybrid Jina/news with seed queries from hard data.
 */
import {
  chatJson,
  modelFor,
  parseJsonLoose,
  salvageFindingsFromText
} from "../ai.js";
import { researcherSystem } from "./constitution.js";
import { runAgenticNativeLoop } from "../search/agentic-web.js";
import {
  hybridResearchSearch,
  modelSupportsNativeSearch,
  researchModel
} from "../search/native-search.js";

export function researchPackSchema() {
  return `{
  "marketNotes": [{"claim":"","sourceTier":"media|official|rumor|unknown","url":"","query":""}],
  "macroNote": "backdrop makro/global/domestik — lurus, 1-3 kalimat",
  "macroOutlookTag": "cerah|biasa|suram",
  "searchPlan": ["query yang kamu pilih + kenapa singkat"],
  "hotTakes": ["1-3 punchline dari hunt — boleh tajam"],
  "perTicker": {
    "TICKER": {
      "catalysts": [{"claim":"","sourceTier":"","url":""}],
      "unexplained": false,
      "notes": "apa yang ketemu / kosong — bahasa chat",
      "fundamentalsNote": "lapkeu/proyek/aksi korp atau TIDAK KETEMU",
      "outlookTag": "cerah|biasa|suram",
      "queriesUsed": []
    }
  },
  "unexplainedMarket": [],
  "findings": [{"claim":"","sourceTier":"","url":"","query":"","ticker":""}]
}`;
}

function seedQueriesFromPack(shortlistPack) {
  const day = shortlistPack.day || "";
  const qs = [
    `IHSG ${day} penopang pemberat penyebab`,
    `IHSG vs global ${day} underperform OR rebound`,
    `IHSG ${day} asing lokal net buy sell`,
    `rupiah BI rate yield Indonesia pasar saham`,
    `Indonesia stock market news ${day} catalyst`
  ];
  for (const s of shortlistPack.shortlist || []) {
    const t = s.ticker;
    qs.push(`${t} saham berita IDX ${day}`.trim());
    qs.push(`${t} right issue OR buyback OR aksi korporasi OR private placement`);
    qs.push(`${t} laporan keuangan OR laba OR revenue OR guidance OR dividen`);
    qs.push(`${t} proyek OR kontrak OR ekspansi OR capex`);
    qs.push(`${t} OJK OR BEI OR denda OR litigasi OR free float`);
    const ret = s.metrics?.ret1dPct ?? s.metrics?.changePct;
    if (ret != null && Math.abs(ret) >= 2) {
      qs.push(`${t} kenapa ${ret > 0 ? "naik" : "turun"} saham`);
    }
    if (s.metrics?.rvol != null && s.metrics.rvol >= 1.4) {
      qs.push(`${t} volume lonjak OR unusual volume`);
    }
  }
  // de-dupe preserve order
  return [...new Set(qs)].slice(0, 36);
}

function normalizeResearch(out, shortlistPack, meta = {}) {
  const base = out && typeof out === "object" ? out : {};
  const perTicker = { ...(base.perTicker || {}) };
  for (const s of shortlistPack.shortlist || []) {
    if (!perTicker[s.ticker]) {
      perTicker[s.ticker] = {
        catalysts: [],
        unexplained: true,
        notes: "tidak ada hit khusus",
        fundamentalsNote: "TIDAK KETEMU di hunt",
        outlookTag: "biasa"
      };
    }
  }
  return {
    marketNotes: base.marketNotes || [],
    macroNote: base.macroNote || "",
    macroOutlookTag: base.macroOutlookTag || "biasa",
    searchPlan: base.searchPlan || [],
    hotTakes: base.hotTakes || [],
    perTicker,
    unexplainedMarket: base.unexplainedMarket || [],
    findings: base.findings || [],
    agentMeta: {
      role: "researcher",
      mode: meta.mode || "unknown",
      reasoningEffort: meta.reasoningEffort || null,
      rounds: meta.rounds || 0,
      citations: meta.citations || []
    }
  };
}

/**
 * @returns research pack
 */
export async function runResearcher({
  shortlistPack,
  searchMode,
  memory,
  signal,
  onLog
}) {
  const model = modelFor("research");
  onLog?.(`Researcher model=${model} mode=${searchMode} · agentic search + reason`);

  const hardUser = {
    task: "Hunt berita/katalis. Kamu yang nentuin query dari data hard di bawah.",
    searchMode,
    day: shortlistPack.day,
    ihsg: {
      close: shortlistPack.ihsg?.close,
      changePct: shortlistPack.ihsg?.changePct,
      context: shortlistPack.ihsg?.context
    },
    marketRegime: shortlistPack.marketRegime,
    breadth: shortlistPack.breadth,
    globals: (shortlistPack.globals || []).map((g) => ({
      label: g.label,
      changePct: g.changePct
    })),
    shortlist: (shortlistPack.shortlist || []).map((s) => ({
      ticker: s.ticker,
      whySelected: s.whySelected,
      metrics: s.metrics,
      context: s.context,
      vsIhsg: s.vsIhsg,
      flowHints: s.flowHints
    })),
    memoryRecent: (memory || []).slice(0, 6)
  };

  // --- Path A: FULL agentic native ---
  if (searchMode !== "DEGRADED" && searchMode !== "FALLBACK" && modelSupportsNativeSearch(model)) {
    const agentic = await runAgenticNativeLoop({
      model,
      system: researcherSystem() + "\nSchema final:\n" + researchPackSchema(),
      user: JSON.stringify(hardUser, null, 2),
      signal,
      onLog,
      maxRounds: 6,
      unrestrictedWeb: true,
      temperature: null,
      reasoningEffort: "auto",
      intermediateHint: `Hunt KOMPREHENSIF multi-angle:
- IHSG penopang/pemberat + vs global + asing/lokal
- Makro (BI, rupiah, komoditas relevan)
- Per ticker: sesi, aksi korp, lapkeu/proyek, litigasi/OJK, peer bila perlu
Jangan done dini. Tutup gap dulu.
JSON:
{
  "status": "continue|done",
  "reasoning_brief": "",
  "queries_used": [],
  "findings": [{"claim":"","sourceTier":"","url":"","query":"","ticker":"","bucket":"market|macro|session|corp_action|financials|project|legal|peer"}],
  "coverage": {"market":false,"macro":false,"tickersWithHits":[]},
  "gaps": [],
  "next_queries": []
}
done HANYA jika: market+macro ada temuan DAN (mayoritas ticker ≥1 finding ATAU unexplained jelas per ticker kosong).`,
      finalSchemaHint: researchPackSchema()
    });

    if (agentic.mode !== "NATIVE_FAILED" && (agentic.content || agentic.citations?.length)) {
      let parsed =
        typeof agentic.content === "object" && agentic.content
          ? agentic.content
          : parseJsonLoose(agentic.content);

      // Model dumped html <web_...> / prose — salvage findings, don't hard-fail
      if (!parsed) {
        const salvaged = salvageFindingsFromText(agentic.content);
        const fromCites = (agentic.citations || []).map((c) => ({
          claim: c.title || c.url || "",
          url: c.url || "",
          sourceTier: "media",
          query: ""
        }));
        const findings = [...fromCites, ...salvaged];
        if (findings.length) {
          onLog?.(
            `Researcher agentic non-JSON (html/web dump) → salvage findings=${findings.length}`,
            "warn"
          );
          parsed = {
            marketNotes: findings.slice(0, 8).map((f) => ({
              claim: f.claim,
              url: f.url,
              sourceTier: f.sourceTier || "media"
            })),
            findings,
            hotTakes: [],
            macroNote: "Dari dump web search (bukan JSON bersih) — cek ulang di Analysis.",
            macroOutlookTag: "biasa",
            perTicker: {},
            unexplainedMarket: ["agentic_output_not_json"],
            searchPlan: ["(model return non-JSON; findings di-salvage)"]
          };
        } else {
          onLog?.(
            "Researcher agentic parse gagal: no JSON & no salvageable findings → hybrid",
            "warn"
          );
        }
      }

      if (parsed) {
        if (!parsed.findings?.length && agentic.citations?.length) {
          parsed.findings = agentic.citations.map((c) => ({
            claim: c.title || "",
            url: c.url || "",
            sourceTier: "media",
            query: ""
          }));
        }
        // If salvage thin — one more non-tool pass to structure into schema
        const thin =
          parsed.unexplainedMarket?.includes?.("agentic_output_not_json") ||
          !(parsed.findings || []).length ||
          !parsed.perTicker ||
          !Object.keys(parsed.perTicker || {}).length;
        if (thin && (parsed.findings || []).length) {
          try {
            onLog?.("Researcher finalize JSON structure (no tools)…");
            const structured = await chatJson({
              model,
              system:
                researcherSystem() +
                "\nRangkum findings di bawah ke schema research pack. Jangan mengarang URL baru.\nSchema:\n" +
                researchPackSchema(),
              user: JSON.stringify(
                {
                  hard: hardUser,
                  findingsRaw: (parsed.findings || []).slice(0, 40),
                  marketNotes: parsed.marketNotes,
                  note: "Strukturkan saja. Hot takes boleh tajam."
                },
                null,
                2
              ),
              signal,
              temperature: null,
              reasoningEffort: "auto",
              onLog
            });
            parsed = { ...parsed, ...structured, findings: structured.findings || parsed.findings };
          } catch (e) {
            onLog?.("Researcher finalize skip: " + e.message, "warn");
          }
        }
        onLog?.(
          `Researcher OK agentic rounds=${agentic.rounds} reason=${agentic.reasoningEffort || "off"} cites=${(agentic.citations || []).length} findings=${(parsed.findings || []).length}`
        );
        return normalizeResearch(parsed, shortlistPack, {
          mode: parsed.unexplainedMarket?.includes?.("agentic_output_not_json")
            ? "agentic_salvage"
            : "agentic_native",
          reasoningEffort: agentic.reasoningEffort,
          rounds: agentic.rounds,
          citations: agentic.citations
        });
      }
    } else {
      onLog?.(`Researcher native gagal → hybrid: ${agentic.error || "—"}`, "warn");
    }
  }

  // --- Path B: FALLBACK / hybrid pack + chatJson synthesize ---
  let searchResults = [];
  if (searchMode !== "DEGRADED") {
    const queries = seedQueriesFromPack(shortlistPack);
    onLog?.(`Researcher hybrid seed queries=${queries.length}`);
    const hybrid = await hybridResearchSearch({
      model: researchModel(),
      queries,
      searchMode: searchMode === "FULL" ? "FALLBACK" : searchMode,
      signal,
      onLog,
      unrestrictedWeb: true,
      fetchPages: false
    });
    searchResults = hybrid.results || [];
    onLog?.(`Researcher hybrid hits=${searchResults.length} layer=${hybrid.layer}`);
  }

  try {
    const out = await chatJson({
      model,
      system: researcherSystem() + "\nSchema:\n" + researchPackSchema(),
      user:
        JSON.stringify(
          {
            ...hardUser,
            note:
              searchMode === "DEGRADED"
                ? "Tanpa web. Jangan mengarang berita."
                : "Rangkum searchResults jadi research pack. Hot takes boleh tajam.",
            searchResults: searchResults.slice(0, 60)
          },
          null,
          2
        ) + "\n\nIsi schema.",
      signal,
      temperature: null,
      reasoningEffort: "auto",
      onLog
    });
    return normalizeResearch(out, shortlistPack, {
      mode: searchMode === "DEGRADED" ? "degraded" : "hybrid_pack",
      reasoningEffort: out.__meta?.reasoningEffort
    });
  } catch (e) {
    onLog?.("Researcher LLM gagal: " + e.message, "err");
    const perTicker = {};
    for (const s of shortlistPack.shortlist || []) {
      const hits = searchResults.filter(
        (r) =>
          (r.query || "").toUpperCase().includes(s.ticker) ||
          (r.title || "").toUpperCase().includes(s.ticker)
      );
      perTicker[s.ticker] = {
        catalysts: hits.slice(0, 3).map((h) => ({
          claim: h.title || h.snippet || "",
          sourceTier: "media",
          url: h.url || ""
        })),
        unexplained: hits.length === 0,
        notes: hits.length ? "dari search fallback kasar" : "kosong total",
        fundamentalsNote: "TIDAK KETEMU",
        outlookTag: "biasa"
      };
    }
    return normalizeResearch(
      {
        marketNotes: searchResults.slice(0, 5).map((h) => ({
          claim: h.title || h.snippet || "",
          url: h.url || "",
          sourceTier: "media"
        })),
        perTicker,
        unexplainedMarket: [],
        error: String(e.message || e)
      },
      shortlistPack,
      { mode: "error_fallback" }
    );
  }
}

/** Legacy name */
export async function runResearch(opts) {
  return runResearcher(opts);
}
