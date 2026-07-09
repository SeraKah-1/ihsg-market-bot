# IHSG Market Bot (personal)

On-demand market insight for IDX/IHSG — **not** a trading bot.

- **Data first** (Yahoo chart, disk cache, all-universe scan in code)
- **AI only on shortlist** (Fear / Positive / Judge)
- **Stance:** follow the money · FOMO allowed · **no AI loss-aversion** · **never be exit liquidity**
- **JSON → HTML** report + download
- **Free-first**, local-first; Firebase mirror optional later

## Quick start

```bash
cd ihsg-market-bot
npm install
npm run dev
# open http://localhost:3010
```

1. Settings → custom router endpoint + API key  
2. **Data only** — ingest + shortlist (no LLM)  
3. **Run briefing** — research + multi-agent + report  
4. Download JSON / HTML  

For a **fast smoke test**, set **Max ingest** to `40`–`80` (0 = full universe ~600 tickers).

## Ports

| Service | Port |
|---------|------|
| App | 3010 |
| CORS proxy (standalone) | 8081 |

## Stance rules

| Condition | Result |
|-----------|--------|
| `exitLiquidityRisk = high` | `aggressionAllowed = false` always |
| Flow alive + not crowded | FOMO / follow-money OK |
| Judge default | Flow-first, not timid textbook |

## API (local)

- `GET /api/health`
- `GET /api/market/universe`
- `GET /api/market/ohlcv?day=&force=&max=`
- `GET /api/market/shortlist?k=&force=`
- `GET /api/search/ddg?q=`
- `POST /api/runs` · `GET /api/runs`
- `GET/POST /api/memory/compact`

## Firebase (agent memory bus)

Project **`mikirexpayin`**, Firestore database id **`market`** (not `sandboxcognitive`).

Each agent **saves** its pack, next agent **loads** it (Cognitive Sandbox style):

```
users/{uid}/ihsg_runs/{runId}
users/{uid}/ihsg_runs/{runId}/agents/{research|analysis|writer|deep_dive}
users/{uid}/ihsg_compact/{autoId}
```

Auth: **Anonymous** (enable in Firebase Console → Authentication → Sign-in method).  
Rules: see `firestore.rules` (user-scoped). Deploy to the **market** database.

Fallback: `localStorage` + `POST /api/runs` + `/api/memory/compact` if Firebase auth/rules fail.

## Tests

```bash
npm test
```
