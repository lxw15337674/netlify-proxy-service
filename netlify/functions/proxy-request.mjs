import { handleProxyRequest } from "./proxy-core.mjs";

function headersToObject(headers) {
  const result = {};
  for (const [key, value] of headers.entries()) {
    result[key] = value;
  }
  return result;
}

export default async (request) => {
  const url = new URL(request.url);
  const event = {
    httpMethod: request.method,
    headers: headersToObject(request.headers),
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    body: request.method === "GET" || request.method === "HEAD" ? null : await request.text(),
  };

  const result = await handleProxyRequest(event);

  return new Response(result.body, {
    status: result.statusCode,
    headers: result.headers,
  });
};
