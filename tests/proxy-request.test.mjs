import test from "node:test";
import assert from "node:assert/strict";

import { handleProxyRequest } from "../netlify/functions/proxy-core.mjs";

test("GET /proxy/request proxies query parameters", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.example.com/data");
    assert.equal(init.method, "GET");
    assert.equal(init.headers.get("Origin"), "https://origin.example.com");
    assert.equal(init.headers.get("Authorization"), "Bearer token");

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-upstream": "yes"
      }
    });
  };

  try {
    const result = await handleProxyRequest({
      httpMethod: "GET",
      headers: {},
      queryStringParameters: {
        url: "https://api.example.com/data",
        origin: "https://origin.example.com",
        headers: "{\"Authorization\":\"Bearer token\"}"
      }
    });

    assert.equal(result.statusCode, 200);
    const body = JSON.parse(result.body);
    assert.equal(body.success, true);
    assert.equal(body.status, 200);
    assert.deepEqual(body.data, { ok: true });
    assert.equal(body.headers["x-upstream"], "yes");
  } finally {
    global.fetch = originalFetch;
  }
});

test("POST /proxy/request forwards request body", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.example.com/items");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.get("Content-Type"), "application/json");
    assert.equal(init.body, "{\"hello\":\"world\"}");

    return new Response("created", {
      status: 201,
      headers: {
        "content-type": "text/plain; charset=utf-8"
      }
    });
  };

  try {
    const result = await handleProxyRequest({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({
        url: "https://api.example.com/items",
        method: "POST",
        body: "{\"hello\":\"world\"}"
      })
    });

    assert.equal(result.statusCode, 200);
    const body = JSON.parse(result.body);
    assert.equal(body.success, true);
    assert.equal(body.status, 201);
    assert.equal(body.data, "created");
  } finally {
    global.fetch = originalFetch;
  }
});

test("API key is enforced when API_SECRET_KEY is set", async () => {
  const previous = process.env.API_SECRET_KEY;
  process.env.API_SECRET_KEY = "secret";

  try {
    const result = await handleProxyRequest({
      httpMethod: "GET",
      headers: {},
      queryStringParameters: {
        url: "https://api.example.com/data"
      }
    });

    assert.equal(result.statusCode, 401);
    const body = JSON.parse(result.body);
    assert.equal(body.success, false);
  } finally {
    process.env.API_SECRET_KEY = previous;
  }
});
