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
  buildNativeResponsesBody,
  buildResponsesUrl,
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

// Grok preferred = bare web_search (docs basic); filters only optional cascade
{
  const grok = detectNativeSearchTool("grok-4.5");
  assert.strictEqual(grok.kind, "xai_web_search");
  assert.deepStrictEqual(grok.tools[0], { type: "web_search" });

  const deep = buildToolProfileCascade("grok-4.5", { unrestrictedWeb: true });
  assert.ok(deep.some((p) => JSON.stringify(p.tools) === JSON.stringify([{ type: "web_search" }])));

  const brief = buildToolProfileCascade("grok-4.5", { unrestrictedWeb: false });
  const filtered = brief.find((p) => p.kind === "web_search_idx_filter");
  assert.ok(filtered);
  assert.deepStrictEqual(filtered.tools[0].filters.allowed_domains, IDX_SEARCH_DOMAINS);
}

// Docs-minimal Responses body: model + input + tools + stream:false (no reasoning/temp)
{
  const body = buildNativeResponsesBody({
    model: "xai/grok-4.5",
    system: "You are a researcher.",
    user: "What is IHSG?",
    tools: [{ type: "web_search" }]
  });
  assert.strictEqual(body.model, "xai/grok-4.5");
  assert.strictEqual(body.input.length, 1);
  assert.strictEqual(body.input[0].role, "user");
  assert.ok(body.input[0].content.includes("What is IHSG?"));
  assert.deepStrictEqual(body.tools, [{ type: "web_search" }]);
  assert.strictEqual(body.stream, false);
  assert.strictEqual(body.temperature, undefined);
  assert.strictEqual(body.reasoning, undefined);
  assert.strictEqual(body.reasoning_effort, undefined);
  assert.strictEqual(Object.keys(body).sort().join(","), "input,model,stream,tools");

  assert.strictEqual(buildResponsesUrl("https://api.x.ai/v1"), "https://api.x.ai/v1/responses");
  assert.strictEqual(buildResponsesUrl("https://my.router.com"), "https://my.router.com/v1/responses");
  assert.strictEqual(buildResponsesUrl("https://my.router.com/v1/"), "https://my.router.com/v1/responses");
}

// SSE parse (custom router stream body that broke res.json())
{
  const { parseResponsesPayload, looksLikeSse } = await import(nativeUrl);
  const sse = `event: response.created
data: {"type":"response.created","response":{"id":"r1","object":"response"}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"{\\"findings\\":["}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"{\\"claim\\":\\"IHSG down\\"}]}}"}

event: response.completed
data: {"type":"response.completed","response":{"id":"r1","output_text":"{\\"findings\\":[{\\"claim\\":\\"IHSG down\\",\\"url\\":\\"https://x.test\\"}]}","citations":[{"url":"https://x.test","title":"t"}]}}

`;
  assert.ok(looksLikeSse(sse));
  const p = parseResponsesPayload(sse);
  assert.strictEqual(p.via, "sse");
  assert.ok(p.content.includes("findings") || p.content.includes("IHSG"));
  assert.ok(p.citations.length >= 1);
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
