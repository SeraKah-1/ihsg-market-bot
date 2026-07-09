import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "../fixtures/sample-briefing.json");
const b = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

assert.strictEqual(b.schemaVersion, 1);
assert.ok(b.runId);
assert.ok(Array.isArray(b.shortlist));
assert.ok(["fear", "neutral", "positive"].includes(b.sentiment.judgeLean));
assert.strictEqual(b.sentiment.confidenceLabel, "uncalibrated");
for (const s of b.shortlist) {
  assert.ok(s.metrics);
  assert.ok(s.stance);
  assert.ok(["low", "med", "high"].includes(s.stance.exitLiquidityRisk));
  if (s.stance.exitLiquidityRisk === "high") {
    assert.strictEqual(s.stance.aggressionAllowed, false);
  }
}

console.log("schema.test.mjs OK");
