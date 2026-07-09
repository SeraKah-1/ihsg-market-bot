import assert from "assert";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { buildShortlist } = require("../lib/market-api.js");

const fake = {
  day: "2026-07-09",
  coveragePct: 80,
  sources: ["test"],
  fetchedOk: 5,
  universeSize: 5,
  fromCache: true,
  ihsg: { close: 7000, changePct: 0.5 },
  globals: [],
  stocks: [
    { ok: true, ticker: "AAAA", symbol: "AAAA.JK", changePct: 12, rvol: 4, zRet: 2.5, volume: 1e6, close: 100, rangePct: 5, avgVol20: 2e5 },
    { ok: true, ticker: "BBBB", symbol: "BBBB.JK", changePct: -8, rvol: 3, zRet: -2, volume: 5e5, close: 50, rangePct: 4, avgVol20: 1e5 },
    { ok: true, ticker: "CCCC", symbol: "CCCC.JK", changePct: 3, rvol: 6, zRet: 1, volume: 2e6, close: 200, rangePct: 3, avgVol20: 3e5 },
    { ok: true, ticker: "DDDD", symbol: "DDDD.JK", changePct: 1, rvol: 1, zRet: 0.2, volume: 1e5, close: 10, rangePct: 1, avgVol20: 1e5 },
    { ok: true, ticker: "EEEE", symbol: "EEEE.JK", changePct: 22, rvol: 8, zRet: 3, volume: 9e6, close: 300, rangePct: 12, avgVol20: 1e6 }
  ]
};

const sl = buildShortlist(fake, 4);
assert.ok(sl.shortlist.length <= 4);
assert.ok(sl.shortlist.length >= 1);
assert.ok(sl.breadth.total === 5);
// EEEE should rank high and high exit liq hint
const e = sl.shortlist.find((x) => x.ticker === "EEEE");
assert.ok(e, "EEEE in shortlist");
assert.strictEqual(e.flowHints.exitLiquidityHint, "high");

console.log("shortlist.test.mjs OK");
