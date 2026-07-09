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
4. Research → Fear ‖ Positive → Judge JSON  
5. Stance rules (code) patch  
6. Save run + compact memory  
7. Render HTML / export  

## Success metrics
- Metrics in JSON match code source  
- Cache hit re-run fast  
- High exit-liq never aggressionAllowed  
- Search mode labeled honestly  
