/**
 * Shared report stylesheet for in-app inject + standalone HTML export.
 * Color theory: warm stone neutrals, no pure black/white (WCAG readability).
 * Anthropic-like editorial hierarchy + elevated surfaces (not flat black).
 */
export const REPORT_CSS = `
:root {
  --paper: #f4f1ea;
  --paper-2: #ebe6db;
  --ink: #1c1917;
  --ink-2: #44403c;
  --ink-3: #78716c;
  --ink-4: #a8a29e;
  --line: rgba(28, 25, 23, 0.1);
  --line-strong: rgba(28, 25, 23, 0.16);
  --card: #fffcf7;
  --accent: #9a6b3f;
  --accent-soft: rgba(154, 107, 63, 0.12);
  --up: #2f6f4e;
  --up-bg: rgba(47, 111, 78, 0.1);
  --down: #b42318;
  --down-bg: rgba(180, 35, 24, 0.08);
  --warn: #a16207;
  --warn-bg: rgba(161, 98, 7, 0.1);
  --serif: "Instrument Serif", "Iowan Old Style", Georgia, serif;
  --sans: Inter, system-ui, -apple-system, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, monospace;
  --radius: 12px;
  --shadow: 0 1px 2px rgba(28,25,23,.04), 0 8px 24px rgba(28,25,23,.06);
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #1c1917;
    --paper-2: #292524;
    --ink: #faf7f2;
    --ink-2: #e7e5e4;
    --ink-3: #a8a29e;
    --ink-4: #78716c;
    --line: rgba(250, 247, 242, 0.1);
    --line-strong: rgba(250, 247, 242, 0.16);
    --card: #292524;
    --accent: #d4a574;
    --accent-soft: rgba(212, 165, 116, 0.14);
    --up: #6bbf8a;
    --up-bg: rgba(107, 191, 138, 0.12);
    --down: #f07178;
    --down-bg: rgba(240, 113, 120, 0.12);
    --warn: #e0b45c;
    --warn-bg: rgba(224, 180, 92, 0.12);
    --shadow: 0 1px 0 rgba(255,255,255,.04), 0 12px 32px rgba(0,0,0,.28);
  }
}

.report-root, .report {
  font-family: var(--sans);
  color: var(--ink);
  background: var(--paper);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

.report-root {
  max-width: 820px;
  margin: 0 auto;
  padding: 2rem 1.25rem 3rem;
}

.report-head {
  padding: 1.75rem 1.5rem 1.35rem;
  border-radius: var(--radius);
  background:
    radial-gradient(ellipse 90% 80% at 0% 0%, var(--accent-soft), transparent 55%),
    var(--card);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  margin-bottom: 1.25rem;
}

.report-head h1 {
  margin: 0 0 0.75rem;
  font-family: var(--serif);
  font-weight: 400;
  font-size: clamp(1.65rem, 4vw, 2.15rem);
  letter-spacing: -0.02em;
  color: var(--ink);
  line-height: 1.2;
}

.report-kicker {
  margin: 0 0 0.35rem;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0.5rem 0;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 0.22rem 0.6rem;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border: 1px solid var(--line-strong);
  background: var(--paper-2);
  color: var(--ink-2);
}

.badge-lean {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: rgba(154, 107, 63, 0.35);
}

.badge-follow {
  background: var(--up-bg);
  color: var(--up);
  border-color: rgba(47, 111, 78, 0.28);
}

.badge-exit {
  background: var(--down-bg);
  color: var(--down);
  border-color: rgba(180, 35, 24, 0.25);
}

.meta {
  margin: 0.75rem 0 0;
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--ink-3);
}

.report-section {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  margin-bottom: 0.65rem;
  box-shadow: 0 1px 0 rgba(28,25,23,.03);
  overflow: hidden;
}

.report-section > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.95rem 1.15rem;
  cursor: pointer;
  list-style: none;
  font-weight: 600;
  font-size: 0.92rem;
  color: var(--ink);
  user-select: none;
}

.report-section > summary::-webkit-details-marker { display: none; }

.report-section > summary::after {
  content: "";
  width: 0.45rem;
  height: 0.45rem;
  border-right: 1.5px solid var(--ink-3);
  border-bottom: 1.5px solid var(--ink-3);
  transform: rotate(45deg);
  transition: transform 0.18s ease;
  flex-shrink: 0;
}

.report-section[open] > summary::after {
  transform: rotate(-135deg);
  margin-top: 0.25rem;
}

.report-section > summary:hover {
  background: var(--paper-2);
}

.report-section-body {
  padding: 0 1.15rem 1.15rem;
  color: var(--ink-2);
  font-size: 0.9rem;
  border-top: 1px solid var(--line);
}

.report-section-body p {
  margin: 0.65rem 0 0;
}

.report-section-body p:first-child {
  margin-top: 0.85rem;
}

.report-section-body b {
  color: var(--ink);
  font-weight: 600;
}

.card-grid {
  display: grid;
  gap: 0.75rem;
  margin-top: 0.85rem;
}

.card {
  border: 1px solid var(--line);
  border-radius: calc(var(--radius) - 2px);
  background: var(--paper);
  padding: 1rem 1.1rem;
}

.card header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.65rem;
}

.card h3 {
  margin: 0;
  font-family: var(--mono);
  font-size: 1rem;
  font-weight: 500;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  color: var(--ink);
}

.metrics-line {
  font-family: var(--mono);
  font-size: 0.8rem;
  font-weight: 500;
}

.up { color: var(--up); }
.down { color: var(--down); }
.muted { color: var(--ink-3); font-size: 0.85rem; }

.kv {
  display: grid;
  grid-template-columns: 7.5rem 1fr;
  gap: 0.25rem 0.75rem;
  margin-top: 0.55rem;
  font-size: 0.84rem;
}

.kv dt {
  margin: 0;
  color: var(--ink-3);
  font-weight: 500;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-top: 0.15rem;
}

.kv dd {
  margin: 0;
  color: var(--ink-2);
}

.scenario-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

@media (min-width: 560px) {
  .scenario-row {
    grid-template-columns: repeat(3, 1fr);
  }
}

.scenario {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0.65rem 0.75rem;
  background: var(--card);
}

.scenario .lab {
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-bottom: 0.25rem;
}

.scenario .prob {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--accent);
  margin-top: 0.35rem;
}

table.report-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
  margin-top: 0.75rem;
}

table.report-table th,
table.report-table td {
  text-align: left;
  padding: 0.5rem 0.45rem;
  border-bottom: 1px solid var(--line);
}

table.report-table th {
  color: var(--ink-3);
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
}

.report-footer {
  margin-top: 1.25rem;
  padding: 1rem 1.15rem;
  border-radius: var(--radius);
  border: 1px dashed var(--line-strong);
  color: var(--ink-3);
  font-size: 0.78rem;
  background: var(--paper-2);
}

.report-footer p { margin: 0 0 0.35rem; }
.report-footer p:last-child { margin: 0; }

.mermaid {
  background: var(--paper-2);
  border-radius: 8px;
  padding: 0.75rem;
  overflow: auto;
  margin-top: 0.75rem;
}

@media print {
  .report-root { max-width: none; padding: 0; }
  .report-section { break-inside: avoid; box-shadow: none; }
  .report-section > summary::after { display: none; }
}
`;

export function wrapStandaloneHtml({ title, bodyHtml, reportJson }) {
  const safeJson = JSON.stringify(reportJson ?? null).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="color-scheme" content="light dark"/>
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"/>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"><\/script>
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: true, theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "neutral" });
<\/script>
<style>
${REPORT_CSS}
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
}
</style>
</head>
<body>
<script type="application/json" id="report-data">${safeJson}</script>
<div class="report-root">
${bodyHtml}
</div>
<script>
document.addEventListener("DOMContentLoaded", () => {
  if (window.renderMathInElement) {
    renderMathInElement(document.body, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false }
      ],
      throwOnError: false
    });
  }
});
<\/script>
</body>
</html>`;
}
