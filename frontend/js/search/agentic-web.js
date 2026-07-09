/**
 * Agentic native web research — multi-round Responses API web_search.
 * Reasoning cascade + temperature per round.
 */
import { extractJson, DEFAULT_TEMP } from "../ai.js";
import { chatWithNativeWebSearch, modelSupportsNativeSearch, detectNativeSearchTool } from "./native-search.js";

/**
 * @returns {{
 *   content: string|object,
 *   citations: object[],
 *   toolTraces: object[],
 *   rounds: number,
 *   mode: string,
 *   searchLog: object[],
 *   reasoningEffort?: string|null,
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
  temperature = DEFAULT_TEMP,
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
      mode: "NATIVE_FAILED",
      searchLog: [],
      error: "no_model"
    };
  }

  const toolHint = detectNativeSearchTool(model).kind;
  const allCitations = [];
  const allTraces = [];
  const searchLog = [];
  let transcript = "";
  let lastContent = "";
  let lastMode = "NATIVE_FAILED";
  let usedEffort = null;
  const temp = temperature == null ? DEFAULT_TEMP : temperature;

  const gatherSystem =
    system +
    `

AGENTIC WEB:
- Pakai web_search. Reason dulu dari data hard → tentukan query sendiri.
- Dinamis: aksi korporasi, right issue, buyback, denda, proyek, free float, lapkeu.
- Official / media / rumor. Jangan mengarang angka.`;

  for (let round = 1; round <= maxRounds; round++) {
    const isFinal = round === maxRounds;
    onLog?.(
      `Agentic r${round}/${maxRounds} · tools≈${toolHint} · reason=cascade · temp=${temp}`
    );

    let roundUser;
    if (round === 1) {
      roundUser =
        user +
        "\n\n" +
        (isFinal
          ? "Putaran final. Search seperlunya lalu JSON final sesuai schema."
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
Jika sudah cukup, status=done.`);
    } else {
      roundUser =
        `Putaran sebelumnya (ringkas):\n${transcript.slice(0, 12000)}\n\n` +
        (isFinal
          ? `FINAL: tutup gap. Search lagi bila perlu. Output JSON FINAL.\n` +
            (finalSchemaHint || "")
          : `Lanjutkan. Utamakan gap/next_queries. JSON intermediate sama.`);
    }

    if (isFinal && finalSchemaHint) {
      roundUser +=
        "\n\nWAJIB output JSON final (schema). Jangan intermediate status/continue.";
    }

    const result = await chatWithNativeWebSearch({
      model,
      system: isFinal
        ? gatherSystem +
          "\n\nFINAL ROUND: output HANYA JSON laporan final. Schema di system."
        : gatherSystem,
      user: roundUser,
      signal,
      isJson: true,
      unrestrictedWeb,
      temperature: temp,
      reasoningEffort,
      onLog
    });

    usedEffort = result.reasoningEffort || null;

    if (result.mode === "NATIVE_FAILED" || !result.content) {
      searchLog.push({
        round,
        ok: false,
        error: result.error,
        cascadeAttempts: result.cascadeAttempts
      });
      if (round === 1) {
        return {
          content: "",
          citations: allCitations,
          toolTraces: allTraces,
          rounds: round,
          mode: "NATIVE_FAILED",
          searchLog,
          error: result.error || "native_failed",
          reasoningEffort: usedEffort
        };
      }
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
      reasoningEffort: result.reasoningEffort,
      toolKind: result.toolKind,
      status: parsed?.status,
      findings: Array.isArray(parsed?.findings) ? parsed.findings.length : null,
      gaps: parsed?.gaps || null,
      queries: parsed?.queries_used || parsed?.next_queries || null
    });

    const piece =
      typeof result.content === "string"
        ? result.content
        : JSON.stringify(result.content);
    transcript += `\n--- round ${round} ---\n${piece.slice(0, 8000)}\n`;

    onLog?.(
      `Agentic r${round} ok mode=${result.mode} tools=${result.toolKind || "?"} reason=${
        result.reasoningEffort || "off"
      } findings=${parsed?.findings?.length ?? "—"}`
    );

    if (!isFinal && parsed?.status === "done" && (parsed.findings || []).length >= 3) {
      onLog?.("Gaps tertutup — final JSON…");
      const finalUser =
        `Temuan terakumulasi:\n${transcript.slice(0, 14000)}\n\n` +
        `Tulis JSON FINAL lengkap.\n` +
        (finalSchemaHint || "");
      const finalRes = await chatWithNativeWebSearch({
        model,
        system:
          gatherSystem +
          "\n\nFINAL: JSON laporan saja. Boleh search sekali lagi jika hole kritis.",
        user: finalUser,
        signal,
        isJson: true,
        unrestrictedWeb,
        temperature: temp,
        reasoningEffort,
        onLog
      });
      if (finalRes.mode !== "NATIVE_FAILED" && finalRes.content) {
        for (const c of finalRes.citations || []) allCitations.push(c);
        for (const t of finalRes.toolTraces || []) allTraces.push(t);
        lastContent = finalRes.content;
        lastMode = finalRes.mode + "+early_final";
        usedEffort = finalRes.reasoningEffort || usedEffort;
        searchLog.push({
          round: round + 0.5,
          ok: true,
          mode: finalRes.mode,
          final: true,
          reasoningEffort: finalRes.reasoningEffort
        });
      }
      break;
    }
  }

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
