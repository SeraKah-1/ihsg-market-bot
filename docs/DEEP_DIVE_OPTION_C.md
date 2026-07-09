# Deep dive Option C — agentic native + reasoning

**Tanggal:** 2026-07-09  
**Status:** implemented

## Goal
Model **reasoning** memutuskan sendiri apa yang harus di-search (dinamis), lewat native tools — **bukan** daftar query kaku + Jina page-fetch.

## Flow
```
runDeepDive(ticker)
  → hard data /api/market/ticker/:t
  → searchMode FULL?
       YES → runAgenticNativeLoop
              · tools: web_search | google_search (unrestricted for deep dive)
              · reasoning effort cascade high→medium→low→off
              · round 1–2: intermediate findings/gaps/next_queries
              · early final if status=done
              · final: deep_dive JSON schema
       NO / fail → hybrid pack (Jina search + news, no fetchPages)
              → chatJson synthesize
```

## Files
- `frontend/js/search/agentic-web.js` — multi-round loop
- `frontend/js/search/reasoning.js` — effort detect + body inject + cascade
- `frontend/js/search/native-search.js` — `reasoningEffort` on tool calls
- `frontend/js/agents/deep-dive.js` — Option C entry + fallback
- `frontend/js/orchestrate.js` — no pre-hybrid fetch

## Model tips
- Set **Research** (dan idealnya Judge) ke Grok / Gemini / o-series yang support tools.
- Reasoning keywords di settings: `qwen, deepseek-r1, o1, o3, …`  
- Search mode **FULL** atau **Auto** (auto = FULL jika model native-capable).

## What we dropped for deep dive
- Pre-run fixed 8 queries + `fetchPages: true` Jina Reader  
- Agent blind `chatJson` that only reads pageContents  

Jina search remains **fallback pack only**, not primary deep path.
