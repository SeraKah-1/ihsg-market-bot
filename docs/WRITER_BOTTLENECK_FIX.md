# Writer bottleneck fix + report redesign

## Root cause
Research & Analysis worked; Writer appeared to never send a request because:

1. **After Analysis**, pipeline awaited Firebase `setDoc` of a **huge** analysis pack (full indicators JSON for every ticker). Firebase hang/slow = Writer never starts.
2. Pipeline **re-loaded** analysis from Firebase/IDB before Writer (extra round-trip).
3. Writer system prompt embedded a **giant schema** + full analysis draft → payload too large; browser sometimes never completed `JSON.stringify`/fetch setup cleanly; routers choke.
4. No per-request timeout/logging on chat path → looked like “no request”.

## Fix
- `saveAgentStep`: local+IDB first; Firebase/server **fire-and-forget** (default).
- Use **in-memory** research/analysis for next agent (no Firebase load before Writer).
- `compactAnalysisForDownstream`: aggressive strip (no indicators blob).
- Writer: **slim user pack** (~few KB), short schema hint, `reasoningEffort: medium`, `timeoutMs: 90s`.
- `chatJson`/`chatCompleteOnce`: size caps, request log (`LLM request →`), timeout signal, drop `response_format` if rejected.

## Report UI
- Anthropic×xAI aesthetic: warm paper / deep stone, Instrument Serif hero, airy cards.
- Export HTML button in hero + topbar; standalone HTML with CSS + embedded JSON.

## Expected logs
```
Analysis done lean=… → local saved → Writer (no remote wait)
Writer handoff ready · compact≈NKB
→ Writer agent starting (chat/completions)
Writer START model=…
Writer payload ready · ~NKB
chatJson start · …
LLM request → model · ~NKB
LLM OK · …
Writer done · headline=…
```
