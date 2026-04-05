import test from "node:test";
import assert from "node:assert/strict";

import { handleImageProxy } from "../netlify/functions/image-proxy-core.mjs";

test("image proxy streams allowed image hosts", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    assert.equal(String(url), "https://p3.douyinpic.com/image.jpeg");
    assert.equal(init.headers.get("Referer"), "https://www.douyin.com/");
    return new Response("image-bytes", {
      status: 200,
      headers: {
        "content-type": "image/jpeg",
        "content-length": "11",
      },
    });
  };

  try {
    const response = await handleImageProxy(
      new Request("https://proxy.example.com/api/proxy-image?url=https%3A%2F%2Fp3.douyinpic.com%2Fimage.jpeg"),
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.equal(await response.text(), "image-bytes");
  } finally {
    global.fetch = originalFetch;
  }
});

test("image proxy rejects unknown hosts", async () => {
  const response = await handleImageProxy(
    new Request("https://proxy.example.com/api/proxy-image?url=https%3A%2F%2Fevil.example.com%2Ftest.png"),
  );

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, "Host is not allowed");
});
