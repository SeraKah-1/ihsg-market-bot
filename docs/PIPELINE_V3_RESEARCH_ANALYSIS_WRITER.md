# Pipeline v3 — Research · Analysis · Writer

## Agent roles

| Agent | Tugas | Web |
|-------|--------|-----|
| **Research** | Hunt komprehensif multi-angle (pasar, makro, per ticker multi-bucket) | Ya, agentic multi-round |
| **Analysis** | Thesis + **verifikasi**: crosscheck, hidden/deep context, missed items, residual doubts; optional clarify search | Ya (klarifikasi hole) |
| **Writer** | Presenter: narasi koheren, `presentation.*` untuk inject HTML | Tidak |

## Indikator vs narasi

- Angka/metrics **tidak** masuk prose.
- Code attach `indicators.market` + `indicators.tickers[T]` (JSON).
- HTML: card chip + `<pre>` JSON terpisah (`rpt-ind`).

## Writer presentation JSON

```json
{
  "presentation": {
    "kicker": "",
    "headline": "",
    "lede": "",
    "throughline": "",
    "punchline": "",
    "sections": [{"id":"","title":"","body":""}],
    "checklist": [],
    "closingNote": ""
  }
}
```

## Analysis meta (verifikasi)

```json
{
  "analysisMeta": {
    "crossChecks": [],
    "hiddenContext": [],
    "missedByResearch": [],
    "residualDoubts": [],
    "clarifications": [],
    "note": ""
  }
}
```

## Deep dive search

- maxRounds 7, coverage 10 bucket
- hybrid seed queries lebih banyak + page fetch limit 8

## UI models

Research / Analysis / Writer (migrate dari verify).
