/**
 * Normalize IDX ticker codes for deep dive / API.
 * Accepts: "bbca", "BBCA.JK", " IDX:BBCA ", "BBCA JK", etc.
 */

/** Strip noise → pure code candidates */
export function normalizeTicker(raw) {
  let s = String(raw ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width
    .trim();

  // quotes / brackets
  s = s.replace(/^["'`\[\(]+|[\]\)"'`]+$/g, "").trim();

  // common prefixes
  s = s.replace(/^(IDX|YAHOO|SYMBOL|TICKER|KODE)\s*[:#.\-\s]+/i, "").trim();

  // Yahoo / exchange suffixes
  s = s
    .replace(/\.JK\b/gi, "")
    .replace(/\.JS\b/gi, "")
    .replace(/:JK\b/gi, "")
    .replace(/\s+JK\b/gi, "")
    .trim();

  // take first token if "BBCA Bank Central..." or "BBCA, ADRO"
  const first = s.split(/[\s,;/|]+/).filter(Boolean)[0] || "";
  s = first;

  // keep only A–Z (IDX codes are letters; drop digits/noise)
  s = s.replace(/[^A-Z]/g, "");

  return s;
}

/**
 * IDX-ish code: 2–6 letters (kebanyakan 4; longgar agar tidak false-reject).
 */
export function isValidTicker(code) {
  return typeof code === "string" && /^[A-Z]{2,6}$/.test(code);
}

/**
 * @returns {{ ok: true, ticker: string } | { ok: false, ticker: string, error: string }}
 */
export function parseTicker(raw) {
  const ticker = normalizeTicker(raw);
  if (!ticker) {
    return {
      ok: false,
      ticker: "",
      error: "Ticker kosong — isi kode emiten (contoh BBCA) atau pilih dari daftar."
    };
  }
  if (!isValidTicker(ticker)) {
    return {
      ok: false,
      ticker,
      error: `Ticker tidak valid: "${String(raw ?? "").slice(0, 40)}" → "${ticker}" (butuh 2–6 huruf, contoh BBCA / ADRO).`
    };
  }
  return { ok: true, ticker };
}
