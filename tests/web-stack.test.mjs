/**
 * Own web stack (Jina + helpers) — no 9Router.
 */
import assert from "assert";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const core = require("../lib/web-core.js");
const client = require("../lib/web-client.js");

// --- URLs ---
{
  assert.strictEqual(
    core.jinaReaderUrl("https://example.com/path"),
    "https://r.jina.ai/https://example.com/path"
  );
  const su = core.jinaSearchUrl("IHSG berita");
  assert.ok(su.startsWith("https://s.jina.ai/?"));
  assert.ok(su.includes("q=IHSG"));
}

// --- normalize Jina search shape ---
{
  const sample = {
    code: 200,
    status: 200,
    data: [
      {
        title: "BBCA naik",
        url: "https://example.com/bbca",
        description: "Bank Central Asia",
        content: "full…"
      }
    ]
  };
  const n = core.normalizeSearchResponse(sample, "BBCA");
  assert.strictEqual(n.results.length, 1);
  assert.strictEqual(n.results[0].title, "BBCA naik");
  assert.strictEqual(n.results[0].url, "https://example.com/bbca");
  assert.ok(n.results[0].snippet.includes("Bank"));
  assert.strictEqual(n.provider, "jina-search");
}

// error shape
{
  const n = core.normalizeSearchResponse({ error: { message: "Invalid API key" } }, "x");
  assert.strictEqual(n.results.length, 0);
  assert.ok(n.errors.some((e) => /Invalid API key/i.test(e)));
}

// --- normalize Jina fetch JSON ---
{
  const sample = {
    code: 200,
    data: {
      title: "Example",
      url: "https://example.com",
      content: "This domain is for use in documentation examples."
    }
  };
  const n = core.normalizeFetchResponse(sample, "https://example.com");
  assert.strictEqual(n.ok, true);
  assert.ok(n.text.includes("documentation"));
  assert.strictEqual(n.title, "Example");
}

// plain text body
{
  const n = core.normalizeFetchResponse("# Hello\n\nBody text enough length", "https://x.com");
  assert.strictEqual(n.ok, true);
  assert.ok(n.text.includes("Hello"));
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

// --- layer label ---
{
  const layer = core.mergeLayerLabel({
    usedNative: true,
    usedJinaSearch: true,
    usedJinaFetch: true,
    usedFreeNews: false
  });
  assert.strictEqual(layer, "native-tools+jina-search+jina-fetch");
}

// --- live Jina fetch (key from env if present) ---
{
  const page = await client.fetchPage({
    url: "https://example.com",
    max_characters: 2000,
    jinaApiKey: process.env.JINA_API_KEY || ""
  });
  assert.strictEqual(page.ok, true, "jina should fetch example.com: " + page.error);
  assert.ok(page.text.length > 20, "expected page text");
  assert.ok(String(page.layer).includes("jina"));
}

// --- live Jina search if key present (skip soft if no key) ---
{
  const key = process.env.JINA_API_KEY || "";
  if (key) {
    const s = await client.searchViaJina({
      query: "IHSG saham",
      max_results: 3,
      jinaApiKey: key
    });
    assert.strictEqual(s.ok, true, "jina search: " + (s.errors || []).join("; "));
    assert.ok(s.results.length >= 1);
    assert.ok(s.results[0].title || s.results[0].url);
  } else {
    console.log("skip live jina search (no JINA_API_KEY)");
  }
}

console.log("web-stack.test.mjs OK");
