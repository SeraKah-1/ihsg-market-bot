/**
 * Server-side market data: Yahoo chart API, disk cache, shortlist, DDG, runs/memory.
 * Free-first, personal use. EOD/delayed OK.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const { buildSeriesContext, classifyRegime, vsIndex } = require("./features.js");

const ROOT = path.join(__dirname, "..");
const UNIVERSE_PATH = path.join(ROOT, "data/universe/idx-tickers.json");
const CACHE_DIR = path.join(ROOT, "data/cache");
const RUNS_DIR = path.join(ROOT, "data/runs");
const MEMORY_PATH = path.join(ROOT, "data/memory/compact.jsonl");

/** Remote seeds for universe refresh (free, best-effort) */
const UNIVERSE_SEED_URLS = [
  // community / mirror lists may appear/disappear — each tried, errors ignored
  "https://raw.githubusercontent.com/VincenImanuell/CategorizedTickerSymbol_IDX/main/data/all_data/tickers.json"
];

const GLOBALS = [
  { symbol: "^GSPC", label: "S&P500" },
  { symbol: "^IXIC", label: "Nasdaq" },
  { symbol: "^N225", label: "Nikkei" },
  { symbol: "^HSI", label: "Hang Seng" },
  { symbol: "USDIDR=X", label: "USDIDR" },
  { symbol: "GC=F", label: "Gold" }
];

function ensureDirs() {
  for (const d of [CACHE_DIR, RUNS_DIR, path.dirname(MEMORY_PATH), path.dirname(UNIVERSE_PATH)]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function todayWIB() {
  // Asia/Jakarta date YYYY-MM-DD
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(new Date()); // en-CA → YYYY-MM-DD
}

function httpGetJson(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; IHSGMarketBot/1.0; personal)",
          Accept: "application/json,text/plain,*/*"
        },
        timeout: timeoutMs
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return httpGetJson(res.headers.location, timeoutMs).then(resolve, reject);
        }
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} for ${url.slice(0, 80)}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve({ _raw: raw.slice(0, 2000) });
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

function httpGetText(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; IHSGMarketBot/1.0)",
          Accept: "text/html,application/xhtml+xml"
        },
        timeout: timeoutMs
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve(raw));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (e) {
        results[idx] = { error: String(e.message || e) };
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function getUniverse() {
  ensureDirs();
  if (!fs.existsSync(UNIVERSE_PATH)) {
    throw new Error("Universe file missing: data/universe/idx-tickers.json");
  }
  const data = JSON.parse(fs.readFileSync(UNIVERSE_PATH, "utf8"));
  return data;
}

function cachePath(day) {
  return path.join(CACHE_DIR, `ohlcv-${day}.json`);
}

async function fetchYahooChart(symbol, range = "1mo", interval = "1d") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${range}&interval=${interval}&includePrePost=false`;
  const data = await httpGetJson(url);
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const q = result.indicators?.quote?.[0] || {};
  const ts = result.timestamp || [];
  const meta = result.meta || {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    if (c == null) continue;
    bars.push({
      t: ts[i],
      o: q.open?.[i] ?? c,
      h: q.high?.[i] ?? c,
      l: q.low?.[i] ?? c,
      c,
      v: q.volume?.[i] ?? 0
    });
  }
  return {
    symbol,
    currency: meta.currency,
    regularMarketPrice: meta.regularMarketPrice,
    chartPreviousClose: meta.chartPreviousClose,
    bars
  };
}

function barFeatures(bars) {
  if (!bars || bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const closes = bars.map((b) => b.c).filter((x) => x != null);
  const vols = bars.map((b) => b.v || 0);
  const changePct = prev.c ? ((last.c - prev.c) / prev.c) * 100 : 0;
  const avgVol20 = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(20, vols.length - 1));
  const rvol = avgVol20 > 0 ? last.v / avgVol20 : null;
  // simple z of return vs recent
  const rets = [];
  for (let i = 1; i < closes.length; i++) {
    rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const recent = rets.slice(-20);
  const mean = recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length);
  const variance =
    recent.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, recent.length);
  const std = Math.sqrt(variance) || 1e-9;
  const lastRet = rets[rets.length - 1] || 0;
  const zRet = (lastRet - mean) / std;
  const rangePct = last.o ? ((last.h - last.l) / last.o) * 100 : 0;
  return {
    close: last.c,
    open: last.o,
    high: last.h,
    low: last.l,
    volume: last.v,
    prevClose: prev.c,
    changePct: round4(changePct),
    rvol: rvol != null ? round4(rvol) : null,
    zRet: round4(zRet),
    rangePct: round4(rangePct),
    avgVol20: Math.round(avgVol20)
  };
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

async function getOhlcvDay({ day, force = false, max, onProgress } = {}) {
  ensureDirs();
  const d = day || todayWIB();
  const cp = cachePath(d);
  if (!force && fs.existsSync(cp)) {
    const cached = JSON.parse(fs.readFileSync(cp, "utf8"));
    cached.fromCache = true;
    return cached;
  }

  const universe = getUniverse();
  let tickers = universe.tickers || [];
  if (max && max > 0) tickers = tickers.slice(0, max);

  const symbols = [
    ...tickers.map((t) => (t.includes(".") ? t : `${t}.JK`)),
    "^JKSE",
    ...GLOBALS.map((g) => g.symbol)
  ];

  const started = Date.now();
  let done = 0;
  // 1y daily bars → enough for 1d/1w/1m/1y context without dumping ticks
  const rows = await mapPool(symbols, 10, async (sym) => {
    try {
      const isIndexOrFx = sym.startsWith("^") || sym.includes("=") || sym === "GC=F";
      const chart = await fetchYahooChart(sym, isIndexOrFx ? "1y" : "1y", "1d");
      done++;
      if (onProgress) onProgress(done, symbols.length);
      if (!chart || !chart.bars?.length) return { symbol: sym, ok: false };
      const feat = barFeatures(chart.bars);
      const includeYear = sym === "^JKSE" || isIndexOrFx;
      const context = buildSeriesContext(chart.bars, { includeYear: true });
      return {
        symbol: sym,
        ticker: sym.replace(/\.JK$/, ""),
        ok: true,
        ...feat,
        context,
        // keep last ~30 bars only in cache payload to limit disk (context already computed)
        lastBarT: chart.bars[chart.bars.length - 1]?.t,
        barCount: chart.bars.length
      };
    } catch (e) {
      done++;
      return { symbol: sym, ok: false, error: String(e.message || e) };
    }
  });

  const okStocks = rows.filter((r) => r.ok && r.symbol.endsWith(".JK"));
  const idxRow = rows.find((r) => r.symbol === "^JKSE" && r.ok) || null;
  const globalRows = GLOBALS.map((g) => {
    const r = rows.find((x) => x.symbol === g.symbol && x.ok);
    return r ? { ...r, label: g.label } : { symbol: g.symbol, label: g.label, ok: false };
  });

  const ihsgContext = idxRow?.context || null;
  const marketRegime = classifyRegime(ihsgContext);

  // attach relative strength vs IHSG on stocks
  for (const s of okStocks) {
    s.vsIhsg = vsIndex(s.context, ihsgContext);
    if (s.context?.ok) {
      s.context.vsIhsg = s.vsIhsg;
      if (s.vsIhsg?.excessRet1w != null) {
        s.context.summary += ` · vsIHSG_1w ${s.vsIhsg.excessRet1w > 0 ? "+" : ""}${s.vsIhsg.excessRet1w}%`;
      }
    }
  }

  const payload = {
    day: d,
    generatedAt: new Date().toISOString(),
    fromCache: false,
    elapsedMs: Date.now() - started,
    universeSize: tickers.length,
    fetchedOk: okStocks.length,
    coveragePct: tickers.length ? round4((okStocks.length / tickers.length) * 100) : 0,
    sources: ["yahoo-chart-v8", "features-v1"],
    marketRegime,
    ihsg: idxRow
      ? {
          ...idxRow,
          context: ihsgContext
        }
      : null,
    globals: globalRows,
    stocks: okStocks,
    failures: rows.filter((r) => !r.ok).length
  };

  fs.writeFileSync(cp, JSON.stringify(payload));
  return payload;
}

function buildShortlist(ohlcv, k = 8) {
  const stocks = (ohlcv.stocks || []).filter((s) => s.ok && s.changePct != null);
  const kN = Math.max(3, Math.min(20, k || 8));

  const byGain = [...stocks].sort((a, b) => b.changePct - a.changePct);
  const byLoss = [...stocks].sort((a, b) => a.changePct - b.changePct);
  const byRvol = [...stocks]
    .filter((s) => s.rvol != null)
    .sort((a, b) => (b.rvol || 0) - (a.rvol || 0));
  const byAbsZ = [...stocks].sort((a, b) => Math.abs(b.zRet || 0) - Math.abs(a.zRet || 0));

  const picked = new Map();
  function add(list, reason, n) {
    for (const s of list.slice(0, n)) {
      const key = s.ticker || s.symbol;
      if (!picked.has(key)) {
        picked.set(key, {
          ticker: s.ticker || s.symbol.replace(/\.JK$/, ""),
          symbol: s.symbol,
          metrics: {
            close: s.close,
            changePct: s.changePct,
            volume: s.volume,
            rvol: s.rvol,
            zRet: s.zRet,
            rangePct: s.rangePct,
            avgVol20: s.avgVol20
          },
          // compact multi-horizon pack for LLM (1d/1w/1m + vol + structure)
          context: s.context || null,
          vsIhsg: s.vsIhsg || null,
          whySelected: [reason]
        });
      } else {
        picked.get(key).whySelected.push(reason);
      }
    }
  }

  const per = Math.max(2, Math.ceil(kN / 4));
  add(byGain, "top_gainer", per);
  add(byLoss, "top_loser", per);
  add(byRvol, "rvol_spike", per);
  add(byAbsZ, "return_z_anomaly", per);

  // trim to k by score
  const scored = [...picked.values()].map((p) => {
    const m = p.metrics;
    const score =
      Math.abs(m.changePct || 0) * 1.2 +
      (m.rvol || 0) * 2 +
      Math.abs(m.zRet || 0) * 3 +
      p.whySelected.length * 0.5;
    // heuristic exit-liq hint: huge up + high rvol + wide range
    let exitLiquidityHint = "low";
    if ((m.changePct || 0) > 15 && (m.rvol || 0) > 3) exitLiquidityHint = "med";
    if ((m.changePct || 0) > 20 && (m.rvol || 0) > 5) exitLiquidityHint = "high";
    if ((m.changePct || 0) > 25) exitLiquidityHint = "high";
    let flowAlive = (m.rvol || 0) >= 1.2 && Math.abs(m.changePct || 0) >= 2;
    return {
      ...p,
      score: round4(score),
      flowHints: {
        flowAlive,
        exitLiquidityHint,
        fuelGuess:
          (m.changePct || 0) > 10 && (m.rvol || 0) < 1.5
            ? "already_crowded"
            : (m.changePct || 0) > 3 && (m.rvol || 0) >= 1.5
              ? "fear_outside_or_momentum"
              : "unknown"
      }
    };
  });
  scored.sort((a, b) => b.score - a.score);
  const shortlist = scored.slice(0, kN);

  // breadth
  const adv = stocks.filter((s) => s.changePct > 0).length;
  const dec = stocks.filter((s) => s.changePct < 0).length;
  const flat = stocks.length - adv - dec;

  // If cached payload pre-features-v1, marketRegime may be missing — recompute from ihsg.context
  let marketRegime = ohlcv.marketRegime || null;
  if (!marketRegime && ohlcv.ihsg?.context) {
    marketRegime = classifyRegime(ohlcv.ihsg.context);
  }

  return {
    day: ohlcv.day,
    k: kN,
    dataQuality: {
      coveragePct: ohlcv.coveragePct,
      sources: ohlcv.sources,
      fetchedOk: ohlcv.fetchedOk,
      universeSize: ohlcv.universeSize,
      fromCache: !!ohlcv.fromCache,
      gaps: ohlcv.coveragePct < 70 ? ["coverage_below_70pct"] : []
    },
    // IHSG regime card — critical market condition for AI
    marketRegime,
    ihsg: ohlcv.ihsg,
    globals: ohlcv.globals,
    breadth: { adv, dec, flat, total: stocks.length },
    topGainers: byGain.slice(0, 10).map(slim),
    topLosers: byLoss.slice(0, 10).map(slim),
    topRvol: byRvol.slice(0, 10).map(slim),
    shortlist
  };
}

/**
 * Refresh universe: merge remote seeds + validate via Yahoo (drop dead).
 * Pragmatic: not official IDX feed (CF-blocked); best-effort free path.
 */
async function refreshUniverse({ validate = true, maxValidate = 0 } = {}) {
  ensureDirs();
  const current = fs.existsSync(UNIVERSE_PATH)
    ? JSON.parse(fs.readFileSync(UNIVERSE_PATH, "utf8"))
    : { tickers: [] };
  const set = new Set((current.tickers || []).map((t) => String(t).toUpperCase().replace(/\.JK$/, "")));

  const seedHits = [];
  for (const url of UNIVERSE_SEED_URLS) {
    try {
      const data = await httpGetJson(url);
      const list = extractTickersFromUnknown(data);
      for (const t of list) set.add(t);
      seedHits.push({ url, added: list.length });
    } catch (e) {
      seedHits.push({ url, error: String(e.message || e) });
    }
  }

  let tickers = [...set].filter((t) => /^[A-Z]{3,4}$/.test(t)).sort();
  const removed = [];
  const kept = [];

  if (validate && tickers.length) {
    let toCheck = tickers;
    if (maxValidate > 0) toCheck = tickers.slice(0, maxValidate);
    const checks = await mapPool(toCheck, 8, async (t) => {
      try {
        const chart = await fetchYahooChart(`${t}.JK`, "5d", "1d");
        const ok = !!(chart && chart.bars && chart.bars.length);
        return { t, ok };
      } catch {
        return { t, ok: false };
      }
    });
    const okSet = new Set(checks.filter((c) => c.ok).map((c) => c.t));
    if (maxValidate > 0 && maxValidate < tickers.length) {
      // only validated subset; keep unvalidated rest
      const unchecked = tickers.slice(maxValidate);
      for (const c of checks) {
        if (c.ok) kept.push(c.t);
        else removed.push(c.t);
      }
      tickers = [...kept, ...unchecked].sort();
    } else {
      for (const c of checks) {
        if (c.ok) kept.push(c.t);
        else removed.push(c.t);
      }
      tickers = kept.sort();
    }
  }

  const out = {
    exchange: "IDX",
    suffix: ".JK",
    updated: new Date().toISOString().slice(0, 10),
    refreshedAt: new Date().toISOString(),
    note: "Refreshed free path (Yahoo validate + optional seeds). Not official IDX dump.",
    count: tickers.length,
    tickers,
    meta: { seedHits, removed: removed.slice(0, 50), removedCount: removed.length, validate }
  };
  fs.writeFileSync(UNIVERSE_PATH, JSON.stringify(out, null, 2));
  return out;
}

function extractTickersFromUnknown(data) {
  const out = [];
  if (!data) return out;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === "string") out.push(item.toUpperCase().replace(/\.JK$/, ""));
      else if (item && typeof item === "object") {
        const t = item.ticker || item.symbol || item.code || item.Code;
        if (t) out.push(String(t).toUpperCase().replace(/\.JK$/, ""));
      }
    }
  } else if (typeof data === "object") {
    if (Array.isArray(data.tickers)) return extractTickersFromUnknown(data.tickers);
    if (Array.isArray(data.data)) return extractTickersFromUnknown(data.data);
  }
  return out.filter((t) => /^[A-Z]{3,4}$/.test(t));
}

function slim(s) {
  return {
    ticker: s.ticker,
    changePct: s.changePct,
    rvol: s.rvol,
    volume: s.volume,
    close: s.close
  };
}

async function ddgSearch(query, n = 5) {
  // Free multi-source: Google News RSS (works well for ID news) → DDG HTML fallback
  const results = [];
  try {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=id&gl=ID&ceid=ID:id`;
    const xml = await httpGetText(rssUrl);
    const itemRe = /<item>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = itemRe.exec(xml)) && results.length < n) {
      const block = m[1];
      const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
        block.match(/<title>(.*?)<\/title>/) || [])[1];
      const link = (block.match(/<link>(.*?)<\/link>/) || [])[1];
      const snip = (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
        block.match(/<description>(.*?)<\/description>/) || [])[1];
      if (title) {
        results.push({
          title: title.replace(/<[^>]+>/g, "").trim(),
          url: (link || "").trim(),
          snippet: (snip || "").replace(/<[^>]+>/g, "").trim().slice(0, 280),
          sourceTier: "media",
          provider: "google-news-rss"
        });
      }
    }
  } catch {
    /* try DDG */
  }
  if (results.length > 0) return results;

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await httpGetText(url);
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) && results.length < n) {
      let href = m[1];
      const uddg = href.match(/uddg=([^&]+)/);
      if (uddg) {
        try {
          href = decodeURIComponent(uddg[1]);
        } catch {
          /* keep */
        }
      }
      const title = m[2].replace(/<[^>]+>/g, "").trim();
      if (title && href.startsWith("http")) {
        results.push({ title, url: href, sourceTier: "media", provider: "ddg" });
      }
    }
  } catch {
    /* empty */
  }
  return results;
}

function saveRun(run) {
  ensureDirs();
  const id = run.runId;
  const p = path.join(RUNS_DIR, `${id}.json`);
  fs.writeFileSync(p, JSON.stringify(run, null, 2));
  return p;
}

function loadRun(id) {
  const p = path.join(RUNS_DIR, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function listRuns() {
  ensureDirs();
  return fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const id = f.replace(/\.json$/, "");
      try {
        const j = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8"));
        return {
          runId: id,
          asOfSession: j.asOfSession,
          generatedAt: j.generatedAt,
          judgeLean: j.sentiment?.judgeLean
        };
      } catch {
        return { runId: id };
      }
    })
    .sort((a, b) => String(b.generatedAt || "").localeCompare(String(a.generatedAt || "")));
}

function appendCompactMemory(item) {
  ensureDirs();
  const line = JSON.stringify({ ...item, savedAt: new Date().toISOString() });
  fs.appendFileSync(MEMORY_PATH, line + "\n");
}

function loadCompactMemory(n = 10) {
  ensureDirs();
  if (!fs.existsSync(MEMORY_PATH)) return [];
  const lines = fs.readFileSync(MEMORY_PATH, "utf8").trim().split("\n").filter(Boolean);
  return lines
    .slice(-n)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Single emiten + IHSG regime for deep dive.
 */
async function getTickerPack(code, { force = false } = {}) {
  const t = String(code || "")
    .toUpperCase()
    .replace(/\.JK$/, "");
  const day = todayWIB();
  const cacheKey = path.join(CACHE_DIR, `ticker-${t}-${day}.json`);
  if (!force && fs.existsSync(cacheKey)) {
    const cached = JSON.parse(fs.readFileSync(cacheKey, "utf8"));
    cached.fromCache = true;
    return cached;
  }

  const [stockChart, ihsgChart, ...globalCharts] = await Promise.all([
    fetchYahooChart(`${t}.JK`, "1y", "1d"),
    fetchYahooChart("^JKSE", "1y", "1d"),
    ...GLOBALS.map((g) => fetchYahooChart(g.symbol, "3mo", "1d").then((c) => ({ g, c })))
  ]);

  if (!stockChart?.bars?.length) {
    throw new Error(`Tidak ada data Yahoo untuk ${t}.JK`);
  }

  const feat = barFeatures(stockChart.bars);
  const context = buildSeriesContext(stockChart.bars, { includeYear: true });
  const ihsgFeat = ihsgChart?.bars?.length ? barFeatures(ihsgChart.bars) : null;
  const ihsgContext = ihsgChart?.bars?.length
    ? buildSeriesContext(ihsgChart.bars, { includeYear: true })
    : null;
  const marketRegime = classifyRegime(ihsgContext);
  const stock = {
    symbol: `${t}.JK`,
    ticker: t,
    ok: true,
    ...feat,
    context,
    vsIhsg: vsIndex(context, ihsgContext)
  };
  if (stock.context?.ok && stock.vsIhsg?.excessRet1w != null) {
    stock.context.summary += ` · vsIHSG_1w ${stock.vsIhsg.excessRet1w > 0 ? "+" : ""}${stock.vsIhsg.excessRet1w}%`;
  }

  const globals = globalCharts.map(({ g, c }) => {
    if (!c?.bars?.length) return { symbol: g.symbol, label: g.label, ok: false };
    const f = barFeatures(c.bars);
    const ctx = buildSeriesContext(c.bars, { includeYear: false });
    return { symbol: g.symbol, label: g.label, ok: true, ...f, context: ctx };
  });

  const pack = {
    day,
    generatedAt: new Date().toISOString(),
    fromCache: false,
    marketRegime,
    ihsg: ihsgFeat
      ? { symbol: "^JKSE", ticker: "^JKSE", ok: true, ...ihsgFeat, context: ihsgContext }
      : null,
    stock,
    globals,
    sources: ["yahoo-chart-v8", "features-v1"]
  };
  fs.writeFileSync(cacheKey, JSON.stringify(pack));
  return pack;
}

module.exports = {
  todayWIB,
  getUniverse,
  getOhlcvDay,
  buildShortlist,
  refreshUniverse,
  getTickerPack,
  ddgSearch,
  saveRun,
  loadRun,
  listRuns,
  appendCompactMemory,
  loadCompactMemory,
  GLOBALS
};
