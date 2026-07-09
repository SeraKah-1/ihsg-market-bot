/**
 * thinking-config.js — Vertex thinking level preference + cascade (no Firebase).
 * Prefer high when supported; always allow fall back to medium → low → off.
 */

/**
 * @param {string} preferred
 * @returns {(string|null)[]}
 */
export function buildThinkingLevelCascade(preferred = "high") {
  const order = ["high", "medium", "low"];
  const pref = String(preferred || "high").toLowerCase();
  const start = order.indexOf(pref);
  const cascade = start >= 0 ? order.slice(start) : order.slice();
  return [...cascade, null];
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isThinkingConfigError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  if (!msg) return false;
  // Explicit thinking-config rejections
  if (
    msg.includes("thinkinglevel") ||
    msg.includes("thinking_level") ||
    msg.includes("thinkingconfig") ||
    msg.includes("thinking_config") ||
    msg.includes("thinking is not supported") ||
    msg.includes('unknown name "thinking') ||
    (msg.includes("thinking") &&
      (msg.includes("invalid") ||
        msg.includes("unsupported") ||
        msg.includes("not supported")))
  ) {
    return true;
  }
  // Vertex often returns generic invalid-argument when thinkingLevel is rejected
  // by a model build that does not expose thinking — allow cascade, not auth/quota.
  if (
    (msg.includes("invalid argument") ||
      msg.includes("invalid_argument") ||
      msg.includes("failed precondition") ||
      msg.includes("failed_precondition")) &&
    !msg.includes("api key") &&
    !msg.includes("permission") &&
    !msg.includes("quota") &&
    !msg.includes("resource exhausted")
  ) {
    return true;
  }
  return false;
}
