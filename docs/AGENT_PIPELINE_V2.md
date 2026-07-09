# Agent pipeline v2 — Researcher / Analysis / Verify

## Perubahan

Pipeline lama (Research → Fear ‖ Positive → Judge) diganti:

1. **Researcher** — nentuin query sendiri + `web_search` agentic (reasoning cascade, temp 0.65). Fallback Jina/news.
2. **Analysis** — satu otak full briefing (ganti Fear+Positive+Judge). Voice: pragmatic, witty, no fluff.
3. **Verify** — skeptis pragmatis (bukan overhate), optional web klarifikasi hole, patch draft.

## Reasoning + temperature

- Native Responses: `temperature` default **0.65**, reasoning **high→medium→low→off**.
- Semua agent `chatJson` / `chatComplete` sama.
- Repair JSON pakai temp 0.2 (bukan 0).

## Voice

Constitution: chat trader waras, boleh tajam/offensive soal setup jelek, larangan jargon-soup dan formal fluff.

## UI models

Dropdown: Researcher / Analysis / Verify (migrate dari Fear/Positive/Judge di localStorage).

## Report

Section "Analysis · Verify" mengganti Fear vs Positive. Field `verify.note` ditampilkan.
