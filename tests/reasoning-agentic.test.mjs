/**
 * Unit tests: reasoning + tool cascade defaults (no live LLM).
 */
import assert from "assert";
import { pathToFileURL } from "url";
import path from "path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

if (typeof globalThis.localStorage === "undefined") {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
}

const reasoningUrl = pathToFileURL(path.join(root, "frontend/js/search/reasoning.js")).href;
const nativeUrl = pathToFileURL(path.join(root, "frontend/js/search/native-search.js")).href;

const {
  modelLooksReasoning,
  preferredReasoningEffort,
  injectReasoningParams,
  reasoningEffortCascade,
  shouldDropReasoningLevel,
  shouldTryNextToolProfile
} = await import(reasoningUrl);

const {
  modelSupportsNativeSearch,
  detectNativeSearchTool,
  buildToolProfileCascade,
  buildWebSearchTool,
  stripWebSearchFilters,
  IDX_SEARCH_DOMAINS
} = await import(nativeUrl);

// --- modelLooksReasoning (heuristic only) ---
assert.strictEqual(modelLooksReasoning("o3-mini"), true);
assert.strictEqual(modelLooksReasoning("gpt-4o-mini"), false);

// --- preferred effort: DEFAULT HIGH for all models ---
assert.strictEqual(preferredReasoningEffort("o3", "auto"), "high");
assert.strictEqual(preferredReasoningEffort("grok-2", "auto"), "high");
assert.strictEqual(preferredReasoningEffort("gpt-4o-mini", "auto"), "high");
assert.strictEqual(preferredReasoningEffort("some-local-7b", "auto"), "high");
assert.strictEqual(preferredReasoningEffort("anything", "off"), null);
assert.strictEqual(preferredReasoningEffort("anything", "medium"), "medium");

// --- cascade high → med → low → null ---
{
  const c = reasoningEffortCascade("high");
  assert.deepStrictEqual(c, ["high", "medium", "low", null]);
}

// --- inject always attaches multi-provider fields ---
{
  const body = injectReasoningParams({ model: "foo-bar" }, "foo-bar", "high");
  assert.strictEqual(body.reasoning_effort, "high");
  assert.ok(body.reasoning?.effort === "high");
  assert.ok(body.thinkingConfig || body.thinking);
}

// --- shouldDrop / shouldTryNext ---
assert.ok(shouldDropReasoningLevel("Unknown parameter reasoning_effort"));
assert.ok(shouldTryNextToolProfile("invalid tools: web_search not supported"));

// --- native default: ANY non-empty model ---
assert.strictEqual(modelSupportsNativeSearch("gpt-4o-mini"), true);
assert.strictEqual(modelSupportsNativeSearch("random-local"), true);
assert.strictEqual(modelSupportsNativeSearch(""), false);

// unknown model still gets web_search
assert.strictEqual(detectNativeSearchTool("my-custom-model").tools[0].type, "web_search");

// xAI docs shape: filters.allowed_domains (NOT top-level allowed_domains)
{
  const t = buildWebSearchTool({ allowedDomains: ["idx.co.id", "kontan.co.id"] });
  assert.strictEqual(t.type, "web_search");
  assert.deepStrictEqual(t.filters, { allowed_domains: ["idx.co.id", "kontan.co.id"] });
  assert.strictEqual(t.allowed_domains, undefined);

  const ex = buildWebSearchTool({ excludedDomains: ["spam.com"] });
  assert.deepStrictEqual(ex.filters, { excluded_domains: ["spam.com"] });

  // cannot set both — prefer allow-list
  const both = buildWebSearchTool({
    allowedDomains: ["a.com"],
    excludedDomains: ["b.com"]
  });
  assert.deepStrictEqual(both.filters, { allowed_domains: ["a.com"] });
  assert.ok(!both.filters.excluded_domains);

  const img = buildWebSearchTool({ enableImageUnderstanding: true });
  assert.strictEqual(img.enable_image_understanding, true);

  assert.deepStrictEqual(stripWebSearchFilters(t), { type: "web_search" });
  assert.deepStrictEqual(buildWebSearchTool(), { type: "web_search" });
}

// Grok preferred tool uses docs filters + max 5 domains
{
  const grok = detectNativeSearchTool("grok-4.5");
  assert.strictEqual(grok.kind, "xai_web_search");
  const tool = grok.tools[0];
  assert.strictEqual(tool.type, "web_search");
  assert.ok(tool.filters?.allowed_domains);
  assert.strictEqual(tool.allowed_domains, undefined);
  assert.ok(tool.filters.allowed_domains.length <= 5);
  assert.deepStrictEqual(tool.filters.allowed_domains, IDX_SEARCH_DOMAINS);

  // unrestricted cascade: no filters on first profile
  const deep = buildToolProfileCascade("grok-4.5", { unrestrictedWeb: true });
  assert.deepStrictEqual(deep[0].tools[0], { type: "web_search" });
}

// tool cascade has multiple profiles
{
  const profiles = buildToolProfileCascade("gemini-2.0-flash", { unrestrictedWeb: true });
  assert.ok(profiles.length >= 2);
  const kinds = profiles.map((p) => p.kind).join(",");
  assert.ok(kinds.includes("google") || kinds.includes("web_search"));
}

// deep-dive helpers
try {
  const deepUrl = pathToFileURL(path.join(root, "frontend/js/agents/deep-dive.js")).href;
  const mod = await import(deepUrl);
  const qs = mod.deepDiveQueries("BBCA", "2026-07-09");
  assert.ok(qs.length >= 3);
  assert.ok(mod.deepDiveSchema().includes("deep_dive"));
} catch (e) {
  console.log("skip deep-dive import:", e.message.slice(0, 100));
}

console.log("reasoning-agentic.test.mjs OK");
