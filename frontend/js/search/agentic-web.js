/**
 * Option C: agentic native web research.
 * Multi-round loop — model reasons about gaps and drives its own searches
 * via server-side tools (web_search / google_search). No Jina fetch required.
 */
import { extractJson } from "../ai.js";
import {
  chatWithNativeWebSearch,
  modelSupportsNativeSearch,
  detectNativeSearchTool
} from "./native-search.js";
import {
  preferredReasoningEffort,
  reasoningEffortCascade,
  isThinkingConfigError
} from "./reasoning.js";

/**
 * Run multi-round agentic web research.
 *
 * Round 1..n-1: gather findings + list gaps (JSON intermediate).
 * Final round: force full answer JSON (schema provided in system).
 *
 * @returns {{
 *   content: string|object,
 *   citations: object[],
 *   toolTraces: object[],
 *   rounds: number,
 *   mode: string,
 *   searchLog: object[],
 *   error?: string
 * }}
 */
export async function runAgenticNativeLoop({
  model,
  system,
  user,
  signal = null,
  onLog = null,
  maxRounds = 3,
  unrestrictedWeb = true,
  temperature = 0.35,
  reasoningEffort = "auto",
  intermediateHint = null,
  finalSchemaHint = null
}) {
  if (!modelSupportsNativeSearch(model)) {
    return {
      content: "",
      citations: [],
      toolTraces: [],
      rounds: 0,
      mode: "NATIVE_UNSUPPORTED",
      searchLog: [],
      error: "model_no_native_web"
    };
  }

  const toolKind = detectNativeSearchTool(model).kind;
  const effort0 = preferredReasoningEffort(model, reasoningEffort);
  const effortTry = reasoningEffortCascade(effort0 || "medium");

  const allCitations = [];
  const allTraces = [];
  const searchLog = [];
  let transcript = "";
  let lastContent = "";
  let lastMode = "NATIVE_FAILED";
  let usedEffort = effort0;

  const gatherSystem =
    system +
    `

AGENTIC WEB (wajib):
- Kamu PUNYA web search tools. Pakai berkali-kali. Jangan mengarang berita.
- REASON dulu dari data harga/context hard (yang diberi user): apa yang aneh? volume? struktur? vs IHSG?
- Dari situ TENTUKAN query sendiri (dinamis). Jangan hanya copy daftar generik.
- Ikuti jarum: aksi korporasi, right issue, buyback, denda, litigasi, resign, related party, free float, proyek, kontrak.
- Bedakan official / media / rumor.
- Tiap putaran boleh search lagi untuk menutup gap.`;

  for (let round = 1; round <= maxRounds; round++) {
    const isFinal = round === maxRounds;
    onLog?.(
      `Agentic r${round}/${maxRounds} · tools=${toolKind} · reason=${usedEffort || "off"}`
    );

    let roundUser;
    if (round === 1) {
      roundUser =
        user +
        "\n\n" +
        (isFinal
          ? "Ini putaran final. Search seperlunya lalu keluarkan JSON final sesuai schema."
          : intermediateHint ||
            `Putaran ${round}: rencanakan search, jalankan tools, kumpulkan fakta.
Return JSON saja:
{
  "status": "continue|done",
  "reasoning_brief": "mengapa query ini (dari data hard)",
  "queries_used": ["..."],
  "findings": [{"claim":"","sourceTier":"media|official|rumor|unknown","url":"","query":""}],
  "gaps": ["apa yang masih kosong"],
  "next_queries": ["query lanjutan jika continue"]
}
Jika sudah cukup untuk laporan lengkap, status=done dan findings lengkap.`);
    } else {
      roundUser =
        `Putaran sebelumnya (ringkas):\n${transcript.slice(0, 12000)}\n\n` +
        (isFinal
          ? `FINAL: tutup gap di atas. Search lagi bila perlu. Output JSON FINAL sesuai schema.\n` +
            (finalSchemaHint || "")
          : `Lanjutkan riset. Utamakan gap/next_queries. Search dinamis lagi.
Return JSON intermediate yang sama (status/findings/gaps/next_queries).`);
    }

    if (isFinal && finalSchemaHint) {
      roundUser +=
        "\n\nWAJIB output JSON final (schema di system). Jangan intermediate status/continue.";
    }

    let result = null;
    let lastErr = null;
    for (const effort of effortTry) {
      usedEffort = effort;
      result = await chatWithNativeWebSearch({
        model,
        system: isFinal
          ? gatherSystem +
            "\n\nFINAL ROUND: output HANYA JSON laporan final. Schema di bawah/system. Jangan prose."
          : gatherSystem,
        user: roundUser,
        signal,
        temperature: isFinal ? 0.3 : temperature,
        isJson: true,
        unrestrictedWeb,
        reasoningEffort: effort
      });
      if (result.mode !== "NATIVE_FAILED") break;
      lastErr = result.error;
      if (lastErr && isThinkingConfigError(lastErr) && effort) {
        onLog?.(`Reasoning ${effort} ditolak — coba level lebih rendah`, "warn");
        continue;
      }
      // non-thinking failure: don't cascade forever
      if (!isThinkingConfigError(lastErr)) break;
    }

    if (!result || result.mode === "NATIVE_FAILED") {
      searchLog.push({ round, ok: false, error: lastErr || result?.error });
      if (round === 1) {
        return {
          content: "",
          citations: allCitations,
          toolTraces: allTraces,
          rounds: round,
          mode: "NATIVE_FAILED",
          searchLog,
          error: lastErr || result?.error || "native_failed"
        };
      }
      // use what we have; break to finalize offline if needed
      break;
    }

    lastMode = result.mode;
    lastContent = result.content;
    for (const c of result.citations || []) allCitations.push(c);
    for (const t of result.toolTraces || []) allTraces.push(t);

    let parsed = null;
    try {
      parsed =
        typeof result.content === "string"
          ? JSON.parse(extractJson(result.content))
          : result.content;
    } catch {
      parsed = null;
    }

    searchLog.push({
      round,
      ok: true,
      mode: result.mode,
      status: parsed?.status,
      findings: Array.isArray(parsed?.findings) ? parsed.findings.length : null,
      gaps: parsed?.gaps || null,
      queries: parsed?.queries_used || parsed?.next_queries || null
    });

    // grow transcript for next rounds
    const piece =
      typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content);
    transcript += `\n--- round ${round} ---\n${piece.slice(0, 8000)}\n`;

    onLog?.(
      `Agentic r${round} ok mode=${result.mode} findings=${
        parsed?.findings?.length ?? "—"
      } gaps=${(parsed?.gaps || []).length}`
    );

    // Early stop if intermediate says done and we still have rounds for final?
    // If status=done and not final, jump to final synthesis next iteration with isFinal force
    if (!isFinal && parsed?.status === "done" && (parsed.findings || []).length >= 3) {
      // compress remaining: next loop will be final if we set round = maxRounds-1
      // simpler: one more forced final round
      if (round < maxRounds) {
        // craft final immediately
        onLog?.("Gaps tertutup — final JSON…");
        const finalUser =
          `Temuan terakumulasi:\n${transcript.slice(0, 14000)}\n\n` +
          `Tulis JSON FINAL lengkap. Jangan status continue.\n` +
          (finalSchemaHint || "");
        let finalRes = null;
        for (const effort of effortTry) {
          finalRes = await chatWithNativeWebSearch({
            model,
            system:
              gatherSystem +
              "\n\nFINAL: JSON laporan saja. Boleh search sekali lagi jika ada hole kritis.",
            user: finalUser,
            signal,
            temperature: 0.3,
            isJson: true,
            unrestrictedWeb,
            reasoningEffort: effort
          });
          if (finalRes.mode !== "NATIVE_FAILED") break;
          if (!isThinkingConfigError(finalRes.error)) break;
        }
        if (finalRes && finalRes.mode !== "NATIVE_FAILED" && finalRes.content) {
          for (const c of finalRes.citations || []) allCitations.push(c);
          for (const t of finalRes.toolTraces || []) allTraces.push(t);
          lastContent = finalRes.content;
          lastMode = finalRes.mode + "+early_final";
          searchLog.push({ round: round + 0.5, ok: true, mode: finalRes.mode, final: true });
        }
        break;
      }
    }
  }

  // dedupe citations
  const seen = new Set();
  const citations = allCitations.filter((c) => {
    const k = c.url || c.title;
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    content: lastContent,
    citations,
    toolTraces: allTraces,
    rounds: searchLog.length,
    mode: lastMode,
    searchLog,
    reasoningEffort: usedEffort
  };
}
