/**
 * Verify agent — pragmatic skeptic, optional web_search for clarification.
 */
import { chatJson, modelFor, parseJsonLoose } from "../ai.js";
import { verifySystem } from "./constitution.js";
import { chatWithNativeWebSearch, modelSupportsNativeSearch } from "../search/native-search.js";
import {
  enrichBriefingForHumans,
  stampBriefingMeta
} from "./analysis.js";
import { applyStanceToBriefing } from "./stance-rules.js";

/**
 * @returns final briefing (patched)
 */
export async function runVerify({
  shortlistPack,
  research,
  briefing,
  searchMode,
  runId,
  signal,
  onLog
}) {
  const model = modelFor("verify");
  onLog?.(`Verify model=${model} · skeptis pragmatis + optional web`);

  let clarifyHits = [];
  const holes = collectHoles(briefing, research);

  if (
    searchMode !== "DEGRADED" &&
    holes.length &&
    modelSupportsNativeSearch(model)
  ) {
    onLog?.(`Verify clarify holes: ${holes.slice(0, 3).join(" | ")}`);
    const native = await chatWithNativeWebSearch({
      model,
      system:
        verifySystem() +
        `\nKamu cuma klarifikasi hole. Return JSON:
{"clarifications":[{"hole":"","claim":"","sourceTier":"","url":"","changesMind":false}]}`,
      user: `Briefing draft lean=${briefing?.sentiment?.judgeLean}
Headline: ${briefing?.marketWide?.plainHeadline || ""}
Holes:
${holes.map((h, i) => `${i + 1}. ${h}`).join("\n")}
Search max 3 query paling kritis. Jangan overhate.`,
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
      if (p?.clarifications) {
        clarifyHits = p.clarifications;
        onLog?.(
          `Verify web clarifications=${clarifyHits.length} reason=${native.reasoningEffort || "off"}`
        );
      } else if (String(native.content).length > 40) {
        clarifyHits = [
          {
            hole: "raw",
            claim: String(native.content).slice(0, 800),
            sourceTier: "media"
          }
        ];
        onLog?.("Verify web non-JSON — simpan raw claim", "warn");
      }
    } else {
      onLog?.(`Verify web skip/fail: ${native.error || "—"}`, "warn");
    }
  }

  try {
    const patched = await chatJson({
      model,
      system:
        verifySystem() +
        `\nKembalikan FULL briefing JSON yang sudah di-patch (schema sama dengan analysis).
Tambah field:
"verify": {
  "note": "apa yang diubah / residual doubt — bahasa chat",
  "changedFields": ["..."],
  "residualDoubts": ["..."],
  "clarificationsUsed": []
}
Jangan bikin ulang dari nol kalau draft udah solid — patch tajam saja.
Jangan overhate: kalau analysis greget dan evidence oke, bilang "lolos" di note.`,
      user: JSON.stringify(
        {
          task: "Verify + patch briefing",
          shortlistHard: (shortlistPack.shortlist || []).map((s) => ({
            ticker: s.ticker,
            metrics: s.metrics,
            flowHints: s.flowHints,
            whySelected: s.whySelected
          })),
          researchSummary: {
            macroNote: research?.macroNote,
            hotTakes: research?.hotTakes,
            unexplainedMarket: research?.unexplainedMarket,
            perTicker: research?.perTicker
          },
          draftBriefing: stripHeavy(briefing),
          clarifications: clarifyHits
        },
        null,
        2
      ),
      signal,
      temperature: null,
      reasoningEffort: "auto",
      onLog
    });

    let out = mergePatched(briefing, patched);
    out = stampBriefingMeta(out, shortlistPack, searchMode, runId);
    out = applyStanceToBriefing(out);
    out = enrichBriefingForHumans(out, shortlistPack, research);
    out.verify = patched.verify || {
      note: "verify pass",
      clarificationsUsed: clarifyHits
    };
    // keep analysis voice fields
    out.sentiment = {
      ...(briefing.sentiment || {}),
      ...(out.sentiment || {}),
      fear: {
        summary:
          out.sentiment?.trapWatch ||
          out.sentiment?.fear?.summary ||
          briefing.sentiment?.fear?.summary ||
          ""
      },
      positive: {
        summary:
          out.sentiment?.flowWatch ||
          out.sentiment?.positive?.summary ||
          briefing.sentiment?.positive?.summary ||
          ""
      },
      confidenceLabel: "uncalibrated"
    };
    onLog?.(`Verify done: ${(out.verify?.note || "").slice(0, 120)}`);
    return out;
  } catch (e) {
    onLog?.("Verify LLM gagal — pakai draft analysis: " + e.message, "err");
    briefing.verify = {
      note: "verify skip (error): " + e.message,
      clarificationsUsed: clarifyHits
    };
    return briefing;
  }
}

function collectHoles(briefing, research) {
  const holes = [];
  for (const u of briefing?.marketWide?.unexplained || []) holes.push(String(u));
  for (const u of research?.unexplainedMarket || []) holes.push(String(u));
  for (const row of briefing?.shortlist || []) {
    if (row.fundamentals?.summary?.includes?.("TIDAK") || row.fundamentals?.summary?.includes?.("kosong")) {
      holes.push(`${row.ticker} funda kosong — cek berita/lapkeu`);
    }
    if (row.stance?.exitLiquidityRisk === "high") {
      holes.push(`${row.ticker} exit-liq high — ada katalis atau pure tape?`);
    }
  }
  // unique
  return [...new Set(holes.filter(Boolean))].slice(0, 6);
}

function stripHeavy(briefing) {
  // drop huge context tables from prompt; keep analysis fields
  return {
    sentiment: briefing.sentiment,
    marketWide: briefing.marketWide,
    shortlist: (briefing.shortlist || []).map((r) => ({
      ticker: r.ticker,
      plain: r.plain,
      fundamentals: r.fundamentals,
      outlook: r.outlook,
      stance: r.stance,
      scenarios: r.scenarios,
      bestMoveFraming: r.bestMoveFraming,
      insight: r.insight,
      whySelected: r.whySelected,
      metrics: {
        ret1dPct: r.metrics?.ret1dPct,
        rvol: r.metrics?.rvol,
        returnZ: r.metrics?.returnZ
      },
      flowHints: r.flowHints
    })),
    memoryWrite: briefing.memoryWrite,
    disclaimer: briefing.disclaimer
  };
}

function mergePatched(original, patched) {
  if (!patched || typeof patched !== "object") return original;
  const out = { ...original, ...patched };
  // ensure shortlist metrics from original code path if patched omitted
  if (Array.isArray(patched.shortlist) && Array.isArray(original.shortlist)) {
    const byT = Object.fromEntries(original.shortlist.map((r) => [r.ticker, r]));
    out.shortlist = patched.shortlist.map((row) => {
      const o = byT[row.ticker];
      if (!o) return row;
      return {
        ...o,
        ...row,
        metrics: o.metrics,
        context: o.context,
        vsIhsg: o.vsIhsg,
        flowHints: o.flowHints || row.flowHints
      };
    });
  }
  return out;
}
