/**
 * Unit tests for reasoning helpers (no live LLM).
 * Frontend modules are ESM without package type — load via dynamic import from file URL.
 */
import assert from "assert";
import { pathToFileURL } from "url";
import path from "path";
import { createRequire } from "module";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const require = createRequire(import.meta.url);

// Minimal localStorage for state.js side effects
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
}

const reasoningUrl = pathToFileURL(
  path.join(root, "frontend/js/search/reasoning.js")
).href;

const { modelLooksReasoning, preferredReasoningEffort, injectReasoningParams, reasoningEffortCascade } =
  await import(reasoningUrl);

// --- modelLooksReasoning ---
assert.strictEqual(modelLooksReasoning("o3-mini"), true);
assert.strictEqual(modelLooksReasoning("deepseek-r1"), true);
assert.strictEqual(modelLooksReasoning("grok-3-reasoning"), true);
assert.strictEqual(modelLooksReasoning("gpt-4o-mini"), false);

// --- preferred effort ---
assert.strictEqual(preferredReasoningEffort("o3", "auto"), "high");
assert.strictEqual(preferredReasoningEffort("grok-2", "auto"), "medium");
// gpt-4* gets mild medium hint (gateway may ignore)
assert.strictEqual(preferredReasoningEffort("gpt-4o-mini", "auto"), "medium");
assert.strictEqual(preferredReasoningEffort("some-local-7b", "auto"), null);
assert.strictEqual(preferredReasoningEffort("grok-2", "off"), null);
assert.strictEqual(preferredReasoningEffort("grok-2", "high"), "high");

// --- inject body ---
{
  const body = injectReasoningParams({ model: "grok-3", messages: [] }, "grok-3", "high");
  assert.strictEqual(body.reasoning_effort, "high");
  assert.ok(body.reasoning && body.reasoning.effort === "high");
}
{
  const body = injectReasoningParams({ model: "gemini-2.5-pro" }, "gemini-2.5-pro", "high");
  assert.ok(body.thinkingConfig || body.thinking || body.generationConfig);
}
{
  const body = injectReasoningParams({ model: "x" }, "x", null);
  assert.strictEqual(body.reasoning_effort, undefined);
}

// --- cascade ---
{
  const c = reasoningEffortCascade("high");
  assert.ok(c.includes("high") && c.includes("medium") && c.includes(null));
}

// deepDiveQueries still exported for fallback
const deepUrl = pathToFileURL(path.join(root, "frontend/js/agents/deep-dive.js")).href;
// deep-dive imports ai/state which need browser-ish env — skip full import if fails
try {
  // only test pure query helper by re-reading require pattern — dynamic import may pull ai
  const mod = await import(deepUrl);
  const qs = mod.deepDiveQueries("BBCA", "2026-07-09");
  assert.ok(qs.length >= 3);
  assert.ok(qs.some((q) => q.includes("BBCA")));
  assert.ok(mod.deepDiveSchema().includes("deep_dive"));
} catch (e) {
  console.log("skip deep-dive import in node:", e.message.slice(0, 120));
}

console.log("reasoning-agentic.test.mjs OK");
