# Web stack decision — native + Jina (bukan 9Router)

**Tanggal:** 2026-07-09  
**Proyek:** ihsg-market-bot  
**Status:** diimplementasikan di kode (`lib/web-*.js`, hybrid native-first)

---

## 1. Apa usecase skill 9Router web-search / web-fetch?

Dari skill docs decolua/9router:

| Skill | Endpoint | Isi |
|-------|----------|-----|
| **web-search** | `POST $NINEROUTER_URL/v1/search` | Satu body `{ model, query, max_results, search_type… }` ke banyak provider (Tavily, Exa, Brave, Serper, SearXNG, Google PSE, Linkup, SearchAPI, You.com, Perplexity). Response: `results[]` dengan title/url/snippet + usage/cost. |
| **web-fetch** | `POST $NINEROUTER_URL/v1/web/fetch` | Satu body `{ model, url, format, max_characters }` ke Firecrawl / Jina Reader / Tavily Extract / Exa. Response: markdown/text + metadata. |

**Usecase yang cocok untuk 9Router:**

- Satu gateway untuk **banyak paid search/fetch provider** + auto combo fallback.
- Ops multi-key, billing terpusat, discovery `/v1/models/web`.
- Agent skill yang ingin “satu API” tanpa tahu quirk Tavily vs Brave.

**Untuk bot IHSG personal (free-first, 1 user):**

- Overkill: butuh NINEROUTER_URL + key + provider keys di belakangnya.
- `/v1/models/web` di setup kita sering kosong; search/fetch 401 dengan key dummy.
- Pola body/response-nya bagus untuk **ditiru**, tapi transport lewat 9Router **tidak wajib**.

**Keputusan:** **tidak pakai 9Router** untuk search/fetch. Tiru bentuk docs (query→hits, url→markdown, layer label, soft-fail), implement langsung ke native model tools + Jina + News RSS.

---

## 2. Opsi fetch: native vs Jina — mana terbaik?

| Opsi | Kelebihan | Kelemahan | Verdict |
|------|-----------|-----------|---------|
| **Native model tools** (`web_search` / `google_search`) | Grounding bagus, citation, domain filter (xAI max 5), “pakai otak model” | Bukan full-page extract; tergantung gateway/model; biaya model | **Primary untuk search** saat FULL |
| **Native HTTP scrape** (server `GET` HTML) | Zero third party | CORS/bot block, HTML kotor, JS-rendered gagal | Hanya soft last-resort (`allowNativeRaw`) |
| **Jina Reader `r.jina.ai`** | Markdown LLM-friendly, cache, rate limit lebih tinggi dengan Bearer key (docs: ~500 RPM auth vs ~20 anon), JSON title+content | Token/quota Jina; latency ~detik | **Primary untuk page fetch** |
| **Jina Search `s.jina.ai`** | SERP + snippet/content, `gl=ID` | Butuh key untuk production RPM; fixed token cost per request | **Fallback search** setelah native |
| **Google News RSS** | Gratis, stabil | Snippet tipis, bukan full article | **Last resort** |

**Rekomendasi final:**

1. **Search:** native tools model dulu → Jina search → News RSS.  
2. **Fetch (deep dive):** **selalu Jina Reader + API key** (bukan native raw). Native raw hanya opsional jika Jina down.

Live check (2026-07-09) dengan key user: `r.jina.ai` + `s.jina.ai` HTTP 200, JSON content OK untuk `example.com` dan query `IHSG` / `BBCA`.

---

## 3. Arsitektur yang di-ship

```
FULL mode:
  [browser] hybridResearchSearch
    1) chatWithNativeWebSearch (xAI web_search / Gemini google_search / OpenAI-style)
    2) POST /api/web/research
         → s.jina.ai (Bearer JINA_API_KEY)
         → gap-fill Google News RSS
         → optional r.jina.ai top URLs (deep dive)
    3) extra news if still <2 hits

FALLBACK: skip native tools; Jina + news
DEGRADED: no web
```

**Key handling:**

- Server: gitignored `.env` → `JINA_API_KEY=…` (loadDotEnv di `server.js`)
- UI optional override: `jinaApiKey` di localStorage (field sidebar)
- **Jangan commit key ke repo publik**

**File utama:**

- `lib/web-core.js` — pure normalize / URL / layer label  
- `lib/web-client.js` — network Jina  
- `frontend/js/search/native-search.js` — hybrid order native-first  
- `server.js` — `/api/web/search|fetch|research`  
- Deprec: `lib/ninerouter-web-*.js` → re-export ke web-*  

---

## 4. Apakah layak mengubah kode?

**Ya** — dan sudah diganti:

| Sebelum | Sesudah |
|---------|---------|
| Primary 9Router `/v1/search` + `/v1/web/fetch` | Primary native tools |
| Jina free anon sebagai fetch fallback 9R | Jina auth primary untuk structured search/fetch |
| Native tools hanya jika hits sparse | Native dulu saat FULL |
| Key provider 9R di body endpoint | `JINA_API_KEY` env + optional UI |

**Tidak layak:** menambah dependency 9Router runtime, Firecrawl paid, multi-provider combo untuk 1 user personal.

---

## 5. Cara pakai (ops)

1. Pastikan `.env` lokal: `JINA_API_KEY=jina_…` (sudah di gitignore).  
2. `npm run dev` → server load key.  
3. UI: model research = Grok/Gemini untuk FULL native; search mode Auto/FULL.  
4. Deep dive: `fetchPages` lewat orchestrate → Jina Reader.  
5. `npm test` — unit + live Jina (butuh network + key).

---

## 6. Sumber docs

- 9Router skills: `9router-web-search`, `9router-web-fetch` (raw GitHub decolua/9router)  
- Jina Reader: https://jina.ai/reader/ — `https://r.jina.ai/{url}`, header `Authorization: Bearer`  
- Jina Search: https://s.jina.ai/?q=…  
- xAI / Gemini native tools: sudah di `native-search.js` comments  
