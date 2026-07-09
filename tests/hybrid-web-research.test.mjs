/**
 * Hybrid path pieces: Jina research + free news gap-fill (no 9Router).
 */
import assert from "assert";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// load .env like server does
const fs = require("fs");
const path = require("path");
try {
  const envPath = path.join(path.dirname(new URL(import.meta.url).pathname), "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (k && process.env[k] == null) process.env[k] = v;
    }
  }
} catch {
  /* */
}

const marketApi = require("../lib/market-api.js");
const webClient = require("../lib/web-client.js");
const core = require("../lib/web-core.js");

// 1) free news path still works
const news = await marketApi.ddgSearch("IHSG saham", 3);
assert.ok(Array.isArray(news));
for (const r of news) {
  assert.ok("title" in r || "url" in r);
}

const layer = core.mergeLayerLabel({
  usedNative: false,
  usedJinaSearch: false,
  usedJinaFetch: false,
  usedFreeNews: news.length > 0
});
if (news.length > 0) {
  assert.ok(layer.includes("news-rss"));
} else {
  assert.strictEqual(layer, "none");
}

// 2) Jina search normalize unit
const recorded = core.normalizeSearchResponse(
  {
    code: 200,
    data: [
      {
        title: "BBCA naik",
        url: "https://example.com/bbca",
        description: "Bank Central Asia"
      }
    ]
  },
  "BBCA saham"
);
assert.strictEqual(recorded.results[0].title, "BBCA naik");
assert.strictEqual(recorded.results[0].url, "https://example.com/bbca");

// 3) live fetch via Jina
const live = await webClient.fetchPage({
  url: "https://example.com",
  jinaApiKey: process.env.JINA_API_KEY || "",
  max_characters: 3000
});
assert.strictEqual(live.ok, true, live.error);
assert.ok(live.text.length > 10);

// 4) research pack (with key if present)
const pack = await webClient.researchPack({
  queries: ["IHSG hari ini"],
  max_results: 3,
  jinaApiKey: process.env.JINA_API_KEY || "",
  fetchPages: false
});
assert.ok(Array.isArray(pack.results));
assert.ok(Array.isArray(pack.errors));

// 5) pickTopUrls
const tops = core.pickTopUrls(recorded.results, 2);
assert.deepStrictEqual(tops, ["https://example.com/bbca"]);

// 6) 9router alias is disabled stub
const dead = await webClient.searchVia9Router({});
assert.strictEqual(dead.ok, false);
assert.ok(dead.errors.some((e) => /9router_disabled/i.test(e)));

console.log("hybrid-web-research.test.mjs OK", {
  newsHits: news.length,
  layer,
  jinaLayer: live.layer,
  packHits: pack.results.length,
  usedJinaSearch: pack.usedJinaSearch
});
