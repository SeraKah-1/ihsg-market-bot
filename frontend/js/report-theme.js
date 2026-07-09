/**
 * Report CSS — modern Anthropic × xAI aesthetic.
 * Warm paper light / deep stone dark · serif headlines · airy cards · isolation.
 */
export const REPORT_CSS = `
.rpt {
  --r-bg: #f6f4ef;
  --r-card: #fffcf7;
  --r-elev: #ffffff;
  --r-ink: #14120b;
  --r-ink2: #3d3a34;
  --r-ink3: #6f6a60;
  --r-line: rgba(20,18,11,.1);
  --r-line2: rgba(20,18,11,.06);
  --r-accent: #c96442;
  --r-accent-soft: rgba(201,100,66,.12);
  --r-up: #0f6b4c;
  --r-down: #b42318;
  --r-warn: #9a6700;
  --r-soft: rgba(20,18,11,.04);
  --r-up-bg: rgba(15,107,76,.09);
  --r-down-bg: rgba(180,35,24,.09);
  --r-warn-bg: rgba(154,103,0,.1);
  --r-serif: "Instrument Serif", "Iowan Old Style", Georgia, serif;
  --r-sans: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --r-mono: "IBM Plex Mono", ui-monospace, "SF Mono", monospace;
  --r-radius: 16px;
  --r-radius-sm: 10px;
  --r-shadow: 0 1px 0 rgba(20,18,11,.04), 0 8px 24px rgba(20,18,11,.05);
  font-family: var(--r-sans) !important;
  color: var(--r-ink) !important;
  background: var(--r-bg) !important;
  line-height: 1.6 !important;
  font-size: 15.5px !important;
  letter-spacing: -0.01em !important;
  text-align: left !important;
  -webkit-font-smoothing: antialiased;
}

html.dark-mode .rpt,
.rpt.rpt-dark {
  --r-bg: #0c0c0a;
  --r-card: #161613;
  --r-elev: #1c1c18;
  --r-ink: #f5f2ea;
  --r-ink2: #c9c4b8;
  --r-ink3: #8a8578;
  --r-line: rgba(245,242,234,.1);
  --r-line2: rgba(245,242,234,.06);
  --r-accent: #e8a087;
  --r-accent-soft: rgba(232,160,135,.14);
  --r-up: #5dcaa5;
  --r-down: #f07178;
  --r-warn: #e0b45c;
  --r-soft: rgba(245,242,234,.04);
  --r-up-bg: rgba(93,202,165,.12);
  --r-down-bg: rgba(240,113,120,.12);
  --r-warn-bg: rgba(224,180,92,.12);
  --r-shadow: 0 1px 0 rgba(0,0,0,.3), 0 12px 32px rgba(0,0,0,.35);
}

.rpt * { box-sizing: border-box; }
.rpt a { color: var(--r-accent); }

.rpt-wrap {
  max-width: 760px;
  margin: 0 auto;
  padding: 0.5rem 0.25rem 3rem;
}

.rpt h1, .rpt h2, .rpt h3, .rpt h4 {
  font-family: var(--r-serif) !important;
  font-weight: 400 !important;
  color: var(--r-ink) !important;
  letter-spacing: -0.03em !important;
  line-height: 1.2 !important;
  margin: 0 !important;
}

.rpt p, .rpt li, .rpt dd, .rpt td, .rpt th, .rpt span, .rpt summary {
  font-family: var(--r-sans) !important;
}

/* ── Hero ── */
.rpt-hero {
  padding: 2rem 1.75rem 1.75rem;
  border-radius: calc(var(--r-radius) + 4px);
  background:
    radial-gradient(1200px 400px at 10% -10%, var(--r-accent-soft), transparent 55%),
    var(--r-card);
  border: 1px solid var(--r-line);
  box-shadow: var(--r-shadow);
  margin-bottom: 1.25rem;
}

.rpt-kicker {
  margin: 0 0 0.65rem !important;
  font-size: 0.7rem !important;
  font-weight: 600 !important;
  letter-spacing: 0.16em !important;
  text-transform: uppercase !important;
  color: var(--r-accent) !important;
  font-family: var(--r-sans) !important;
}

.rpt-hero h1 {
  font-size: clamp(1.85rem, 4.2vw, 2.45rem) !important;
  margin-bottom: 0.85rem !important;
  max-width: 18ch;
}

.rpt-hero-title {
  font-family: var(--r-serif) !important;
  font-size: clamp(1.55rem, 3.6vw, 2.1rem) !important;
  font-weight: 400 !important;
  line-height: 1.25 !important;
  letter-spacing: -0.03em !important;
  color: var(--r-ink) !important;
  margin: 0 0 0.85rem !important;
}

.rpt-lede-hero {
  font-size: 1.05rem !important;
  color: var(--r-ink2) !important;
  line-height: 1.55 !important;
  margin: 0 0 1.1rem !important;
  max-width: 52ch;
}

.rpt-badges {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 0.4rem !important;
  margin: 0.5rem 0 0.85rem !important;
}

.rpt-badge {
  display: inline-flex !important;
  align-items: center !important;
  padding: 0.32rem 0.7rem !important;
  border-radius: 999px !important;
  font-size: 0.68rem !important;
  font-weight: 600 !important;
  letter-spacing: 0.04em !important;
  text-transform: uppercase !important;
  border: 1px solid var(--r-line) !important;
  background: var(--r-soft) !important;
  color: var(--r-ink2) !important;
  font-family: var(--r-sans) !important;
  white-space: nowrap !important;
}
.rpt-badge.up { background: var(--r-up-bg) !important; color: var(--r-up) !important; border-color: transparent !important; }
.rpt-badge.down { background: var(--r-down-bg) !important; color: var(--r-down) !important; border-color: transparent !important; }
.rpt-badge.neutral { background: var(--r-soft) !important; color: var(--r-ink3) !important; }
.rpt-badge.warn { background: var(--r-warn-bg) !important; color: var(--r-warn) !important; border-color: transparent !important; }
.rpt-badge.accent { background: var(--r-accent-soft) !important; color: var(--r-accent) !important; border-color: transparent !important; }

.rpt-meta {
  margin: 0 !important;
  font-size: 0.88rem !important;
  color: var(--r-ink3) !important;
  font-variant-numeric: tabular-nums;
}

.rpt-export-bar {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 0.5rem !important;
  margin-top: 1.15rem !important;
  padding-top: 1rem !important;
  border-top: 1px solid var(--r-line2) !important;
}

.rpt-export-btn {
  appearance: none !important;
  border: 1px solid var(--r-line) !important;
  background: var(--r-elev) !important;
  color: var(--r-ink) !important;
  font-family: var(--r-sans) !important;
  font-size: 0.78rem !important;
  font-weight: 600 !important;
  letter-spacing: 0.02em !important;
  padding: 0.45rem 0.85rem !important;
  border-radius: 999px !important;
  cursor: pointer !important;
  transition: background .15s, border-color .15s, transform .1s !important;
}
.rpt-export-btn:hover {
  border-color: var(--r-accent) !important;
  color: var(--r-accent) !important;
}
.rpt-export-btn.primary {
  background: var(--r-ink) !important;
  color: var(--r-bg) !important;
  border-color: transparent !important;
}
html.dark-mode .rpt-export-btn.primary,
.rpt-dark .rpt-export-btn.primary {
  background: var(--r-ink) !important;
  color: var(--r-bg) !important;
}

/* ── Sections ── */
.rpt-section {
  border: 1px solid var(--r-line) !important;
  border-radius: var(--r-radius) !important;
  background: var(--r-card) !important;
  margin-bottom: 0.85rem !important;
  overflow: hidden !important;
  box-shadow: 0 1px 0 var(--r-line2);
}

.rpt-section > summary {
  list-style: none !important;
  cursor: pointer !important;
  padding: 0.95rem 1.2rem !important;
  font-size: 0.78rem !important;
  font-weight: 650 !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  color: var(--r-ink3) !important;
  user-select: none !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 0.75rem !important;
}
.rpt-section > summary::-webkit-details-marker { display: none; }
.rpt-section > summary::after {
  content: "+" !important;
  font-family: var(--r-mono) !important;
  font-size: 1rem !important;
  color: var(--r-ink3) !important;
  opacity: .7;
}
.rpt-section[open] > summary::after { content: "−" !important; }
.rpt-section[open] > summary { border-bottom: 1px solid var(--r-line2) !important; }

.rpt-body {
  padding: 1.15rem 1.25rem 1.35rem !important;
}

.rpt-lead {
  font-family: var(--r-serif) !important;
  font-size: 1.35rem !important;
  line-height: 1.35 !important;
  letter-spacing: -0.02em !important;
  margin: 0 0 0.75rem !important;
  color: var(--r-ink) !important;
}

.rpt-lede {
  font-size: 1.02rem !important;
  color: var(--r-ink2) !important;
  margin: 0 0 1rem !important;
  line-height: 1.55 !important;
}

.rpt-story {
  font-size: 0.98rem !important;
  color: var(--r-ink2) !important;
  margin: 0 0 1rem !important;
  line-height: 1.6 !important;
  padding-left: 0.85rem !important;
  border-left: 2px solid var(--r-accent) !important;
}

.rpt-insight {
  font-family: var(--r-serif) !important;
  font-style: italic !important;
  font-size: 1.12rem !important;
  color: var(--r-ink) !important;
  margin: 0 0 1rem !important;
  padding: 0.85rem 1rem !important;
  background: var(--r-accent-soft) !important;
  border-radius: var(--r-radius-sm) !important;
}

.rpt-subh {
  margin: 1.1rem 0 0.45rem !important;
  font-size: 0.72rem !important;
  font-weight: 650 !important;
  letter-spacing: 0.1em !important;
  text-transform: uppercase !important;
  color: var(--r-ink3) !important;
  font-family: var(--r-sans) !important;
}

.rpt-panel {
  background: var(--r-soft) !important;
  border: 1px solid var(--r-line2) !important;
  border-radius: var(--r-radius-sm) !important;
  padding: 0.85rem 1rem !important;
}
.rpt-panel h4 {
  font-family: var(--r-sans) !important;
  font-size: 0.72rem !important;
  font-weight: 650 !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  color: var(--r-ink3) !important;
  margin: 0 0 0.4rem !important;
}
.rpt-panel p {
  margin: 0 !important;
  color: var(--r-ink2) !important;
  font-size: 0.95rem !important;
}

.rpt-grid-2 {
  display: grid !important;
  grid-template-columns: 1fr 1fr !important;
  gap: 0.65rem !important;
}
@media (max-width: 560px) {
  .rpt-grid-2 { grid-template-columns: 1fr !important; }
}

.rpt-qa {
  display: grid !important;
  gap: 0.55rem !important;
  margin: 0.75rem 0 !important;
}
.rpt-qa-item {
  padding: 0.85rem 1rem !important;
  border-radius: var(--r-radius-sm) !important;
  background: var(--r-soft) !important;
  border: 1px solid var(--r-line2) !important;
}
.rpt-qa-item.do {
  background: var(--r-accent-soft) !important;
  border-color: transparent !important;
}
.rpt-qa-item .q {
  margin: 0 0 0.25rem !important;
  font-size: 0.68rem !important;
  font-weight: 650 !important;
  letter-spacing: 0.1em !important;
  text-transform: uppercase !important;
  color: var(--r-ink3) !important;
}
.rpt-qa-item .a {
  margin: 0 !important;
  color: var(--r-ink) !important;
  font-size: 0.98rem !important;
}

.rpt-chain {
  margin: 0.35rem 0 0.75rem !important;
  padding-left: 1.2rem !important;
  color: var(--r-ink2) !important;
}
.rpt-chain li { margin: 0.35rem 0 !important; }

.rpt-actions, .rpt-list {
  margin: 0.35rem 0 0.5rem !important;
  padding-left: 1.15rem !important;
  color: var(--r-ink2) !important;
}
.rpt-actions li, .rpt-list li { margin: 0.3rem 0 !important; }

.rpt-chips {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 0.35rem !important;
}
.rpt-chip {
  display: inline-flex !important;
  padding: 0.28rem 0.6rem !important;
  border-radius: 999px !important;
  font-size: 0.75rem !important;
  background: var(--r-soft) !important;
  border: 1px solid var(--r-line2) !important;
  color: var(--r-ink2) !important;
}
.rpt-chip.warn {
  background: var(--r-warn-bg) !important;
  color: var(--r-warn) !important;
  border-color: transparent !important;
}

.rpt-callout {
  padding: 0.95rem 1.05rem !important;
  border-radius: var(--r-radius-sm) !important;
  background: var(--r-soft) !important;
  border: 1px solid var(--r-line2) !important;
}
.rpt-callout.cerah { background: var(--r-up-bg) !important; border-color: transparent !important; }
.rpt-callout.suram { background: var(--r-down-bg) !important; border-color: transparent !important; }
.rpt-callout .co-title {
  margin: 0 0 0.3rem !important;
  font-size: 0.72rem !important;
  font-weight: 650 !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  color: var(--r-ink3) !important;
}
.rpt-callout .co-body {
  margin: 0 !important;
  color: var(--r-ink2) !important;
}

/* ── Metric cards ── */
.rpt-metric-grid {
  display: grid !important;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)) !important;
  gap: 0.5rem !important;
  margin: 0.5rem 0 0.75rem !important;
}
.rpt-metric {
  padding: 0.7rem 0.75rem !important;
  border-radius: var(--r-radius-sm) !important;
  background: var(--r-elev) !important;
  border: 1px solid var(--r-line2) !important;
}
.rpt-metric .lab {
  display: block !important;
  font-size: 0.65rem !important;
  font-weight: 650 !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  color: var(--r-ink3) !important;
  margin-bottom: 0.25rem !important;
}
.rpt-metric .val {
  display: block !important;
  font-family: var(--r-mono) !important;
  font-size: 1.05rem !important;
  font-weight: 500 !important;
  font-variant-numeric: tabular-nums !important;
  color: var(--r-ink) !important;
}
.rpt-metric .val.up { color: var(--r-up) !important; }
.rpt-metric .val.down { color: var(--r-down) !important; }
.rpt-metric .mean {
  display: block !important;
  margin-top: 0.3rem !important;
  font-size: 0.75rem !important;
  color: var(--r-ink3) !important;
  line-height: 1.35 !important;
}

.rpt-ind-json {
  margin-top: 0.5rem !important;
  padding: 0.75rem !important;
  border-radius: var(--r-radius-sm) !important;
  background: var(--r-soft) !important;
  border: 1px solid var(--r-line2) !important;
  font-family: var(--r-mono) !important;
  font-size: 0.68rem !important;
  line-height: 1.45 !important;
  color: var(--r-ink3) !important;
  overflow: auto !important;
  max-height: 220px !important;
  white-space: pre-wrap !important;
  word-break: break-word !important;
}

/* ── Ticker card ── */
.rpt-ticker {
  border: 1px solid var(--r-line) !important;
  border-radius: var(--r-radius) !important;
  background: var(--r-elev) !important;
  padding: 1.1rem 1.15rem !important;
  margin-bottom: 0.85rem !important;
}
.rpt-ticker:last-child { margin-bottom: 0 !important; }

.rpt-ticker-head {
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: baseline !important;
  gap: 0.5rem 0.75rem !important;
  margin-bottom: 0.65rem !important;
}
.rpt-ticker-head h3 {
  font-family: var(--r-sans) !important;
  font-weight: 700 !important;
  font-size: 1.05rem !important;
  letter-spacing: 0.04em !important;
}

.rpt-table {
  width: 100% !important;
  border-collapse: collapse !important;
  font-size: 0.88rem !important;
  margin: 0.5rem 0 !important;
}
.rpt-table th {
  text-align: left !important;
  font-size: 0.68rem !important;
  font-weight: 650 !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  color: var(--r-ink3) !important;
  padding: 0.45rem 0.4rem !important;
  border-bottom: 1px solid var(--r-line) !important;
}
.rpt-table td {
  padding: 0.5rem 0.4rem !important;
  border-bottom: 1px solid var(--r-line2) !important;
  color: var(--r-ink2) !important;
  vertical-align: top !important;
}
.rpt-table td.num {
  font-family: var(--r-mono) !important;
  font-variant-numeric: tabular-nums !important;
  white-space: nowrap !important;
}
.rpt-table .up { color: var(--r-up) !important; }
.rpt-table .down { color: var(--r-down) !important; }

.rpt-scen {
  display: grid !important;
  grid-template-columns: repeat(3, 1fr) !important;
  gap: 0.45rem !important;
  margin-top: 0.65rem !important;
}
@media (max-width: 640px) {
  .rpt-scen { grid-template-columns: 1fr !important; }
}
.rpt-scen-card {
  padding: 0.65rem 0.7rem !important;
  border-radius: var(--r-radius-sm) !important;
  background: var(--r-soft) !important;
  border: 1px solid var(--r-line2) !important;
}
.rpt-scen-card .lab {
  font-size: 0.65rem !important;
  font-weight: 700 !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  color: var(--r-ink3) !important;
  margin-bottom: 0.25rem !important;
}
.rpt-scen-card .prob {
  font-family: var(--r-mono) !important;
  font-size: 0.75rem !important;
  color: var(--r-accent) !important;
  margin-top: 0.35rem !important;
}

.rpt-flow {
  display: flex !important;
  flex-direction: column !important;
  gap: 0.45rem !important;
}
.rpt-flow-step {
  display: grid !important;
  grid-template-columns: 2rem 1fr !important;
  gap: 0.55rem !important;
  align-items: start !important;
}
.rpt-flow-n {
  width: 1.75rem !important;
  height: 1.75rem !important;
  border-radius: 999px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 0.72rem !important;
  font-weight: 700 !important;
  background: var(--r-accent-soft) !important;
  color: var(--r-accent) !important;
}
.rpt-flow-body h4 {
  font-family: var(--r-sans) !important;
  font-size: 0.85rem !important;
  font-weight: 650 !important;
  margin: 0 0 0.15rem !important;
}
.rpt-flow-body p {
  margin: 0 !important;
  font-size: 0.88rem !important;
  color: var(--r-ink2) !important;
}

.rpt-footer {
  margin-top: 1.5rem !important;
  padding: 1rem 0.25rem !important;
  border-top: 1px solid var(--r-line) !important;
  color: var(--r-ink3) !important;
  font-size: 0.8rem !important;
}
.rpt-footer p { margin: 0.25rem 0 !important; }

.rpt-muted { color: var(--r-ink3) !important; font-size: 0.9rem !important; }
.rpt-mono {
  font-family: var(--r-mono) !important;
  font-variant-numeric: tabular-nums !important;
}

.up { color: var(--r-up) !important; }
.down { color: var(--r-down) !important; }

@media print {
  .rpt-section { break-inside: avoid; }
  .rpt-export-bar { display: none !important; }
  .rpt-hero { box-shadow: none !important; }
}
`;

export function wrapStandaloneHtml({ title, bodyHtml, reportJson }) {
  const safeJson = JSON.stringify(reportJson ?? null)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const dark =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark-mode");
  const darkClass = dark ? " rpt-dark" : "";
  const bg = dark ? "#0c0c0a" : "#f6f4ef";
  return `<!DOCTYPE html>
<html lang="id"${dark ? ' class="dark-mode"' : ""}>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="color-scheme" content="light dark"/>
<meta name="generator" content="IHSG Market Bot"/>
<title>${escAttr(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;650&display=swap" rel="stylesheet"/>
<style>
${REPORT_CSS}
html, body { margin: 0; padding: 0; background: ${bg}; }
body { min-height: 100vh; }
.rpt-export-bar { display: none !important; }
.export-banner {
  max-width: 760px; margin: 0 auto; padding: 1rem 1.25rem 0;
  font-family: Inter, system-ui, sans-serif; font-size: 0.78rem;
  color: ${dark ? "#8a8578" : "#6f6a60"};
}
</style>
</head>
<body>
<p class="export-banner">IHSG Market Bot · export HTML · ${escAttr(title)} · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</p>
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
