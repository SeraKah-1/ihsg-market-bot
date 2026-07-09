/**
 * Tests for shipped 9Router web normalize + free-path helpers (lib/).
 */
import assert from "assert";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const core = require("../lib/ninerouter-web-core.js");
const client = require("../lib/ninerouter-web-client.js");

// --- buildSearchBody ---
{
  const b = core.buildSearchBody({ query: "IHSG berita", max_results: 5, search_type: "news" });
  assert.strictEqual(b.query, "IHSG berita");
  assert.strictEqual(b.search_type, "news");
  assert.strictEqual(b.max_results, 5);
  assert.ok(b.model);
  try {
    core.buildSearchBody({ query: "" });
    assert.fail("should throw");
  } catch (e) {
    assert.ok(/query/i.test(e.message));
  }
}

// --- normalizeSearchResponse (shape from 9router skill docs) ---
{
  const sample = {
    provider: "tavily",
    query: "9Router open source",
    results: [
      {
        title: "Hello",
        url: "https://example.com/a",
        display_url: "example.com",
        snippet: "snippet text",
        position: 1,
        score: 0.92,
        citation: { provider: "tavily", rank: 1 }
      }
    ],
    usage: { queries_used: 1 },
    errors: []
  };
  const n = core.normalizeSearchResponse(sample, "9Router open source");
  assert.strictEqual(n.results.length, 1);
  assert.strictEqual(n.results[0].title, "Hello");
  assert.strictEqual(n.results[0].url, "https://example.com/a");
  assert.ok(n.results[0].snippet.includes("snippet"));
  assert.strictEqual(n.provider, "tavily");
}

// error shape
{
  const n = core.normalizeSearchResponse(
    { error: { message: "Invalid API key", type: "authentication_error" } },
    "x"
  );
  assert.strictEqual(n.results.length, 0);
  assert.ok(n.errors.some((e) => /Invalid API key/i.test(e)));
}

// --- normalizeFetchResponse ---
{
  const sample = {
    provider: "jina-reader",
    url: "https://example.com",
    title: "Example",
    content: { format: "markdown", text: "# Hi\n\nBody here with enough chars....", length: 30 }
  };
  const n = core.normalizeFetchResponse(sample, "https://example.com");
  assert.strictEqual(n.ok, true);
  assert.ok(n.text.includes("Body"));
  assert.strictEqual(n.title, "Example");
}

// --- jina free URL ---
{
  const u = core.jinaReaderUrl("https://example.com/path");
  assert.strictEqual(u, "https://r.jina.ai/https://example.com/path");
}

// --- pickTopUrls ---
{
  const urls = core.pickTopUrls(
    [
      { url: "https://kontan.co.id/a" },
      { url: "https://kontan.co.id/a#x" },
      { url: "https://google.com/search?q=x" },
      { url: "https://bisnis.com/b" },
      { url: "not-a-url" }
    ],
    3
  );
  assert.deepStrictEqual(urls, ["https://kontan.co.id/a", "https://bisnis.com/b"]);
}

// --- fallback path: searchVia9Router with bad endpoint fails soft ---
{
  const out = await client.searchVia9Router({
    endpoint: "http://127.0.0.1:9/v1",
    apiKey: "x",
    query: "IHSG",
    max_results: 2
  });
  assert.strictEqual(out.ok, false);
  assert.ok(Array.isArray(out.results));
  assert.strictEqual(out.results.length, 0);
  assert.ok(out.errors.length > 0);
}

// --- free Jina fetch works without 9router ---
{
  const page = await client.fetchPage({
    endpoint: "http://127.0.0.1:9/v1",
    apiKey: "",
    url: "https://example.com",
    max_characters: 2000,
    allowJinaFree: true
  });
  assert.strictEqual(page.ok, true, "jina free should fetch example.com: " + page.error);
  assert.ok(page.text.length > 20, "expected page text");
  assert.ok(page.layer === "jina-free" || page.provider === "jina-free");
}

console.log("ninerouter-web.test.mjs OK");
