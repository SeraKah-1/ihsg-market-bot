/**
 * Human-readable meanings for hard metrics (code facts → bahasa orang).
 * Dipakai di shortlist UI + HTML report agar angka tidak “numerik tanpa makna”.
 */

export function glossRvol(rvol) {
  if (rvol == null || Number.isNaN(Number(rvol))) {
    return { label: "Volume relatif", value: "—", tone: "neutral", meaning: "Data volume belum ada." };
  }
  const v = Number(rvol);
  let tone = "neutral";
  let meaning;
  if (v >= 1.8) {
    tone = "up";
    meaning = "Volume jauh di atas rata-rata — banyak orang ikut; cek apakah arah harga mendukung atau climax.";
  } else if (v >= 1.2) {
    tone = "up";
    meaning = "Volume hidup — ada partisipasi, bukan tape sepi.";
  } else if (v >= 0.7) {
    tone = "neutral";
    meaning = "Volume biasa — pergerakan tidak “panas”.";
  } else if (v >= 0.35) {
    tone = "down";
    meaning = "Volume lemah — naik/turun tipis, mudah digoyang.";
  } else {
    tone = "down";
    meaning = "Volume sangat sepi — risiko jadi exit liquidity tinggi jika ngejar.";
  }
  return { label: "Volume relatif (RVOL)", value: fmt(v) + "×", tone, meaning };
}

export function glossChangePct(pct, horizon = "1 hari") {
  if (pct == null || Number.isNaN(Number(pct))) {
    return { label: `Return ${horizon}`, value: "—", tone: "neutral", meaning: "—" };
  }
  const v = Number(pct);
  const tone = v > 0 ? "up" : v < 0 ? "down" : "neutral";
  let meaning;
  if (Math.abs(v) < 0.5) meaning = `Hampir flat ${horizon} — tidak ada move berarti.`;
  else if (v >= 3) meaning = `Lonjakan kuat ${horizon}.`;
  else if (v <= -3) meaning = `Turun tajam ${horizon}.`;
  else if (v > 0) meaning = `Menghijau ${horizon}, skala moderat.`;
  else meaning = `Merah ${horizon}, skala moderat.`;
  return {
    label: `Return ${horizon}`,
    value: signed(v) + "%",
    tone,
    meaning
  };
}

export function glossZret(z) {
  if (z == null || Number.isNaN(Number(z))) {
    return { label: "Anomali harian (z)", value: "—", tone: "neutral", meaning: "—" };
  }
  const v = Number(z);
  const tone = Math.abs(v) >= 1.5 ? (v > 0 ? "up" : "down") : "neutral";
  let meaning;
  if (Math.abs(v) < 0.8) meaning = "Pergerakan harian masih dalam pola normal historis.";
  else if (v >= 1.5) meaning = "Lonjakan harian tidak biasa (anomali positif) — butuh alasan.";
  else if (v <= -1.5) meaning = "Jatuh harian tidak biasa (anomali negatif) — butuh alasan.";
  else meaning = "Sedikit di luar pola normal, belum ekstrem.";
  return { label: "Anomali harian (z)", value: signed(v), tone, meaning };
}

export function glossStructure(struct) {
  const s = String(struct || "").toUpperCase();
  const map = {
    HH_HL: {
      tone: "up",
      meaning: "Struktur naik: higher high + higher low — tren naik masih utuh."
    },
    LH_LL: {
      tone: "down",
      meaning: "Struktur lemah: lower high + lower low — tekanan jual berlanjut."
    },
    LL: { tone: "down", meaning: "Lower low — breakdown struktur, bearish short-term." },
    HH: { tone: "up", meaning: "Higher high — momentum bullish, cek volume konfirmasi." },
    HL: { tone: "up", meaning: "Higher low — pullback sehat di tren naik (jika volume OK)." },
    LH: { tone: "down", meaning: "Lower high — gagal buat puncak baru, waspada." },
    CONTRACT: { tone: "neutral", meaning: "Range menyempit / kontrak — tunggu breakout." },
    RANGE: { tone: "neutral", meaning: "Sideways — tidak ada tren jelas." }
  };
  const hit = map[s] || {
    tone: "neutral",
    meaning: s ? `Struktur: ${s}` : "Struktur chart belum terklasifikasi."
  };
  return {
    label: "Struktur chart",
    value: s || "—",
    tone: hit.tone,
    meaning: hit.meaning
  };
}

export function glossVolumeTrend(t) {
  const v = String(t || "").toLowerCase();
  if (v === "rising") {
    return {
      label: "Tren volume",
      value: "naik",
      tone: "up",
      meaning: "Partisipasi volume meningkat — move lebih “benar” jika searah harga."
    };
  }
  if (v === "falling") {
    return {
      label: "Tren volume",
      value: "turun",
      tone: "down",
      meaning: "Volume mengering — rally/jatuh kurang meyakinkan; hati-hati late chase."
    };
  }
  if (v === "flat") {
    return {
      label: "Tren volume",
      value: "datar",
      tone: "neutral",
      meaning: "Volume stabil, tidak ada lonjakan partisipasi."
    };
  }
  return { label: "Tren volume", value: v || "—", tone: "neutral", meaning: "Tren volume tidak jelas." };
}

export function glossRegime(tag) {
  const t = String(tag || "").toLowerCase();
  const map = {
    risk_on: { label: "Risk-on", meaning: "Pasar cenderung berani risk — beta & cyclicals lebih laku." },
    risk_off: { label: "Risk-off", meaning: "Pasar defensif — flight to safety, tekan high-beta." },
    chop: { label: "Chop", meaning: "Arah bolak-balik — whipsaw; ukuran posisi kecil." },
    high_vol_chop: {
      label: "Vol tinggi + chop",
      meaning: "Volatil tapi arah buram — mudah kena false break; prioritaskan liquidity & invalidation."
    },
    high_vol: { label: "Vol tinggi", meaning: "Gerak besar — opportunity + risiko exit-liq sama-sama naik." },
    trend_up: { label: "Tren naik", meaning: "Bias bullish indeks — ikut flow long lebih rasional." },
    trend_down: { label: "Tren turun", meaning: "Bias bearish indeks — short/defensive lebih cocok." }
  };
  const hit = map[t] || {
    label: tag || "—",
    meaning: "Regime dari code; pakai sebagai backdrop, bukan ramalan."
  };
  return {
    label: "Regime IHSG",
    value: hit.label,
    tone: t.includes("down") || t.includes("off") ? "down" : t.includes("on") || t.includes("up") ? "up" : "neutral",
    meaning: hit.meaning
  };
}

export function glossExcess(vs) {
  if (!vs) return { label: "vs IHSG", value: "—", tone: "neutral", meaning: "—" };
  const w = vs.excessRet1w;
  const m = vs.excessRet1m;
  const parts = [];
  if (w != null) parts.push(`1 minggu ${signed(w)}%`);
  if (m != null) parts.push(`1 bulan ${signed(m)}%`);
  const ref = m != null ? m : w;
  let tone = "neutral";
  let meaning = "Performa relatif terhadap indeks.";
  if (ref != null) {
    if (ref >= 5) {
      tone = "up";
      meaning = "Kalahkan IHSG jelas — relative strength kuat (bisa FOMO atau overextended).";
    } else if (ref <= -5) {
      tone = "down";
      meaning = "Kalah dari IHSG — underperform; butuh alasan fundamental/flow.";
    } else {
      meaning = "Gerak relatif sejalan dengan indeks (beta-ish).";
    }
  }
  return {
    label: "vs IHSG (excess)",
    value: parts.join(" · ") || "—",
    tone,
    meaning
  };
}

/**
 * Heuristic outlook if AI tidak mengisi: cerah | biasa | suram
 * Hanya dari price structure + volume — BUKAN pengganti lapkeu.
 */
export function heuristicPriceOutlook(stock) {
  const ctx = stock?.context || {};
  const m1 = ctx.m1?.retPct;
  const struct = String(ctx.m1?.structure || ctx.w1?.structure || "").toUpperCase();
  const rvol = stock?.metrics?.rvol ?? ctx.d1?.rvol;
  const volT = String(ctx.vol?.volumeTrend || "").toLowerCase();
  const exit = stock?.flowHints?.exitLiquidityHint || stock?.stance?.exitLiquidityRisk;

  if (exit === "high" && Number(rvol) < 0.4) {
    return {
      tag: "suram",
      basis: "price_liquidity",
      why: "Likuiditas tipis + risiko exit-liq tinggi — setup buruk untuk ngejar."
    };
  }
  if (struct === "HH_HL" && (m1 == null || m1 > 0) && Number(rvol) >= 1 && volT !== "falling") {
    return {
      tag: "cerah",
      basis: "price_structure",
      why: "Struktur naik utuh + volume mendukung — price tape constructive (bukan jaminan fundamental)."
    };
  }
  if (struct === "LH_LL" || struct === "LL" || (m1 != null && m1 < -8)) {
    return {
      tag: "suram",
      basis: "price_structure",
      why: "Struktur lemah / drawdown — price tape buram sampai reclaim."
    };
  }
  if (struct === "HH_HL" && volT === "falling" && Number(rvol) >= 1.5) {
    return {
      tag: "biasa",
      basis: "late_tape",
      why: "Masih struktur naik tapi volume mengering + spike — netral/was-was, bukan full FOMO."
    };
  }
  return {
    tag: "biasa",
    basis: "mixed",
    why: "Sinyal campuran — tidak cerah, tidak otomatis suram."
  };
}

/** Plain Indonesian bullets for a ticker from hard data (fallback if LLM empty). */
export function plainFromHard(stock) {
  const t = stock?.ticker || "?";
  const chg = stock?.metrics?.changePct;
  const rvol = stock?.metrics?.rvol;
  const why = (stock?.whySelected || []).join(", ") || "anomali/rank code";
  const out = heuristicPriceOutlook(stock);
  const r = glossRvol(rvol);
  const c = glossChangePct(chg, "hari ini");
  return {
    whatHappened: `${t}: ${c.value} hari ini, RVOL ${r.value}. Dipilih karena: ${why}.`,
    whyItMatters: `${r.meaning} ${glossStructure(stock?.context?.m1?.structure || stock?.context?.w1?.structure).meaning}`,
    whatToDo:
      out.tag === "suram"
        ? "Jangan ngejar. Tunggu struktur/volume membaik atau skip."
        : out.tag === "cerah"
          ? "Boleh pantau ikut flow dengan invalidation jelas; cek berita/lapkeu dulu."
          : "Watch dulu — butuh konfirmasi volume + katalis, jangan full size.",
    outlookTag: out.tag,
    outlookWhy: out.why
  };
}

export function plainMarketFromHard(pack) {
  const tag = pack?.marketRegime?.tag;
  const note = pack?.marketRegime?.note || "";
  const g = glossRegime(tag);
  const chg = pack?.ihsg?.changePct;
  const c = glossChangePct(chg, "IHSG hari ini");
  const breadth = pack?.breadth;
  const br =
    breadth?.total != null
      ? `Breadth ${breadth.adv ?? 0} naik / ${breadth.dec ?? 0} turun dari sampel.`
      : "";
  return {
    plainHeadline: `${c.meaning} Regime: ${g.value}. ${g.meaning}`,
    whatItMeans: [note, br, g.meaning].filter(Boolean).join(" "),
    macroBackdrop: "Cek global risk (US/Asia) + domestik; jangan anggap drop/naik IHSG otomatis fundamental.",
    nextActions: [
      "Baca shortlist per emiten: apa / kenapa / lakukan",
      "Prioritas: hindari exit-liq & tape sepi",
      "Kalau ikut flow: tulis invalidation dulu"
    ]
  };
}

export function outlookBadgeClass(tag) {
  const t = String(tag || "").toLowerCase();
  if (t === "cerah" || t === "positive" || t === "bull") return "up";
  if (t === "suram" || t === "fear" || t === "bear" || t === "negatif") return "down";
  return "neutral";
}

export function outlookLabel(tag) {
  const t = String(tag || "").toLowerCase();
  if (t === "cerah") return "Prospek cerah";
  if (t === "suram") return "Prospek suram";
  if (t === "biasa") return "Prospek biasa";
  return tag || "Prospek ?";
}

function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return String(Math.round(Number(n) * 100) / 100);
}
function signed(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const x = Math.round(Number(n) * 100) / 100;
  return (x > 0 ? "+" : "") + x;
}
