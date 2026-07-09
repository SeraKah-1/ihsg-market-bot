import { chatJson, modelFor } from "../ai.js";
import { fearSystem } from "./constitution.js";

export async function runFear({ shortlistPack, research, signal, onLog }) {
  const model = modelFor("fear");
  onLog?.(`FearAgent model=${model}`);
  const schema = `{
  "summary": "",
  "points": [{"ticker":"", "trap":"", "severity":"", "exitLiquidityRisk":"low|med|high"}],
  "marketTraps": []
}`;
  try {
    return await chatJson({
      model,
      system: fearSystem() + "\nSchema:\n" + schema,
      user: JSON.stringify({ shortlist: shortlistPack.shortlist, research, ihsg: shortlistPack.ihsg }, null, 2),
      signal
    });
  } catch (e) {
    onLog?.("FearAgent gagal: " + e.message, "err");
    return {
      summary: "FearAgent error — pakai heuristic code saja",
      points: (shortlistPack.shortlist || []).map((s) => ({
        ticker: s.ticker,
        trap: s.flowHints?.exitLiquidityHint === "high" ? "spike ekstrem / possible late entry" : "",
        severity: s.flowHints?.exitLiquidityHint || "low",
        exitLiquidityRisk: s.flowHints?.exitLiquidityHint || "low"
      })),
      marketTraps: [],
      error: String(e.message || e)
    };
  }
}
