/**
 * Shared report CSS — structured, readable, works in-app + export.
 * Forces layout isolation so app chrome styles cannot scramble report.
 */
export const REPORT_CSS = `
/* Scope everything under .rpt to avoid style bleed */
.rpt {
  --r-bg: #f7f4ec;
  --r-card: #fffcf7;
  --r-ink: #1c1917;
  --r-ink2: #44403c;
  --r-ink3: #78716c;
  --r-line: rgba(28,25,23,.12);
  --r-accent: #9a6b3f;
  --r-up: #1f6b45;
  --r-down: #b42318;
  --r-warn: #a16207;
  --r-soft: rgba(154,107,63,.1);
  --r-up-bg: rgba(31,107,69,.08);
  --r-down-bg: rgba(180,35,24,.08);
  --r-serif: "Instrument Serif", Georgia, serif;
  --r-sans: Inter, system-ui, sans-serif;
  --r-mono: "IBM Plex Mono", ui-monospace, monospace;
  --r-radius: 12px;
  font-family: var(--r-sans) !important;
  color: var(--r-ink) !important;
  background: var(--r-bg) !important;
  line-height: 1.55 !important;
  font-size: 15px !important;
  letter-spacing: normal !important;
  text-align: left !important;
  -webkit-font-smoothing: antialiased;
}

html.dark-mode .rpt,
.rpt.rpt-dark {
  --r-bg: #1c1917;
  --r-card: #292524;
  --r-ink: #faf7f2;
  --r-ink2: #e7e5e4;
  --r-ink3: #a8a29e;
  --r-line: rgba(250,247,242,.12);
  --r-accent: #d4a574;
  --r-up: #6bbf8a;
  --r-down: #f07178;
  --r-warn: #e0b45c;
  --r-soft: rgba(212,165,116,.14);
  --r-up-bg: rgba(107,191,138,.12);
  --r-down-bg: rgba(240,113,120,.12);
}

.rpt * { box-sizing: border-box; }

.rpt-wrap {
  max-width: 880px;
  margin: 0 auto;
  padding: 0.25rem 0 2rem;
}

.rpt h1, .rpt h2, .rpt h3, .rpt h4 {
  font-family: var(--r-serif) !important;
  font-weight: 400 !important;
  color: var(--r-ink) !important;
  letter-spacing: -0.02em !important;
  line-height: 1.25 !important;
  margin: 0 !important;
}

.rpt p, .rpt li, .rpt dd, .rpt td, .rpt th {
  font-family: var(--r-sans) !important;
  color: inherit;
}

.rpt-head {
  padding: 1.5rem 1.35rem;
  border: 1px solid var(--r-line);
  border-radius: var(--r-radius);
  background: var(--r-card);
  margin-bottom: 1rem;
}

.rpt-kicker {
  margin: 0 0 0.35rem !important;
  font-size: 0.68rem !important;
  font-weight: 700 !important;
  letter-spacing: 0.14em !important;
  text-transform: uppercase !important;
  color: var(--r-accent) !important;
  font-family: var(--r-sans) !important;
}

.rpt-head h1 {
  font-size: clamp(1.5rem, 3.5vw, 2rem) !important;
  margin-bottom: 0.75rem !important;
}

.rpt-badges {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 0.4rem !important;
  margin: 0.65rem 0 !important;
}

.rpt-badge {
  display: inline-flex !important;
  align-items: center !important;
  padding: 0.28rem 0.65rem !important;
  border-radius: 999px !important;
  font-size: 0.68rem !important;
  font-weight: 700 !important;
  letter-spacing: 0.04em !important;
  text-transform: uppercase !important;
  border: 1px solid var(--r-line) !important;
  background: var(--r-soft) !important;
  color: var(--r-accent) !important;
  font-family: var(--r-sans) !important;
  white-space: nowrap !important;
}

.rpt-badge.up { background: var(--r-up-bg) !important; color: var(--r-up) !important; }
.rpt-badge.down { background: var(--r-down-bg) !important; color: var(--r-down) !important; }
.rpt-badge.neutral { background: transparent !important; color: var(--r-ink2) !important; }

.rpt-meta {
  margin: 0.35rem 0 0 !important;
  font-family: var(--r-mono) !important;
  font-size: 0.78rem !important;
  color: var(--r-ink3) !important;
  line-height: 1.45 !important;
  word-break: break-word !important;
}

.rpt-section {
  border: 1px solid var(--r-line);
  border-radius: var(--r-radius);
  background: var(--r-card);
  margin-bottom: 0.75rem;
  overflow: hidden;
}

.rpt-section > summary {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 0.75rem !important;
  padding: 0.95rem 1.15rem !important;
  cursor: pointer !important;
  list-style: none !important;
  font-weight: 650 !important;
  font-size: 0.95rem !important;
  font-family: var(--r-sans) !important;
  color: var(--r-ink) !important;
  user-select: none !important;
}

.rpt-section > summary::-webkit-details-marker { display: none !important; }

.rpt-section > summary::after {
  content: "▾" !important;
  color: var(--r-ink3) !important;
  font-size: 0.85rem !important;
  flex-shrink: 0 !important;
}

.rpt-section[open] > summary::after { content: "▴" !important; }

.rpt-section > summary:hover { background: var(--r-soft); }

.rpt-body {
  padding: 0 1.15rem 1.15rem !important;
  border-top: 1px solid var(--r-line);
  color: var(--r-ink2) !important;
  font-size: 0.92rem !important;
}

.rpt-body > :first-child { margin-top: 0.9rem !important; }

.rpt-lead {
  margin: 0.9rem 0 0 !important;
  color: var(--r-ink) !important;
  font-size: 0.95rem !important;
  line-height: 1.6 !important;
}

.rpt-grid-2 {
  display: grid !important;
  grid-template-columns: 1fr !important;
  gap: 0.65rem !important;
  margin-top: 0.85rem !important;
}

@media (min-width: 640px) {
  .rpt-grid-2 { grid-template-columns: 1fr 1fr !important; }
}

.rpt-panel {
  border: 1px solid var(--r-line);
  border-radius: 10px;
  padding: 0.85rem 0.95rem;
  background: var(--r-bg);
}

.rpt-panel h4 {
  font-family: var(--r-sans) !important;
  font-size: 0.72rem !important;
  font-weight: 700 !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  color: var(--r-ink3) !important;
  margin: 0 0 0.45rem !important;
}

.rpt-panel p {
  margin: 0 !important;
  color: var(--r-ink2) !important;
  font-size: 0.88rem !important;
  line-height: 1.55 !important;
}

/* Definition list — fixed columns, no scramble */
.rpt-kv {
  display: grid !important;
  grid-template-columns: 7.25rem minmax(0, 1fr) !important;
  gap: 0.55rem 0.85rem !important;
  margin: 0.85rem 0 0 !important;
  align-items: start !important;
}

.rpt-kv dt {
  margin: 0 !important;
  padding-top: 0.1rem !important;
  font-size: 0.68rem !important;
  font-weight: 700 !important;
  letter-spacing: 0.06em !important;
  text-transform: uppercase !important;
  color: var(--r-ink3) !important;
  font-family: var(--r-sans) !important;
}

.rpt-kv dd {
  margin: 0 !important;
  color: var(--r-ink2) !important;
  font-size: 0.9rem !important;
  line-height: 1.5 !important;
  min-width: 0 !important;
  word-break: break-word !important;
}

/* Horizon metrics table */
.rpt-table {
  width: 100% !important;
  border-collapse: collapse !important;
  margin-top: 0.75rem !important;
  font-size: 0.84rem !important;
}

.rpt-table th,
.rpt-table td {
  text-align: left !important;
  padding: 0.55rem 0.5rem !important;
  border-bottom: 1px solid var(--r-line) !important;
  vertical-align: top !important;
  font-family: var(--r-sans) !important;
}

.rpt-table th {
  color: var(--r-ink3) !important;
  font-size: 0.68rem !important;
  font-weight: 700 !important;
  letter-spacing: 0.06em !important;
  text-transform: uppercase !important;
  white-space: nowrap !important;
}

.rpt-table td.num {
  font-family: var(--r-mono) !important;
  font-variant-numeric: tabular-nums !important;
  white-space: nowrap !important;
}

.rpt-table .up { color: var(--r-up) !important; font-weight: 600 !important; }
.rpt-table .down { color: var(--r-down) !important; font-weight: 600 !important; }

.rpt-chips {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 0.35rem !important;
  margin: 0 !important;
  padding: 0 !important;
  list-style: none !important;
}

.rpt-chip {
  display: inline-flex !important;
  align-items: center !important;
  padding: 0.2rem 0.5rem !important;
  border-radius: 999px !important;
  font-size: 0.7rem !important;
  font-weight: 600 !important;
  border: 1px solid var(--r-line) !important;
  background: var(--r-bg) !important;
  color: var(--r-ink2) !important;
  font-family: var(--r-sans) !important;
  white-space: nowrap !important;
}

.rpt-chip.up { background: var(--r-up-bg) !important; color: var(--r-up) !important; }
.rpt-chip.down { background: var(--r-down-bg) !important; color: var(--r-down) !important; }
.rpt-chip.warn { background: rgba(161,98,7,.12) !important; color: var(--r-warn) !important; }

.rpt-card {
  border: 1px solid var(--r-line);
  border-radius: var(--r-radius);
  background: var(--r-bg);
  padding: 1.1rem 1.15rem;
  margin-top: 0.75rem;
}

.rpt-card:first-child { margin-top: 0.9rem; }

.rpt-card-head {
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 0.5rem 0.75rem !important;
  margin-bottom: 0.75rem !important;
  padding-bottom: 0.75rem !important;
  border-bottom: 1px solid var(--r-line) !important;
}

.rpt-card-head h3 {
  font-family: var(--r-mono) !important;
  font-size: 1.1rem !important;
  font-weight: 600 !important;
  letter-spacing: 0 !important;
}

.rpt-card-metrics {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 0.65rem 1rem !important;
  font-family: var(--r-mono) !important;
  font-size: 0.82rem !important;
  font-variant-numeric: tabular-nums !important;
}

.rpt-card-metrics .up { color: var(--r-up) !important; font-weight: 600 !important; }
.rpt-card-metrics .down { color: var(--r-down) !important; font-weight: 600 !important; }

/* Metric tiles — each number separated, labeled, colored */
.rpt-metrics {
  display: grid !important;
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  gap: 0.55rem !important;
  margin: 0.85rem 0 0 !important;
}
@media (min-width: 560px) {
  .rpt-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
}
@media (min-width: 800px) {
  .rpt-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
}

.rpt-metric {
  border: 1px solid var(--r-line) !important;
  border-radius: 10px !important;
  padding: 0.65rem 0.7rem !important;
  background: var(--r-card) !important;
  min-width: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 0.2rem !important;
}

.rpt-metric .m-lab {
  font-size: 0.62rem !important;
  font-weight: 700 !important;
  letter-spacing: 0.07em !important;
  text-transform: uppercase !important;
  color: var(--r-ink3) !important;
  font-family: var(--r-sans) !important;
  line-height: 1.25 !important;
}

.rpt-metric .m-val {
  font-family: var(--r-mono) !important;
  font-size: 1.05rem !important;
  font-weight: 600 !important;
  font-variant-numeric: tabular-nums !important;
  color: var(--r-ink) !important;
  line-height: 1.2 !important;
  word-break: break-word !important;
}

.rpt-metric .m-val.up { color: var(--r-up) !important; }
.rpt-metric .m-val.down { color: var(--r-down) !important; }

.rpt-metric .m-hint {
  font-size: 0.72rem !important;
  color: var(--r-ink3) !important;
  line-height: 1.35 !important;
  font-family: var(--r-sans) !important;
  margin-top: 0.15rem !important;
}

/* Plain language blocks: Apa / Kenapa / Lakukan */
.rpt-qa {
  display: grid !important;
  gap: 0.55rem !important;
  margin: 0.9rem 0 0 !important;
}

.rpt-qa-item {
  border-left: 3px solid var(--r-accent) !important;
  padding: 0.55rem 0.75rem 0.55rem 0.85rem !important;
  background: var(--r-soft) !important;
  border-radius: 0 8px 8px 0 !important;
}

.rpt-qa-item.do { border-left-color: var(--r-up) !important; }
.rpt-qa-item.warn { border-left-color: var(--r-warn) !important; }
.rpt-qa-item.danger { border-left-color: var(--r-down) !important; }

.rpt-qa-item .q {
  font-size: 0.65rem !important;
  font-weight: 700 !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  color: var(--r-ink3) !important;
  margin: 0 0 0.25rem !important;
  font-family: var(--r-sans) !important;
}

.rpt-qa-item .a {
  margin: 0 !important;
  font-size: 0.9rem !important;
  color: var(--r-ink) !important;
  line-height: 1.55 !important;
}

.rpt-callout {
  margin: 0.85rem 0 0 !important;
  padding: 0.85rem 1rem !important;
  border-radius: 10px !important;
  border: 1px solid var(--r-line) !important;
  background: var(--r-bg) !important;
}

.rpt-callout.cerah {
  border-color: rgba(31,107,69,.35) !important;
  background: var(--r-up-bg) !important;
}
.rpt-callout.suram {
  border-color: rgba(180,35,24,.35) !important;
  background: var(--r-down-bg) !important;
}
.rpt-callout.biasa {
  border-color: var(--r-line) !important;
}

.rpt-callout .co-title {
  font-size: 0.7rem !important;
  font-weight: 700 !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  margin: 0 0 0.35rem !important;
  color: var(--r-ink3) !important;
  font-family: var(--r-sans) !important;
}

.rpt-callout .co-body {
  margin: 0 !important;
  font-size: 0.9rem !important;
  color: var(--r-ink) !important;
  line-height: 1.5 !important;
}

.rpt-divider {
  height: 1px !important;
  background: var(--r-line) !important;
  margin: 1rem 0 !important;
  border: 0 !important;
}

.rpt-actions {
  margin: 0.75rem 0 0 !important;
  padding-left: 1.2rem !important;
  color: var(--r-ink) !important;
}
.rpt-actions li {
  margin: 0.4rem 0 !important;
  line-height: 1.5 !important;
  font-size: 0.9rem !important;
}

.rpt-subh {
  margin: 1rem 0 0.4rem !important;
  font-family: var(--r-sans) !important;
  font-size: 0.7rem !important;
  font-weight: 700 !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  color: var(--r-ink3) !important;
}

.rpt-scenarios {
  display: grid !important;
  grid-template-columns: 1fr !important;
  gap: 0.55rem !important;
  margin-top: 0.85rem !important;
}

@media (min-width: 640px) {
  .rpt-scenarios { grid-template-columns: repeat(3, 1fr) !important; }
}

.rpt-sc {
  border: 1px solid var(--r-line);
  border-radius: 10px;
  padding: 0.7rem 0.8rem;
  background: var(--r-card);
  min-height: 100%;
}

.rpt-sc .lab {
  font-size: 0.65rem !important;
  font-weight: 700 !important;
  letter-spacing: 0.1em !important;
  text-transform: uppercase !important;
  color: var(--r-ink3) !important;
  margin: 0 0 0.35rem !important;
  font-family: var(--r-sans) !important;
}

.rpt-sc .body {
  margin: 0 !important;
  font-size: 0.84rem !important;
  color: var(--r-ink2) !important;
  line-height: 1.45 !important;
}

/* Indicator vault — numbers only, separate from narrative */
.rpt-ind {
  margin: 0.85rem 0 0.5rem !important;
  border: 1px dashed var(--r-line) !important;
  border-radius: 10px !important;
  background: var(--r-soft) !important;
  overflow: hidden !important;
}
.rpt-ind > summary {
  cursor: pointer !important;
  list-style: none !important;
  padding: 0.55rem 0.75rem !important;
  font-size: 0.78rem !important;
  font-weight: 600 !important;
  letter-spacing: 0.04em !important;
  text-transform: uppercase !important;
  color: var(--r-ink3) !important;
  font-family: var(--r-sans) !important;
}
.rpt-ind > summary::-webkit-details-marker { display: none !important; }
.rpt-ind[open] > summary { border-bottom: 1px solid var(--r-line) !important; }
.rpt-ind-body { padding: 0.65rem 0.75rem 0.85rem !important; }
.rpt-ind-chips {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 0.35rem !important;
  margin: 0 0 0.65rem !important;
  padding: 0 !important;
  list-style: none !important;
}
.rpt-ind-chip {
  display: inline-flex !important;
  align-items: baseline !important;
  gap: 0.3rem !important;
  padding: 0.28rem 0.5rem !important;
  border-radius: 8px !important;
  background: var(--r-card) !important;
  border: 1px solid var(--r-line) !important;
  font-family: var(--r-mono) !important;
  font-size: 0.78rem !important;
}
.rpt-ind-chip .k { color: var(--r-ink3) !important; font-size: 0.68rem !important; text-transform: uppercase !important; }
.rpt-ind-chip .v { font-weight: 600 !important; color: var(--r-ink) !important; }
.rpt-ind-chip.up .v { color: var(--r-up) !important; }
.rpt-ind-chip.down .v { color: var(--r-down) !important; }
.rpt-ind-chip.warn .v { color: var(--r-warn) !important; }
.rpt-ind-json {
  margin: 0 !important;
  padding: 0.65rem 0.75rem !important;
  border-radius: 8px !important;
  background: rgba(0,0,0,.04) !important;
  border: 1px solid var(--r-line) !important;
  font-family: var(--r-mono) !important;
  font-size: 0.72rem !important;
  line-height: 1.45 !important;
  overflow-x: auto !important;
  color: var(--r-ink2) !important;
  max-height: 280px !important;
}
html.dark-mode .rpt-ind-json,
.rpt.rpt-dark .rpt-ind-json {
  background: rgba(0,0,0,.25) !important;
}
.rpt-lede {
  font-size: 1.02rem !important;
  color: var(--r-ink2) !important;
  margin: 0 0 0.85rem !important;
  line-height: 1.6 !important;
}
.rpt-insight {
  font-family: var(--r-serif) !important;
  font-size: 1.15rem !important;
  color: var(--r-accent) !important;
  margin: 0.5rem 0 1rem !important;
  padding: 0.65rem 0.85rem !important;
  border-left: 3px solid var(--r-accent) !important;
  background: var(--r-soft) !important;
  border-radius: 0 8px 8px 0 !important;
}
.rpt-story {
  font-size: 1.02rem !important;
  line-height: 1.65 !important;
  color: var(--r-ink) !important;
  margin: 0 0 0.85rem !important;
}
.rpt-chain {
  margin: 0.5rem 0 0 !important;
  padding-left: 1.15rem !important;
}
.rpt-chain li {
  margin: 0.35rem 0 !important;
  color: var(--r-ink2) !important;
}
.rpt-chain li strong { color: var(--r-accent) !important; font-weight: 600 !important; }
.rpt-insight {
  margin: 0.65rem 0 0 !important;
  padding: 0.55rem 0.7rem !important;
  border-left: 3px solid var(--r-accent) !important;
  background: var(--r-soft) !important;
  border-radius: 0 8px 8px 0 !important;
  font-style: italic !important;
  color: var(--r-ink2) !important;
}

.rpt-sc .prob {
  margin: 0.45rem 0 0 !important;
  font-family: var(--r-mono) !important;
  font-size: 0.75rem !important;
  color: var(--r-accent) !important;
  font-variant-numeric: tabular-nums !important;
}

.rpt-footer {
  margin-top: 1rem;
  padding: 1rem 1.15rem;
  border: 1px dashed var(--r-line);
  border-radius: var(--r-radius);
  background: var(--r-card);
  color: var(--r-ink3) !important;
  font-size: 0.8rem !important;
}

.rpt-footer p { margin: 0 0 0.35rem !important; }
.rpt-footer p:last-child { margin: 0 !important; }

.rpt-muted { color: var(--r-ink3) !important; }

.rpt-list {
  margin: 0.65rem 0 0 !important;
  padding-left: 1.15rem !important;
  color: var(--r-ink2) !important;
}

.rpt-list li {
  margin: 0.35rem 0 !important;
  line-height: 1.5 !important;
}

.rpt-flow {
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: center !important;
  gap: 0.4rem !important;
  margin-top: 0.85rem !important;
}

.rpt-flow-step {
  padding: 0.45rem 0.7rem !important;
  border-radius: 8px !important;
  border: 1px solid var(--r-line) !important;
  background: var(--r-bg) !important;
  font-size: 0.8rem !important;
  color: var(--r-ink2) !important;
}

.rpt-flow-arrow {
  color: var(--r-ink3) !important;
  font-size: 0.9rem !important;
}

/* Math / code blocks — no KaTeX dependency for numbers */
.rpt-mono {
  font-family: var(--r-mono) !important;
  font-variant-numeric: tabular-nums !important;
}

@media print {
  .rpt-section { break-inside: avoid; }
}
`;

export function wrapStandaloneHtml({ title, bodyHtml, reportJson }) {
  const safeJson = JSON.stringify(reportJson ?? null).replace(/</g, "\\u003c");
  const darkClass =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark-mode")
      ? " rpt-dark"
      : "";
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="color-scheme" content="light dark"/>
<title>${escAttr(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
${REPORT_CSS}
body { margin: 0; background: #f7f4ec; }
@media (prefers-color-scheme: dark) {
  body { background: #1c1917; }
  .rpt { 
    --r-bg: #1c1917; --r-card: #292524; --r-ink: #faf7f2; --r-ink2: #e7e5e4;
    --r-ink3: #a8a29e; --r-line: rgba(250,247,242,.12); --r-accent: #d4a574;
    --r-up: #6bbf8a; --r-down: #f07178;
  }
}
</style>
</head>
<body>
<script type="application/json" id="report-data">${safeJson}</script>
<div class="rpt${darkClass}">
<div class="rpt-wrap">
${bodyHtml}
</div>
</div>
</body>
</html>`;
}

function escAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
