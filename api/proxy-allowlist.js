/**
 * Pure host allowlist for the CORS proxy.
 */

const ALLOWED_PROXY_HOSTS = [
  "9router-termux.farreladitya.dev",
  "openrouter.ai",
  "api.openrouter.ai",
  "generativelanguage.googleapis.com",
  "api.openai.com",
  "api.anthropic.com",
  "api.groq.com",
  "api.together.xyz",
  "api.fireworks.ai",
  "api.deepseek.com",
  "api.tavily.com",
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
  "html.duckduckgo.com",
  "api.duckduckgo.com",
  "localhost",
  "127.0.0.1"
];

function isAllowedProxyTarget(targetUrl) {
  if (!targetUrl || typeof targetUrl !== "string") return false;
  let raw = targetUrl.trim();
  if (!raw || raw === "/" || raw === "") return false;
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    raw = "https://" + raw;
  }
  let hostname;
  try {
    hostname = new URL(raw).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!hostname) return false;
  return ALLOWED_PROXY_HOSTS.some(
    (allowed) => hostname === allowed || hostname.endsWith("." + allowed)
  );
}

function normalizeProxyTarget(targetUrl) {
  if (!targetUrl || typeof targetUrl !== "string") return null;
  let raw = targetUrl.trim();
  if (!raw || raw === "/" || raw === "") return null;
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    raw = "https://" + raw;
  }
  try {
    new URL(raw);
    return raw;
  } catch {
    return null;
  }
}

module.exports = {
  ALLOWED_PROXY_HOSTS,
  isAllowedProxyTarget,
  normalizeProxyTarget
};
