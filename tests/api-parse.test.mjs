import test from "node:test";
import assert from "node:assert/strict";

import apiParseHandler from "../netlify/functions/api-parse.mjs";

test("api parse proxies GET requests to API_BASE_URL", async () => {
  const previousBaseUrl = process.env.API_BASE_URL;
  process.env.API_BASE_URL = "https://upstream.example.com/base";

  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    assert.equal(String(url), "https://upstream.example.com/api/parse?url=https%3A%2F%2Fexample.com");
    assert.equal(init.method, "GET");
    assert.equal(init.headers.get("accept"), "application/json");

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-upstream": "parse",
      },
    });
  };

  try {
    const response = await apiParseHandler(
      new Request("https://proxy.example.com/api/parse?url=https%3A%2F%2Fexample.com", {
        headers: {
          accept: "application/json",
        },
      }),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-upstream"), "parse");
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    process.env.API_BASE_URL = previousBaseUrl;
    global.fetch = originalFetch;
  }
});

test("api parse returns 503 in production when API_BASE_URL is missing", async () => {
  const previousBaseUrl = process.env.API_BASE_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.API_BASE_URL;
  process.env.NODE_ENV = "production";

  try {
    const response = await apiParseHandler(
      new Request("https://proxy.example.com/api/parse?url=https%3A%2F%2Fexample.com"),
    );

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "SERVICE_UNAVAILABLE");
    assert.equal(body.details.reason, "missing_api_base_url");
  } finally {
    process.env.API_BASE_URL = previousBaseUrl;
    process.env.NODE_ENV = previousNodeEnv;
  }
});
