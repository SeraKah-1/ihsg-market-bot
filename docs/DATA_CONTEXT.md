# Data context for AI (GIGO, pragmatic)

## Hidden meaning

User wants the model to **understand market situation**, not only “hari ini naik/turun”.

| Surface request | Real need |
|-----------------|-----------|
| Banyak indikator | Compact **state vector** the LLM can actually use |
| 1d / 1w / 1m / slope / HH-HL | Trend + structure without chart image |
| IHSG regime | Conditioning: stock moves **in a market context** |
| Fetch models / tickers | Operational hygiene (no wrong ids / stale universe) |

**Bridge:** code computes a small pack → AI narrates / judges. AI does **not** invent RSI/MACD.

## Included (features-v1)

Per series (stock or IHSG):

- **d1:** retPct, rvol  
- **w1 / m1:** retPct, slopeDeg (regression tilt), structure (`HH_HL`, `LH_LL`, …)  
- **y1:** on IHSG (+ indexes)  
- **vol:** ATR%, realized vol ann., volumeTrend  
- **vsIhsg:** excess ret 1w / 1m  

**marketRegime:** rule tag from IHSG (risk_on / risk_off / high_vol_chop / …)

## Explicitly cut (anti-overengineering)

MACD, multi-RSI, Ichimoku, orderbook, full broker flow, level-2, 50+ factors.

## Ops

- Force refresh after deploy: `GET /api/market/ohlcv?force=1`  
- Models: UI **Fetch models** → `{endpoint}/models`  
- Tickers: UI **Fetch / refresh tickers** → validate Yahoo + optional seeds  
