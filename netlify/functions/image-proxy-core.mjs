const ALLOWED_IMAGE_HOSTS = [
  "douyinpic.com",
  "hdslb.com",
  "bilibili.com",
  "biliimg.com",
  "bstarstatic.com",
  "xhscdn.com",
  "xiaohongshu.com",
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktok.com",
  "instagram.com",
  "cdninstagram.com",
  "fbcdn.net",
  "nimg.jp",
  "twimg.com",
  "x.com",
  "twitter.com",
];

const DEFAULT_ACCEPT =
  "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

const NESTED_IMAGE_PROXY_HOSTS = new Set([
  "downloader-api.bhwa233.com",
]);

function jsonError(message, status) {
  return Response.json({ error: message }, { status });
}

function isAllowedImageHost(hostname) {
  const normalized = hostname.toLowerCase();
  return ALLOWED_IMAGE_HOSTS.some(
    (host) => normalized === host || normalized.endsWith(`.${host}`),
  );
}

function getReferer(hostname) {
  const normalized = hostname.toLowerCase();
  if (normalized.endsWith("douyinpic.com")) return "https://www.douyin.com/";
  if (normalized.endsWith("xhscdn.com") || normalized.endsWith("xiaohongshu.com")) {
    return "https://www.xiaohongshu.com/";
  }
  if (
    normalized.endsWith("tiktokcdn.com") ||
    normalized.endsWith("tiktokcdn-us.com") ||
    normalized.endsWith("tiktok.com")
  ) {
    return "https://www.tiktok.com/";
  }
  if (
    normalized.endsWith("instagram.com") ||
    normalized.endsWith("cdninstagram.com") ||
    normalized.endsWith("fbcdn.net")
  ) {
    return "https://www.instagram.com/";
  }
  if (normalized.endsWith("nimg.jp")) return "https://www.nicovideo.jp/";
  if (
    normalized.endsWith("twimg.com") ||
    normalized.endsWith("x.com") ||
    normalized.endsWith("twitter.com")
  ) {
    return "https://x.com/";
  }
  return undefined;
}

function isHttpProtocol(protocol) {
  return protocol === "http:" || protocol === "https:";
}

function normalizeUpstreamUrl(url) {
  const normalizedUrl = new URL(url.toString());
  if (normalizedUrl.protocol === "http:") {
    normalizedUrl.protocol = "https:";
  }
  return normalizedUrl;
}

function tryDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function unwrapNestedImageProxyUrl(targetUrl) {
  const host = targetUrl.hostname.toLowerCase();
  const isKnownNestedProxyHost = NESTED_IMAGE_PROXY_HOSTS.has(host);
  const isImageProxyPath = targetUrl.pathname === "/api/image-proxy";
  if (!isKnownNestedProxyHost || !isImageProxyPath) {
    return targetUrl;
  }

  const nestedUrlParam = targetUrl.searchParams.get("url");
  if (!nestedUrlParam) {
    return targetUrl;
  }

  let decoded = nestedUrlParam;
  for (let i = 0; i < 2; i += 1) {
    const nextDecoded = tryDecodeURIComponent(decoded);
    if (nextDecoded === decoded) {
      break;
    }
    decoded = nextDecoded;
  }

  try {
    const nestedUrl = new URL(decoded);
    if (!isHttpProtocol(nestedUrl.protocol)) {
      return targetUrl;
    }
    return nestedUrl;
  } catch {
    return targetUrl;
  }
}

export async function handleImageProxy(request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonError("Method not allowed", 405);
  }

  const requestUrl = new URL(request.url);
  const rawUrl = requestUrl.searchParams.get("url");
  if (!rawUrl) {
    return jsonError('Missing "url" query parameter', 400);
  }

  let targetUrl;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return jsonError("Invalid image url", 400);
  }

  targetUrl = unwrapNestedImageProxyUrl(targetUrl);

  if (!isHttpProtocol(targetUrl.protocol)) {
    return jsonError("Only http(s) protocol is allowed", 400);
  }

  if (!isAllowedImageHost(targetUrl.hostname)) {
    return jsonError("Host is not allowed", 403);
  }

  const upstreamUrl = normalizeUpstreamUrl(targetUrl);
  const upstreamHeaders = new Headers();
  upstreamHeaders.set("Accept", DEFAULT_ACCEPT);
  upstreamHeaders.set(
    "User-Agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  );

  const referer = getReferer(targetUrl.hostname);
  if (referer) {
    upstreamHeaders.set("Referer", referer);
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl.toString(), {
      method: request.method,
      headers: upstreamHeaders,
      redirect: "follow",
    });
  } catch (error) {
    console.error("Failed to fetch upstream image", {
      url: upstreamUrl.toString(),
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError("Failed to fetch image from upstream", 502);
  }

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return jsonError(
      `Upstream image request failed with status ${upstreamResponse.status}`,
      502,
    );
  }

  const contentType = upstreamResponse.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    return jsonError("Upstream response is not an image", 415);
  }

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set(
    "Cache-Control",
    "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
  );
  headers.set("Cross-Origin-Resource-Policy", "same-origin");

  const contentLength = upstreamResponse.headers.get("content-length");
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  return new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
    status: 200,
    headers,
  });
}
