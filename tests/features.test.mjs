import assert from "assert";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { buildSeriesContext, classifyRegime, slopeDegrees, structureLabel } = require("../lib/features.js");

// synthetic uptrend
const bars = [];
for (let i = 0; i < 60; i++) {
  const c = 100 + i * 0.5 + (i % 3);
  bars.push({ t: i, o: c - 0.2, h: c + 0.5, l: c - 0.5, c, v: 1000 + i * 10 });
}
const ctx = buildSeriesContext(bars, { includeYear: true });
assert.strictEqual(ctx.ok, true);
assert.ok(ctx.d1.retPct != null);
assert.ok(ctx.w1.slopeDeg != null);
assert.ok(ctx.m1.structure);
assert.ok(ctx.summary.includes("1d"));
assert.ok(ctx.vol.realizedVol20dAnnPct != null);

const upCloses = bars.map((b) => b.c);
const slope = slopeDegrees(upCloses, 21);
assert.ok(slope > 0, "uptrend slope should be positive");

const reg = classifyRegime(ctx);
assert.ok(reg.tag);
assert.ok(reg.ihsgSummary);

console.log("features.test.mjs OK", { slope, structure: ctx.m1.structure, regime: reg.tag });
