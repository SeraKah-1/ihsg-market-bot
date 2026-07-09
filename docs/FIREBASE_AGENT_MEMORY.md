# Firebase agent memory bus (DB `market`)

## Kenapa briefing jelek / Analysis gagal

Log tipikal:
1. Researcher agentic 6 round → non-JSON dump → salvage findings=1
2. Analysis clarify + chatComplete besar → **Failed to fetch** (timeout/payload)
3. Writer ikut gagal → heuristic kosong insight

Bukan cuma UI: **handoff agent lewat RAM saja** + payload oversized + router drop.

## Fix

1. **Firebase DB `market`** (project mikirexpayin) — tiap agent save/load.
2. Path: `users/{uid}/ihsg_runs/{runId}/agents/{step}`
3. Compact research/analysis sebelum agent berikutnya (hindari Failed to fetch).
4. Retry network di `chatComplete`; cap message 100k chars.
5. Researcher finalize JSON setelah salvage thin.
6. Analysis skip clarify web kalau research sudah cukup findings.

## Setup Console

1. Authentication → Sign-in method → **Anonymous** = Enable
2. Firestore database **market** exists (nam5)
3. Deploy rules (`firestore.rules`) ke database market
4. Hard-refresh app → log: `Firebase memory OK · db=market`

## Offline

Tanpa auth: localStorage + `/api/memory` + `/api/runs` tetap jalan.
