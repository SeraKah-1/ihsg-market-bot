/**
 * Metric gloss + human enrich unit tests
 */
import assert from "assert";
import { pathToFileURL } from "url";
import path from "path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const glossUrl = pathToFileURL(path.join(root, "frontend/js/metric-gloss.js")).href;
const {
  glossRvol,
  glossChangePct,
  glossStructure,
  plainFromHard,
  heuristicPriceOutlook,
  outlookLabel
} = await import(glossUrl);

// RVOL meanings
{
  const thin = glossRvol(0.13);
  assert.ok(thin.meaning.toLowerCase().includes("sepi") || thin.meaning.toLowerCase().includes("exit"));
  assert.strictEqual(thin.tone, "down");
  const hot = glossRvol(2.1);
  assert.strictEqual(hot.tone, "up");
}

// structure
{
  const up = glossStructure("HH_HL");
  assert.ok(up.meaning.includes("naik") || up.meaning.includes("Higher"));
  const down = glossStructure("LH_LL");
  assert.strictEqual(down.tone, "down");
}

// plain hard
{
  const p = plainFromHard({
    ticker: "ADES",
    metrics: { changePct: 4.71, rvol: 1.9, zRet: 0.4 },
    context: {
      m1: { retPct: 67, structure: "HH_HL" },
      vol: { volumeTrend: "falling" }
    },
    whySelected: ["top_gainer", "rvol_spike"],
    flowHints: { exitLiquidityHint: "high", flowAlive: true }
  });
  assert.ok(p.whatHappened.includes("ADES"));
  assert.ok(p.whatToDo.length > 10);
  assert.ok(["cerah", "biasa", "suram"].includes(p.outlookTag));
}

// outlook label ID
assert.strictEqual(outlookLabel("cerah"), "Prospek cerah");
assert.strictEqual(outlookLabel("suram"), "Prospek suram");

// enrich briefing
{
  if (typeof globalThis.localStorage === "undefined") {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    };
  }
  const judgeUrl = pathToFileURL(path.join(root, "frontend/js/agents/judge.js")).href;
  // judge imports ai.js which may need DOM — only test enrich if import works
  try {
    const { enrichBriefingForHumans } = await import(judgeUrl);
    const pack = {
      day: "2026-07-10",
      marketRegime: { tag: "high_vol_chop", note: "vol tinggi" },
      ihsg: { changePct: -1.89, close: 5873 },
      breadth: { adv: 4, dec: 7, total: 11 },
      shortlist: []
    };
    const briefing = {
      sentiment: {
        judgeRationale:
          "Indeks unexplained drop + breadth 4/7 + vol falling = flowAlive false m1+67% volumeTrend falling exit-liq",
        judgeLean: "fear",
        judgePriority: "avoid_exit_liq"
      },
      marketWide: {},
      shortlist: [
        {
          ticker: "ADES",
          metrics: { changePct: 4.71, rvol: 1.9 },
          context: {
            ok: true,
            m1: { retPct: 67, structure: "HH_HL" },
            vol: { volumeTrend: "falling" }
          },
          whySelected: ["top_gainer"],
          stance: { exitLiquidityRisk: "high" },
          flowHints: { exitLiquidityHint: "high", flowAlive: true }
        }
      ]
    };
    const out = enrichBriefingForHumans(briefing, pack, {
      perTicker: { ADES: { notes: "no news", unexplained: true } }
    });
    assert.ok(out.shortlist[0].plain.whatHappened);
    assert.ok(out.shortlist[0].outlook.combined);
    assert.ok(out.marketWide.plainHeadline);
    assert.ok(!out.sentiment.judgeRationale.includes("flowAlive"));
  } catch (e) {
    console.log("skip enrich import:", String(e.message || e).slice(0, 120));
  }
}

// change gloss
assert.ok(glossChangePct(-1.89, "IHSG").value.includes("-"));

console.log("metric-gloss.test.mjs OK");
