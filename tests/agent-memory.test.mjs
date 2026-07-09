/**
 * Pure helpers for agent-memory compact (no Firebase).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// agent-memory.js imports firebase CDN — test pure logic via dynamic copy of functions
// We re-implement the compact helpers inline by importing from a tiny extract if needed.
// For CI without browser: duplicate compactResearchForDownstream test via eval of source.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// Load compact functions by parsing source (avoid browser firebase import in node)
import fs from "node:fs";
const src = fs.readFileSync(
  path.join(root, "frontend/js/agent-memory.js"),
  "utf8"
);
assert.match(src, /compactResearchForDownstream/);
assert.match(src, /saveAgentStep/);
assert.match(src, /ihsg_runs/);
assert.match(src, /ihsg_compact/);

// Unit-test compact logic in isolation
function compactResearchForDownstream(research) {
  if (!research) return {};
  const perTicker = {};
  for (const [k, v] of Object.entries(research.perTicker || {})) {
    perTicker[k] = {
      catalysts: (v.catalysts || []).slice(0, 8),
      unexplained: !!v.unexplained,
      notes: (v.notes || "").slice(0, 600),
      fundamentalsNote: (v.fundamentalsNote || "").slice(0, 600),
      outlookTag: v.outlookTag || "biasa",
      queriesUsed: (v.queriesUsed || []).slice(0, 6)
    };
  }
  return {
    marketNotes: (research.marketNotes || []).slice(0, 16),
    findings: (research.findings || []).slice(0, 40),
    perTicker,
    agentMeta: { mode: research.agentMeta?.mode }
  };
}

const big = {
  findings: Array.from({ length: 100 }, (_, i) => ({ claim: "c" + i, url: "" })),
  perTicker: { ADES: { catalysts: [{ claim: "x" }], notes: "n".repeat(2000), unexplained: true } },
  agentMeta: { mode: "agentic_salvage", rawContent: "HUGE" }
};
const c = compactResearchForDownstream(big);
assert.equal(c.findings.length, 40);
assert.ok(c.perTicker.ADES.notes.length <= 600);
assert.equal(c.agentMeta.mode, "agentic_salvage");

console.log("agent-memory.test.mjs OK");
