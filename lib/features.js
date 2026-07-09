/**
 * Compact multi-horizon context for LLM (GIGO-aware).
 *
 * Hidden meaning of "AI harus paham konteks":
 * - Not 20 indicators — a small readable pack: where price is going,
 *   how fast (slope), structure (HH/HL), how wild (vol), vs market (IHSG).
 *
 * Horizons: 1d / 1w (~5) / 1m (~21) / 1y (~252 trading days)
 */

function round(n, d = 2) {
  if (n == null || Number.isNaN(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function closesFromBars(bars) {
  return (bars || []).map((b) => b.c).filter((x) => x != null && !Number.isNaN(x));
}

function volsFromBars(bars) {
  return (bars || []).map((b) => b.v || 0);
}

/** Return % over last n bars (close[t]/close[t-n]-1)*100 */
function retPct(closes, n) {
  if (!closes || closes.length < n + 1) return null;
  const a = closes[closes.length - 1 - n];
  const b = closes[closes.length - 1];
  if (!a) return null;
  return round(((b - a) / a) * 100, 2);
}

/**
 * Linear regression slope on last n closes, expressed as degrees.
 * Angle of best-fit line after normalizing price by mean (unitless x=0..n-1).
 * Positive = uptrend tilt. Human-readable, not geometric truth.
 */
function slopeDegrees(closes, n) {
  if (!closes || closes.length < Math.min(5, n)) return null;
  const slice = closes.slice(-n);
  const m = slice.length;
  if (m < 5) return null;
  const mean = slice.reduce((s, x) => s + x, 0) / m;
  if (!mean) return null;
  // y = price/mean, x = 0..m-1
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumXX = 0;
  for (let i = 0; i < m; i++) {
    const x = i;
    const y = slice[i] / mean;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = m * sumXX - sumX * sumX;
  if (!denom) return null;
  const slope = (m * sumXY - sumX * sumY) / denom; // Δy per bar in mean-units
  // scale so "typical" trends map to readable degrees
  const deg = (Math.atan(slope * m) * 180) / Math.PI;
  return round(deg, 1);
}

/**
 * Structure label from two consecutive windows of highs/lows.
 * HH = higher high + higher low tendency, etc.
 */
function structureLabel(closes, win = 5) {
  if (!closes || closes.length < win * 2 + 2) return "unknown";
  const a = closes.slice(-(win * 2), -win);
  const b = closes.slice(-win);
  const hiA = Math.max(...a);
  const loA = Math.min(...a);
  const hiB = Math.max(...b);
  const loB = Math.min(...b);
  const higherHigh = hiB > hiA;
  const higherLow = loB > loA;
  const lowerHigh = hiB < hiA;
  const lowerLow = loB < loA;
  if (higherHigh && higherLow) return "HH_HL"; // uptrend structure
  if (lowerHigh && lowerLow) return "LH_LL"; // downtrend structure
  if (higherHigh && lowerLow) return "expand"; // range expanding
  if (lowerHigh && higherLow) return "contract"; // squeeze
  if (higherHigh) return "HH";
  if (higherLow) return "HL";
  if (lowerHigh) return "LH";
  if (lowerLow) return "LL";
  return "mixed";
}

/** Realized vol annualized approx from last n daily returns */
function realizedVolPct(closes, n = 20) {
  if (!closes || closes.length < n + 1) return null;
  const rets = [];
  for (let i = closes.length - n; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (prev) rets.push((cur - prev) / prev);
  }
  if (!rets.length) return null;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const varr = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / rets.length;
  const daily = Math.sqrt(varr);
  return round(daily * Math.sqrt(252) * 100, 1); // annualized %
}

/** ATR% of price over n days (simple TR average) */
function atrPct(bars, n = 14) {
  if (!bars || bars.length < n + 1) return null;
  const slice = bars.slice(-(n + 1));
  const trs = [];
  for (let i = 1; i < slice.length; i++) {
    const h = slice[i].h ?? slice[i].c;
    const l = slice[i].l ?? slice[i].c;
    const pc = slice[i - 1].c;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  const atr = trs.reduce((s, x) => s + x, 0) / trs.length;
  const px = slice[slice.length - 1].c;
  if (!px) return null;
  return round((atr / px) * 100, 2);
}

function rvolLast(bars, lookback = 20) {
  const vols = volsFromBars(bars);
  if (vols.length < 3) return null;
  const last = vols[vols.length - 1];
  const base = vols.slice(-(lookback + 1), -1);
  if (!base.length) return null;
  const avg = base.reduce((s, x) => s + x, 0) / base.length;
  if (!avg) return null;
  return round(last / avg, 2);
}

function volTrend(vols, n = 10) {
  if (!vols || vols.length < n * 2) return "unknown";
  const a = vols.slice(-(n * 2), -n);
  const b = vols.slice(-n);
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  if (!ma) return "unknown";
  const ch = (mb - ma) / ma;
  if (ch > 0.15) return "rising";
  if (ch < -0.15) return "falling";
  return "flat";
}

/**
 * Build compact context for one series (stock or index).
 * @param {object} opts
 * @param {Array} opts.bars - {t,o,h,l,c,v}[]
 * @param {boolean} opts.includeYear
 */
function buildSeriesContext(bars, { includeYear = false } = {}) {
  const closes = closesFromBars(bars);
  const vols = volsFromBars(bars);
  if (closes.length < 5) {
    return { ok: false, reason: "insufficient_bars" };
  }

  const last = closes[closes.length - 1];
  const ctx = {
    ok: true,
    lastClose: round(last, 2),
    d1: {
      retPct: retPct(closes, 1),
      rvol: rvolLast(bars, 20)
    },
    w1: {
      retPct: retPct(closes, 5),
      slopeDeg: slopeDegrees(closes, 5),
      structure: structureLabel(closes, 5)
    },
    m1: {
      retPct: retPct(closes, 21),
      slopeDeg: slopeDegrees(closes, 21),
      structure: structureLabel(closes, 10),
      volAnnPct: realizedVolPct(closes, 21)
    },
    vol: {
      atrPct14: atrPct(bars, 14),
      realizedVol20dAnnPct: realizedVolPct(closes, 20),
      volumeTrend: volTrend(vols, 10)
    },
    // one-line for LLM scanning
    summary: ""
  };

  if (includeYear) {
    ctx.y1 = {
      retPct: retPct(closes, Math.min(252, closes.length - 1)),
      slopeDeg: slopeDegrees(closes, Math.min(60, closes.length)),
      volAnnPct: realizedVolPct(closes, Math.min(60, closes.length - 1))
    };
  }

  ctx.summary = summarizeSeries(ctx, includeYear);
  return ctx;
}

function summarizeSeries(ctx, includeYear) {
  const parts = [];
  if (ctx.d1?.retPct != null) parts.push(`1d ${signed(ctx.d1.retPct)}%`);
  if (ctx.w1?.retPct != null)
    parts.push(`1w ${signed(ctx.w1.retPct)}% slope${signed(ctx.w1.slopeDeg)}° ${ctx.w1.structure}`);
  if (ctx.m1?.retPct != null)
    parts.push(`1m ${signed(ctx.m1.retPct)}% slope${signed(ctx.m1.slopeDeg)}° ${ctx.m1.structure}`);
  if (includeYear && ctx.y1?.retPct != null) parts.push(`1y ${signed(ctx.y1.retPct)}%`);
  if (ctx.vol?.realizedVol20dAnnPct != null) parts.push(`vol~${ctx.vol.realizedVol20dAnnPct}%ann`);
  if (ctx.vol?.volumeTrend && ctx.vol.volumeTrend !== "unknown")
    parts.push(`volTrend=${ctx.vol.volumeTrend}`);
  return parts.join(" · ");
}

function signed(n) {
  if (n == null) return "—";
  return (n > 0 ? "+" : "") + n;
}

/**
 * Rule-based market regime from IHSG context (pragmatic, not HMM).
 */
function classifyRegime(ihsgCtx) {
  if (!ihsgCtx?.ok) return { tag: "unknown", note: "IHSG context missing" };
  const m = ihsgCtx.m1?.retPct;
  const w = ihsgCtx.w1?.retPct;
  const vol = ihsgCtx.vol?.realizedVol20dAnnPct;
  const struct = ihsgCtx.m1?.structure || "";
  const y = ihsgCtx.y1?.retPct;

  let tag = "chop";
  let note = "";

  const highVol = vol != null && vol > 22;
  const lowVol = vol != null && vol < 12;

  if (m != null && m <= -5) {
    tag = highVol ? "risk_off_volatile" : "risk_off";
    note = "1m IHSG lemah";
  } else if (m != null && m >= 4 && (struct === "HH_HL" || struct === "HH" || struct === "HL")) {
    tag = highVol ? "risk_on_volatile" : "risk_on";
    note = "1m IHSG kuat + struktur naik";
  } else if (highVol) {
    tag = "high_vol_chop";
    note = "volatilitas tinggi, arah kurang jelas";
  } else if (m != null && Math.abs(m) < 2 && lowVol) {
    tag = "low_vol_chop";
    note = "// range sepi";
  } else if (w != null && w > 2 && m != null && m > 0) {
    tag = "mild_risk_on";
    note = "mingguan positif";
  } else if (w != null && w < -2 && m != null && m < 0) {
    tag = "mild_risk_off";
    note = "mingguan negatif";
  } else {
    tag = "mixed";
    note = "sinyal campur";
  }

  if (y != null && y < -15 && tag.startsWith("risk_on")) {
    note += "; 1y masih dalam drawdown — risk_on lokal saja";
  }

  return {
    tag,
    note,
    ihsgSummary: ihsgCtx.summary,
    moneyProxy: {
      // volume on index often 0 on Yahoo — use rvol/volTrend when available
      volumeTrend: ihsgCtx.vol?.volumeTrend || "unknown",
      rvol: ihsgCtx.d1?.rvol
    }
  };
}

/**
 * Relative strength vs IHSG over 1w/1m.
 */
function vsIndex(stockCtx, ihsgCtx) {
  if (!stockCtx?.ok || !ihsgCtx?.ok) return null;
  const out = {};
  if (stockCtx.w1?.retPct != null && ihsgCtx.w1?.retPct != null) {
    out.excessRet1w = round(stockCtx.w1.retPct - ihsgCtx.w1.retPct, 2);
  }
  if (stockCtx.m1?.retPct != null && ihsgCtx.m1?.retPct != null) {
    out.excessRet1m = round(stockCtx.m1.retPct - ihsgCtx.m1.retPct, 2);
  }
  return out;
}

module.exports = {
  buildSeriesContext,
  classifyRegime,
  vsIndex,
  retPct,
  slopeDegrees,
  structureLabel,
  realizedVolPct
};
