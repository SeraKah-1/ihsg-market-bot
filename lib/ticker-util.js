/**
 * Normalize IDX ticker — shared with frontend semantics.
 */
function normalizeTicker(raw) {
  let s = String(raw ?? "")
    .toUpperCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
  s = s.replace(/^["'`\[\(]+|[\]\)"'`]+$/g, "").trim();
  s = s.replace(/^(IDX|YAHOO|SYMBOL|TICKER|KODE)\s*[:#.\-\s]+/i, "").trim();
  s = s
    .replace(/\.JK\b/gi, "")
    .replace(/\.JS\b/gi, "")
    .replace(/:JK\b/gi, "")
    .replace(/\s+JK\b/gi, "")
    .trim();
  const first = s.split(/[\s,;/|]+/).filter(Boolean)[0] || "";
  s = first.replace(/[^A-Z]/g, "");
  return s;
}

function isValidTicker(code) {
  return typeof code === "string" && /^[A-Z]{2,6}$/.test(code);
}

function parseTicker(raw) {
  const ticker = normalizeTicker(raw);
  if (!ticker) {
    return { ok: false, ticker: "", error: "ticker kosong" };
  }
  if (!isValidTicker(ticker)) {
    return {
      ok: false,
      ticker,
      error: `ticker tidak valid (2-6 huruf): ${String(raw).slice(0, 40)}`
    };
  }
  return { ok: true, ticker };
}

module.exports = { normalizeTicker, isValidTicker, parseTicker };
