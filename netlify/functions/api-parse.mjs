const DEFAULT_DEV_API_BASE_URL = "http://localhost:8080";
const UPSTREAM_UNAVAILABLE_STATUS = 503;

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "range",
];

function createJsonResponse(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

function createUpstreamUnavailableResponse(reason) {
  return createJsonResponse(
    {
      success: false,
      code: "SERVICE_UNAVAILABLE",
      status: UPSTREAM_UNAVAILABLE_STATUS,
      error: "Upstream API is unavailable.",
      details: {
        reason,
      },
    },
    UPSTREAM_UNAVAILABLE_STATUS,
  );
}

function resolveUpstreamBaseUrl() {
  const configuredBaseUrl = process.env.API_BASE_URL?.trim();

  if (!configuredBaseUrl) {
    if (process.env.NODE_ENV === "production") {
      return {
        baseUrl: null,
        issue: "missing_api_base_url",
      };
    }

    return {
      baseUrl: new URL(DEFAULT_DEV_API_BASE_URL),
    };
  }

  try {
    return {
      baseUrl: new URL(configuredBaseUrl),
    };
  } catch {
    return {
      baseUrl: null,
      issue: "invalid_api_base_url",
    };
  }
}

function buildUpstreamUrl(baseUrl, request) {
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL("/api/parse", baseUrl);
  upstreamUrl.search = incomingUrl.search;
  return upstreamUrl;
}

function buildUpstreamHeaders(request) {
  const headers = new Headers();

  for (const headerName of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

  return headers;
}

export default async function handler(request) {
  const { baseUrl, issue } = resolveUpstreamBaseUrl();
  if (!baseUrl) {
    return createUpstreamUnavailableResponse(issue);
  }

  const method = request.method.toUpperCase();
  const upstreamInit = {
    method,
    headers: buildUpstreamHeaders(request),
    body: method === "GET" || method === "HEAD" ? undefined : request.body,
    duplex: method === "GET" || method === "HEAD" ? undefined : "half",
    redirect: "follow",
    cache: "no-store",
  };

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(buildUpstreamUrl(baseUrl, request), upstreamInit);
  } catch (error) {
    console.error("Failed to reach upstream API", {
      pathname: "/api/parse",
      error: error instanceof Error ? error.message : String(error),
    });

    return createUpstreamUnavailableResponse("upstream_fetch_failed");
  }

  const responseHeaders = new Headers();
  for (const [key, value] of upstreamResponse.headers) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "content-encoding" || lowerKey === "transfer-encoding") {
      continue;
    }
    responseHeaders.set(key, value);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
