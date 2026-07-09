import { chatJson, modelFor } from "../ai.js";
import { researchSystem } from "./constitution.js";

export async function runResearch({ shortlistPack, searchMode, searchResults, memory, signal, onLog }) {
  const model = modelFor("research");
  onLog?.(`Research (${searchMode}) model=${model}`);

  const user = JSON.stringify(
    {
      task: "Bangun research pack untuk shortlist + IHSG",
      searchMode,
      note:
        searchMode === "DEGRADED"
          ? "Tanpa web search live. Jangan mengarang berita. unexplained boleh true."
          : "Pakai searchResults. Tandai sourceTier.",
      ihsg: shortlistPack.ihsg,
      globals: shortlistPack.globals,
      breadth: shortlistPack.breadth,
      shortlist: shortlistPack.shortlist,
      searchResults,
      memoryRecent: memory || []
    },
    null,
    2
  );

  const schemaHint = `{
  "marketNotes": [{"claim":"", "sourceTier":"media|official|rumor|unknown", "url":""}],
  "macroNote": "backdrop makro/global/domestik dari search (atau kosong)",
  "macroOutlookTag": "cerah|biasa|suram",
  "perTicker": {
    "TICKER": {
      "catalysts": [{"claim":"", "sourceTier":"", "url":""}],
      "unexplained": false,
      "notes": "bahasa orang: apa yang relevan",
      "fundamentalsNote": "lapkeu/proyek/aksi korp jika ada di search; jangan mengarang angka",
      "outlookTag": "cerah|biasa|suram"
    }
  },
  "unexplainedMarket": []
}`;

  try {
    const out = await chatJson({
      model,
      system: researchSystem() + "\nSchema:\n" + schemaHint,
      user: user + "\n\nIsi schema di atas.",
      signal
    });
    return out;
  } catch (e) {
    onLog?.("Research LLM gagal: " + e.message, "err");
    // degraded research from search only
    const perTicker = {};
    for (const s of shortlistPack.shortlist || []) {
      const hits = (searchResults || []).filter(
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
        notes: hits.length ? "dari search fallback" : "tidak ada hit search"
      };
    }
    return { marketNotes: [], perTicker, unexplainedMarket: [], error: String(e.message || e) };
  }
}
