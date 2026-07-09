import assert from "assert";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { parseTicker, normalizeTicker } = require("../lib/ticker-util.js");

assert.strictEqual(parseTicker("BBCA").ticker, "BBCA");
assert.strictEqual(parseTicker("bbca.jk").ticker, "BBCA");
assert.strictEqual(parseTicker(" IDX:BBCA ").ticker, "BBCA");
assert.strictEqual(parseTicker("BBCA Bank").ticker, "BBCA");
assert.ok(!parseTicker("").ok);
assert.ok(!parseTicker("!!!").ok);
assert.strictEqual(normalizeTicker("adro.jk"), "ADRO");
console.log("ticker-util.test.mjs OK");
