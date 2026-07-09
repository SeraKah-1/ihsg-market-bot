/**
 * Hard stance gates (code-enforced, unit-testable).
 * - No AI loss-aversion as default
 * - Follow money / FOMO OK when flow alive
 * - Hard block aggression when exit liquidity high
 */

export function applyStanceRules(item) {
  const stance = { ...(item.stance || {}) };
  const hints = item.flowHints || item.followMoney || {};
  let exitLiquidityRisk = stance.exitLiquidityRisk || hints.exitLiquidityHint || "low";
  if (!["low", "med", "high"].includes(exitLiquidityRisk)) exitLiquidityRisk = "low";

  let flowAlive =
    typeof stance.flowAlive === "boolean"
      ? stance.flowAlive
      : typeof hints.flowAlive === "boolean"
        ? hints.flowAlive
        : false;

  const fuelLeft = stance.fuelLeft || hints.fuelGuess || hints.fuelLeft || "unknown";

  let aggressionAllowed = stance.aggressionAllowed;
  let judgePriority = stance.judgePriority || "mixed";

  if (exitLiquidityRisk === "high") {
    aggressionAllowed = false;
    judgePriority = "avoid_exit_liq";
  } else if (flowAlive && fuelLeft !== "already_crowded") {
    if (aggressionAllowed === undefined || aggressionAllowed === null) aggressionAllowed = true;
    judgePriority = judgePriority === "avoid_exit_liq" ? "mixed" : "follow_money";
  } else if (aggressionAllowed === undefined || aggressionAllowed === null) {
    aggressionAllowed = false;
  }

  // invariant: high exit-liq never aggressive
  if (exitLiquidityRisk === "high") aggressionAllowed = false;

  return {
    ...item,
    stance: {
      ...stance,
      exitLiquidityRisk,
      flowAlive,
      fuelLeft,
      aggressionAllowed: !!aggressionAllowed,
      judgePriority,
      fomoThesis: stance.fomoThesis || "",
      invalidation: stance.invalidation || "",
      timeHorizon: stance.timeHorizon || "1-5d"
    }
  };
}

export function applyStanceToBriefing(briefing) {
  if (!briefing) return briefing;
  const shortlist = (briefing.shortlist || []).map(applyStanceRules);
  const sentiment = { ...(briefing.sentiment || {}) };

  const anyHigh = shortlist.some((s) => s.stance?.exitLiquidityRisk === "high");
  const anyAgg = shortlist.some((s) => s.stance?.aggressionAllowed);

  if (anyHigh && sentiment.judgeLean === "positive" && !anyAgg) {
    // keep lean but force priority
    sentiment.judgePriority = "avoid_exit_liq";
  }
  if (!sentiment.judgePriority) {
    sentiment.judgePriority = anyHigh ? "avoid_exit_liq" : anyAgg ? "follow_money" : "mixed";
  }
  if (sentiment.confidenceLabel == null) sentiment.confidenceLabel = "uncalibrated";

  return { ...briefing, shortlist, sentiment };
}
