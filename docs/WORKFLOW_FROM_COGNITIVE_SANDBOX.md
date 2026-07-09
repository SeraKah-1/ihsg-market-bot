# Workflow lessons from Cognitive Sandbox → IHSG Market Bot

Repo studied: `https://github.com/SeraKah-1/cognitive-sandbox`

## How CS designs multi-agent work

```
User intent
  → Architect / curriculum (plan units)
  → for each unit (small step):
        Generator (Student)  — stream content
        → Critic (Oracle)    — stream eval + VERDICT line
        → Memory update      — save after unit
        → next unit
  → Export
```

| Principle | Cognitive Sandbox | IHSG mapping |
|-----------|-------------------|--------------|
| **Small steps** | 1 subtopic × 1 phase per LLM call | Research → Analysis → Writer (3 steps); slim payloads each |
| **Stream custom router** | Always `stream: true` on `/v1/chat/completions` | Analysis/Writer now stream + SSE parse |
| **No hang params** | Custom path does **not** inject `reasoning_effort` unless model is a reasoning SKU | Plain `grok-4.5` → reason=off on chat; native search still uses Responses tools |
| **Memory after step** | Firestore after each unit; local mirror | IDB/local first; Firebase background |
| **Retry/rotation** | Model list + cooldown 60s | Reasoning cascade + timeout → lower effort |
| **Contract** | ROLE / INPUT / OUTPUT; machine line simple | JSON schema hint compact, not 100-line template |
| **UI** | Live stream log per unit | Activity log + per-agent status |

## Root cause of Analysis “timeout 120s”

1. IHSG used `stream: false` — CS never does this on custom routers.
2. IHSG injected `reasoning_effort=high` on plain Grok chat — CS only streams tokens; reasoning SKUs are keyword-gated.
3. One fat Analysis call waited for full JSON with no progressive bytes → browser/router idle timeout.

## Fixes applied

- `chatCompleteOnce`: **stream:true**, SSE accumulate (CS `callOpenRouterStream`).
- Reasoning params only if `modelLooksReasoning(model)`.
- Analysis/Writer: `reasoningEffort: "off"` on chat path + longer stream timeout.
- Timeout still cascades if reasoning SKU used.

## Expected logs (Analysis)

```
Analysis payload ready · ~NKB
chatComplete model=xai/grok-4.5 stream=true reason=off timeout=…
LLM request → … stream=true · reason=off
LLM stream… N chars   (optional)
LLM OK · … · sse
Analysis LLM OK lean=…
```
