const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-api-key",
};

const SUPPORTED_PROXY_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);
const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

function jsonResponse(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

function getHeader(headers, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === wanted) {
      return value;
    }
  }
  return undefined;
}

function ensureAuthorized(headers) {
  const expected = process.env.API_SECRET_KEY?.trim();
  if (!expected) {
    return null;
  }

  const apiKey = getHeader(headers, "x-api-key");
  const authorization = getHeader(headers, "authorization");
  const bearer =
    typeof authorization === "string" && authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;

  if (apiKey === expected || bearer === expected) {
    return null;
  }

  return jsonResponse(401, {
    success: false,
    error: "Invalid or missing API key",
  });
}

function ensureAllowedTarget(url) {
  const configured = process.env.ALLOWED_PROXY_HOSTS?.trim();
  if (!configured) {
    return null;
  }

  const allowedHosts = configured
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const hostname = url.hostname.toLowerCase();
  const allowed = allowedHosts.some(
    (allowedHost) => hostname === allowedHost || hostname.endsWith(`.${allowedHost}`),
  );

  if (allowed) {
    return null;
  }

  return jsonResponse(403, {
    success: false,
    error: `Target host is not allowed: ${url.hostname}`,
  });
}

function parseJsonObject(value, label) {
  if (value == null || value === "") {
    return {};
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error();
      }
      return parsed;
    } catch {
      throw new Error(`Invalid ${label} format`);
    }
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  throw new Error(`Invalid ${label} format`);
}

function normalizePayload(event) {
  if (event.httpMethod === "GET") {
    return event.queryStringParameters ?? {};
  }

  if (event.httpMethod !== "POST") {
    throw Object.assign(new Error("Method not allowed"), { statusCode: 405 });
  }

  if (!event.body) {
    return {};
  }

  try {
    const parsed = JSON.parse(event.body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { statusCode: 400 });
  }
}

function validateRequest(rawPayload) {
  const urlValue = typeof rawPayload.url === "string" ? rawPayload.url.trim() : "";
  if (!urlValue) {
    throw Object.assign(new Error("请提供有效的URL地址"), { statusCode: 400 });
  }

  let targetUrl;
  try {
    targetUrl = new URL(urlValue);
  } catch {
    throw Object.assign(new Error("请提供有效的URL地址"), { statusCode: 400 });
  }

  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    throw Object.assign(new Error("Only http and https URLs are supported"), {
      statusCode: 400,
    });
  }

  const method = (rawPayload.method || "GET").toString().toUpperCase();
  if (!SUPPORTED_PROXY_METHODS.has(method)) {
    throw Object.assign(new Error("请提供有效的HTTP方法"), { statusCode: 400 });
  }

  const extraHeaders = parseJsonObject(rawPayload.headers, "headers");

  return {
    url: targetUrl,
    method,
    origin: rawPayload.origin,
    referer: rawPayload.referer,
    userAgent: rawPayload.userAgent,
    body: rawPayload.body,
    headers: extraHeaders,
  };
}

function buildProxyRequest(request) {
  const headers = new Headers();

  if (request.origin) {
    headers.set("Origin", String(request.origin));
  }

  if (request.referer) {
    headers.set("Referer", String(request.referer));
  }

  headers.set("User-Agent", request.userAgent ? String(request.userAgent) : DEFAULT_USER_AGENT);

  for (const [key, value] of Object.entries(request.headers)) {
    if (value == null) {
      continue;
    }
    headers.set(key, String(value));
  }

  let body;
  if (request.body != null && METHODS_WITH_BODY.has(request.method)) {
    if (typeof request.body === "string") {
      try {
        const parsed = JSON.parse(request.body);
        body = JSON.stringify(parsed);
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }
      } catch {
        body = request.body;
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "text/plain");
        }
      }
    } else {
      body = JSON.stringify(request.body);
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    }
  }

  return {
    method: request.method,
    headers,
    body,
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  };
}

function isTextualContent(contentType) {
  return (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("javascript") ||
    contentType.includes("html") ||
    contentType.includes("x-www-form-urlencoded")
  );
}

async function readProxyResponse(proxyResponse) {
  const headers = {};
  for (const [key, value] of proxyResponse.headers.entries()) {
    headers[key.toLowerCase()] = value;
  }

  const contentType = headers["content-type"] || "application/octet-stream";
  let data;

  if (isTextualContent(contentType)) {
    const text = await proxyResponse.text();
    if (contentType.includes("json")) {
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
    } else {
      data = text;
    }
  } else {
    const arrayBuffer = await proxyResponse.arrayBuffer();
    data = {
      encoding: "base64",
      value: Buffer.from(arrayBuffer).toString("base64"),
    };
  }

  return {
    data,
    status: proxyResponse.status,
    headers,
    contentType,
  };
}

export async function handleProxyRequest(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: "",
    };
  }

  if (!["GET", "POST"].includes(event.httpMethod)) {
    return jsonResponse(405, { success: false, error: "Method not allowed" }, { allow: "GET, POST, OPTIONS" });
  }

  const authError = ensureAuthorized(event.headers ?? {});
  if (authError) {
    return authError;
  }

  let request;
  try {
    const payload = normalizePayload(event);
    request = validateRequest(payload);
  } catch (error) {
    return jsonResponse(error.statusCode || 400, {
      success: false,
      error: error.message || "请求参数错误",
    });
  }

  const allowError = ensureAllowedTarget(request.url);
  if (allowError) {
    return allowError;
  }

  try {
    const upstreamResponse = await fetch(request.url, buildProxyRequest(request));
    const result = await readProxyResponse(upstreamResponse);

    return jsonResponse(200, {
      success: true,
      data: result.data,
      status: result.status,
      headers: result.headers,
      contentType: result.contentType,
    });
  } catch (error) {
    const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";

    return jsonResponse(isTimeout ? 408 : 500, {
      success: false,
      error: isTimeout
        ? "Network error: No response received"
        : `Proxy request failed: ${error?.message || "Unknown error"}`,
    });
  }
}
