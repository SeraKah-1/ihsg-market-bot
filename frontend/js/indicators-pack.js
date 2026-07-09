/**
 * Pure indicator packs (JSON) — never mix into narrative prose.
 * Code owns numbers; UI renders cards + pretty JSON.
 */

function n(x, d = 2) {
  if (x == null || Number.isNaN(Number(x))) return null;
  return Math.round(Number(x) * 10 ** d) / 10 ** d;
}

function horizonSlice(h) {
  if (!h) return null;
  return {
    retPct: n(h.retPct),
    slopeDeg: h.slopeDeg != null ? n(h.slopeDeg, 1) : null,
    structure: h.structure || null,
    volAnnPct: h.volAnnPct != null ? n(h.volAnnPct, 1) : null,
    rvol: h.rvol != null ? n(h.rvol, 2) : null
  };
}

/**
 * Compact indicators JSON for one ticker / stock row.
 */
export function packTickerIndicators(row) {
  if (!row) return null;
  const m = row.metrics || {};
  const ctx = row.context || {};
  const vs = row.vsIhsg || {};
  const flow = row.flowHints || {};
  return {
    ticker: row.ticker || null,
    asOf: row.asOf || row.day || null,
    price: {
      close: m.close != null ? n(m.close, 0) : m.close,
      changePct1d: n(m.changePct ?? m.ret1dPct),
      rvol: n(m.rvol),
      zRet: n(m.zRet ?? m.returnZ, 2)
    },
    horizons: {
      d1: horizonSlice(ctx.d1) || {
        retPct: n(m.changePct),
        rvol: n(m.rvol)
      },
      w1: horizonSlice(ctx.w1),
      m1: horizonSlice(ctx.m1),
      y1: horizonSlice(ctx.y1)
    },
    volume: {
      trend: ctx.vol?.volumeTrend || null,
      atrPct14: n(ctx.vol?.atrPct14, 2),
      realizedVol20dAnnPct: n(ctx.vol?.realizedVol20dAnnPct, 1)
    },
    vsIhsg: {
      excess1w: n(vs.w1 ?? vs.excess1w),
      excess1m: n(vs.m1 ?? vs.excess1m)
    },
    flow: {
      flowAlive: flow.flowAlive ?? null,
      exitLiquidityHint: flow.exitLiquidityHint || null
    },
    whySelected: Array.isArray(row.whySelected) ? row.whySelected : []
  };
}

/**
 * Market-wide indicators (IHSG + breadth + regime).
 */
export function packMarketIndicators(packOrBriefing) {
  const b = packOrBriefing || {};
  const ihsg = b.ihsg || {};
  const ctx = ihsg.context || {};
  const regime = b.marketRegime || {};
  const br = b.breadth || {};
  return {
    day: b.asOfSession || b.day || null,
    ihsg: {
      close: ihsg.close != null ? n(ihsg.close, 2) : null,
      changePct1d: n(ihsg.changePct),
      horizons: {
        d1: horizonSlice(ctx.d1) || { retPct: n(ihsg.changePct), rvol: n(ctx.d1?.rvol) },
        w1: horizonSlice(ctx.w1),
        m1: horizonSlice(ctx.m1),
        y1: horizonSlice(ctx.y1)
      },
      volume: {
        trend: ctx.vol?.volumeTrend || null,
        atrPct14: n(ctx.vol?.atrPct14, 2),
        realizedVol20dAnnPct: n(ctx.vol?.realizedVol20dAnnPct, 1)
      }
    },
    regime: {
      tag: regime.tag || null,
      note: regime.note || null
    },
    breadth: {
      adv: br.adv ?? null,
      dec: br.dec ?? null,
      total: br.total ?? null
    },
    dataQuality: b.dataQuality
      ? {
          coveragePct: b.dataQuality.coveragePct ?? null,
          fromCache: !!b.dataQuality.fromCache
        }
      : null
  };
}

/**
 * Attach indicators JSON onto briefing (mutates copy-friendly object).
 */
export function attachIndicatorsToBriefing(briefing, shortlistPack) {
  if (!briefing) return briefing;
  const marketSrc = shortlistPack || briefing;
  briefing.indicators = {
    market: packMarketIndicators(marketSrc),
    tickers: Object.fromEntries(
      (briefing.shortlist || []).map((row) => {
        const hard =
          (shortlistPack?.shortlist || []).find((s) => s.ticker === row.ticker) || row;
        return [row.ticker, packTickerIndicators({ ...hard, ...row, metrics: hard.metrics || row.metrics, context: hard.context || row.context })];
      })
    )
  };
  // ensure each shortlist row has indicators pointer (no prose)
  briefing.shortlist = (briefing.shortlist || []).map((row) => ({
    ...row,
    indicators: briefing.indicators.tickers[row.ticker] || packTickerIndicators(row)
  }));
  return briefing;
}

export function attachIndicatorsToDeepDive(dive, stock) {
  if (!dive) return dive;
  const row = {
    ticker: dive.ticker,
    metrics: dive.metrics || stock?.metrics,
    context: dive.context || stock?.context || dive.marketContext,
    vsIhsg: dive.vsIhsg || stock?.vsIhsg,
    flowHints: stock?.flowHints,
    whySelected: ["deep_dive"]
  };
  dive.indicators = packTickerIndicators(row);
  return dive;
}

/** Tiny chip rows for UI (from pack) */
export function chipsFromTickerPack(pack) {
  if (!pack?.price) return [];
  const p = pack.price;
  const h = pack.horizons || {};
  const out = [];
  if (p.changePct1d != null) out.push({ k: "1d", v: `${p.changePct1d > 0 ? "+" : ""}${p.changePct1d}%`, tone: p.changePct1d >= 0 ? "up" : "down" });
  if (p.rvol != null) out.push({ k: "RVOL", v: `${p.rvol}×`, tone: p.rvol >= 1.2 ? "up" : p.rvol < 0.4 ? "down" : "neutral" });
  if (p.zRet != null) out.push({ k: "z", v: String(p.zRet), tone: Math.abs(p.zRet) >= 2 ? "warn" : "neutral" });
  if (h.m1?.structure) out.push({ k: "m1", v: h.m1.structure, tone: "neutral" });
  if (h.m1?.retPct != null) out.push({ k: "m1%", v: `${h.m1.retPct > 0 ? "+" : ""}${h.m1.retPct}%`, tone: h.m1.retPct >= 0 ? "up" : "down" });
  if (pack.volume?.trend) out.push({ k: "vol", v: pack.volume.trend, tone: "neutral" });
  if (pack.vsIhsg?.excess1m != null) out.push({ k: "vsIHSG m1", v: `${pack.vsIhsg.excess1m > 0 ? "+" : ""}${pack.vsIhsg.excess1m}%`, tone: pack.vsIhsg.excess1m >= 0 ? "up" : "down" });
  return out;
}

export function chipsFromMarketPack(pack) {
  if (!pack?.ihsg) return [];
  const i = pack.ihsg;
  const out = [];
  if (i.changePct1d != null) out.push({ k: "IHSG 1d", v: `${i.changePct1d > 0 ? "+" : ""}${i.changePct1d}%`, tone: i.changePct1d >= 0 ? "up" : "down" });
  if (pack.regime?.tag) out.push({ k: "regime", v: pack.regime.tag, tone: "neutral" });
  if (pack.breadth?.adv != null) out.push({ k: "breadth", v: `${pack.breadth.adv}/${pack.breadth.dec}`, tone: pack.breadth.adv < pack.breadth.dec ? "down" : "up" });
  if (i.volume?.trend) out.push({ k: "vol", v: i.volume.trend, tone: "neutral" });
  if (i.horizons?.m1?.retPct != null) out.push({ k: "m1", v: `${i.horizons.m1.retPct > 0 ? "+" : ""}${i.horizons.m1.retPct}%`, tone: i.horizons.m1.retPct >= 0 ? "up" : "down" });
  return out;
}
