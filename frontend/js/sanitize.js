/**
 * sanitize.js — Lightweight HTML sanitizer for AI/markdown output.
 * Pure string transforms (no DOM required) so Node unit tests can drive it.
 */

const DANGEROUS_BLOCK =
  /<\s*(script|style|iframe|object|embed|link|meta|base|form)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const DANGEROUS_VOID =
  /<\s*(script|style|iframe|object|embed|link|meta|base|form)\b[^>]*\/?>/gi;
const EVENT_HANDLER_ATTR =
  /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL_QUOTED =
  /\b(href|src|xlink:href|action)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi;
const JS_URL_BARE =
  /\b(href|src|xlink:href|action)\s*=\s*javascript:[^\s>]*/gi;
const DATA_HTML_URL =
  /\b(href|src)\s*=\s*(['"])\s*data:text\/html[\s\S]*?\2/gi;

/**
 * Strip high-risk HTML constructs from markdown-rendered HTML before innerHTML.
 * @param {string} html
 * @returns {string}
 */
export function sanitizeHtml(html) {
  if (html == null || html === "") return "";
  let out = String(html);
  // Repeat a few times in case of nested/obfuscated constructs
  for (let i = 0; i < 3; i++) {
    const prev = out;
    out = out.replace(DANGEROUS_BLOCK, "");
    out = out.replace(DANGEROUS_VOID, "");
    out = out.replace(EVENT_HANDLER_ATTR, "");
    out = out.replace(JS_URL_QUOTED, '$1=$2#$2');
    out = out.replace(JS_URL_BARE, '$1="#"');
    out = out.replace(DATA_HTML_URL, '$1=$2#$2');
    if (out === prev) break;
  }
  return out;
}
