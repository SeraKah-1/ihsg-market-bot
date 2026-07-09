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

1. Authentication → Sign-in method → **Google** = Enable
2. Authorized domains: `localhost` (+ production host)
3. Firestore database **market** exists (nam5)
4. Deploy rules (`firestore.rules`) ke database market
5. Hard-refresh → login Google → log: `Firebase memory OK · Google=…`

## Offline PWA

- Service worker: `/sw.js` (shell + JS)
- IndexedDB: runs, agent steps, last briefing HTML
- Tombol **Resume** jika run gagal/abort (lanjut dari research/analysis/writer)
- Tombol **Lanjut offline** di auth screen: pakai app tanpa sync cloud
