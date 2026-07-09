import assert from "assert";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dynamic import ESM
const { applyStanceRules, applyStanceToBriefing } = await import(
  pathToFileURL(path.join(__dirname, "../frontend/js/agents/stance-rules.js")).href
);

// high exit-liq → never aggressive
{
  const out = applyStanceRules({
    ticker: "TEST",
    flowHints: { flowAlive: true, exitLiquidityHint: "high", fuelGuess: "fear_outside" },
    stance: { aggressionAllowed: true, exitLiquidityRisk: "high" }
  });
  assert.strictEqual(out.stance.aggressionAllowed, false);
  assert.strictEqual(out.stance.judgePriority, "avoid_exit_liq");
}

// flow alive + not crowded → aggression default true
{
  const out = applyStanceRules({
    ticker: "FLOW",
    flowHints: { flowAlive: true, exitLiquidityHint: "low", fuelGuess: "fear_outside" },
    stance: {}
  });
  assert.strictEqual(out.stance.aggressionAllowed, true);
  assert.strictEqual(out.stance.judgePriority, "follow_money");
}

// briefing patch
{
  const b = applyStanceToBriefing({
    shortlist: [
      {
        ticker: "X",
        stance: { exitLiquidityRisk: "high", aggressionAllowed: true },
        flowHints: { flowAlive: true, exitLiquidityHint: "high" }
      }
    ],
    sentiment: { judgeLean: "positive" }
  });
  assert.strictEqual(b.shortlist[0].stance.aggressionAllowed, false);
  assert.strictEqual(b.sentiment.confidenceLabel, "uncalibrated");
}

console.log("stance-rules.test.mjs OK");
