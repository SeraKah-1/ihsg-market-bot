// Vercel Serverless Function: CORS Proxy for 9Router & External LLM Providers
// Host allowlist is mandatory — open proxy would be an abuse vector.
const { isAllowedProxyTarget, normalizeProxyTarget } = require("./proxy-allowlist.js");

module.exports = async function handler(req, res) {
  // 1. Set wildcard CORS headers for browser preflight & cross-origin access
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Max-Age", "86400");

  // 2. Handle HTTP OPTIONS preflight immediately with 200 OK
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 3. Extract target URL from query param (?url=...) or path after /cors-proxy/
  let targetUrl = req.query && req.query.url;
  if (!targetUrl) {
    const rawUrl = req.url || "";
    const match = rawUrl.match(/[?&]url=([^&]+)/);
    if (match) {
      targetUrl = decodeURIComponent(match[1]);
    } else {
      targetUrl = rawUrl
        .replace(/^\/api\/cors-proxy\/?/, "")
        .replace(/^\/cors-proxy\/?/, "");
    }
  }

  if (!targetUrl || targetUrl === "/" || targetUrl === "") {
    return res.status(200).json({
      status: "online",
      message: "9Router & Cognitive Sandbox CORS Proxy active (allowlisted hosts only)"
    });
  }

  const normalized = normalizeProxyTarget(targetUrl);
  if (!normalized) {
    return res.status(400).json({ error: "Invalid target URL" });
  }

  if (!isAllowedProxyTarget(normalized)) {
    return res.status(403).json({
      error: "Target host is not on the proxy allowlist",
      host: (() => {
        try {
          return new URL(normalized).hostname;
        } catch {
          return null;
        }
      })()
    });
  }

  targetUrl = normalized;

  try {
    const forwardHeaders = {};
    const headersToForward = [
      "authorization",
      "content-type",
      "http-referer",
      "x-title",
      "accept"
    ];
    for (const h of headersToForward) {
      if (req.headers[h]) forwardHeaders[h] = req.headers[h];
    }
    if (!forwardHeaders["content-type"]) {
      forwardHeaders["content-type"] = "application/json";
    }

    const bodyData = ["GET", "HEAD"].includes(req.method)
      ? undefined
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body);

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: bodyData
    });

    const responseText = await response.text();
    res.status(response.status);

    const contentType = response.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);

    return res.send(responseText);
  } catch (err) {
    console.error("[CORS Proxy Error]:", err);
    return res.status(500).json({ error: err.message || "CORS Proxy Error" });
  }
};

// Re-export allowlist helpers for tests that require the handler module
module.exports.isAllowedProxyTarget = isAllowedProxyTarget;
module.exports.normalizeProxyTarget = normalizeProxyTarget;
