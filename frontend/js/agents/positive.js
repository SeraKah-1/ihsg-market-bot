import { chatJson, modelFor } from "../ai.js";
import { positiveSystem } from "./constitution.js";

export async function runPositive({ shortlistPack, research, signal, onLog }) {
  const model = modelFor("positive");
  onLog?.(`PositiveAgent model=${model}`);
  const schema = `{
  "summary": "",
  "points": [{"ticker":"", "moneyMove":"", "fuelLeft":"fear_outside|already_crowded|unknown", "fomoThesis":"", "flowAlive":true}],
  "marketFuel": []
}`;
  try {
    return await chatJson({
      model,
      system: positiveSystem() + "\nSchema:\n" + schema,
      user: JSON.stringify({ shortlist: shortlistPack.shortlist, research, ihsg: shortlistPack.ihsg }, null, 2),
      signal
    });
  } catch (e) {
    onLog?.("PositiveAgent gagal: " + e.message, "err");
    return {
      summary: "PositiveAgent error — heuristic code",
      points: (shortlistPack.shortlist || []).map((s) => ({
        ticker: s.ticker,
        moneyMove: s.metrics?.changePct > 0 ? "price up" : "price down",
        fuelLeft: s.flowHints?.fuelGuess || "unknown",
        fomoThesis: s.flowHints?.flowAlive ? "rvol/flow masih hidup" : "",
        flowAlive: !!s.flowHints?.flowAlive
      })),
      marketFuel: [],
      error: String(e.message || e)
    };
  }
}
