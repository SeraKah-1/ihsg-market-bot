# SPEC — IHSG Market Bot v1 (personal)

## Goals
- On-demand IHSG situational briefing
- Valid hard data + auditable hypotheses
- Follow-money stance; anti exit-liquidity; no AI loss-aversion

## Non-goals
- Real-time trading, auto orders, production SLA, calibrated probability guarantee

## Pipeline
1. Ingest all (or max) IDX tickers via Yahoo → cache by day  
2. Features + shortlist K  
3. Search FULL|FALLBACK|DEGRADED  
   - **FULL**: native model tools first (xAI `web_search` / Gemini `google_search`) → Jina `s.jina.ai` → Google News RSS  
   - **Fetch pages** (deep dive): Jina Reader `r.jina.ai` (Bearer key preferred; not 9Router)  
4. Research → Fear ‖ Positive → Judge JSON  
5. Stance rules (code) patch  
6. Save run + compact memory  
7. Render HTML / export  

## Web stack (own, not 9Router)
- Server: `lib/web-client.js` + `lib/web-core.js`; routes `/api/web/search|fetch|research`
- Key: `JINA_API_KEY` in gitignored `.env`, optional UI override `jinaApiKey`
- 9Router `/v1/search` + `/v1/web/fetch` intentionally **not** used  

## Deep dive — Option C (agentic)
- **No** pre-scrape Jina page fetch for deep dive.
- FULL: multi-round agentic loop (`frontend/js/search/agentic-web.js`) with native `web_search` / `google_search` + reasoning params cascade.
- Model **chooses queries dynamically** from hard price/context anomalies (not fixed 8-query list).
- Prefer Research model with tools (Grok/Gemini); reasoning effort auto high/medium when model looks reasoning.
- FALLBACK/failure: seed queries + Jina/news pack → `chatJson` synthesize (still no page fetch).  



## Success metrics
- Metrics in JSON match code source  
- Cache hit re-run fast  
- High exit-liq never aggressionAllowed  
- Search mode labeled honestly  
