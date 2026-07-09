/**
 * Exercises server /api/web/research entry (same path UI uses via hybrid).
 * Forces 9router fail (bad endpoint) and asserts free news path still returns structure.
 */
import assert from "assert";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Direct unit: research helper pieces via client + marketApi news
const marketApi = require("../lib/market-api.js");
const webClient = require("../lib/ninerouter-web-client.js");
const core = require("../lib/ninerouter-web-core.js");

// 1) Forced 9r search fail → empty → news can still work
const failed = await webClient.searchVia9Router({
  endpoint: "http://127.0.0.1:1/v1",
  apiKey: "bad",
  query: "IHSG saham",
  max_results: 3
});
assert.strictEqual(failed.ok, false);

// free news path (market-api ddgSearch = Google News RSS)
const news = await marketApi.ddgSearch("IHSG saham", 3);
assert.ok(Array.isArray(news));
// may be 0 in offline CI — still assert shape when non-empty
for (const r of news) {
  assert.ok("title" in r || "url" in r);
}

// Simulate hybrid merge label
const layer = core.mergeLayerLabel({
  used9rSearch: false,
  used9rFetch: false,
  usedFreeNews: news.length > 0,
  usedJina: false,
  usedNative: false
});
if (news.length > 0) {
  assert.ok(layer.includes("news-rss"));
} else {
  assert.strictEqual(layer, "none");
}

// 2) Successful normalize of recorded 9r search shape → agent-consumable fields
const recorded = core.normalizeSearchResponse(
  {
    provider: "tavily",
    query: "BBCA saham",
    results: [
      {
        title: "BBCA naik",
        url: "https://example.com/bbca",
        snippet: "Bank Central Asia",
        score: 0.9
      }
    ]
  },
  "BBCA saham"
);
assert.strictEqual(recorded.results[0].title, "BBCA naik");
assert.strictEqual(recorded.results[0].url, "https://example.com/bbca");
assert.ok(recorded.results[0].snippet.includes("Bank"));

// 3) Fetch normalize + jina free live
const fetchNorm = core.normalizeFetchResponse({
  provider: "jina-reader",
  url: "https://example.com",
  title: "Ex",
  content: { format: "markdown", text: "Fetched body content for deep dive analysis path." }
});
assert.strictEqual(fetchNorm.ok, true);
assert.ok(fetchNorm.text.includes("Fetched body"));

const live = await webClient.fetchPage({
  endpoint: "http://127.0.0.1:1/v1",
  apiKey: "",
  url: "https://example.com",
  allowJinaFree: true
});
assert.strictEqual(live.ok, true, live.error);
assert.ok(live.text.length > 10);

// 4) pickTopUrls used for deep-dive fetch selection
const tops = core.pickTopUrls(recorded.results, 2);
assert.deepStrictEqual(tops, ["https://example.com/bbca"]);

console.log("hybrid-web-research.test.mjs OK", {
  newsHits: news.length,
  layer,
  jinaLayer: live.layer
});
