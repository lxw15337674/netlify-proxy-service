# netlify-proxy-service

独立的 Netlify Functions 代理项目，用来替代原来的 NestJS 代理接口。

## 路由

- `GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD /api/parse`
- `GET|HEAD /api/proxy-image`
- `GET|HEAD /api/image-proxy`
- `GET|POST /proxy/request`

返回结构与原接口保持一致：

```json
{
  "success": true,
  "data": {},
  "status": 200,
  "headers": {},
  "contentType": "application/json"
}
```

## GET 参数

- `url` 必填，目标地址
- `method` 可选，默认 `GET`
- `origin` 可选
- `referer` 可选
- `userAgent` 可选
- `headers` 可选，JSON 字符串
- `body` 可选，JSON 字符串或普通字符串

示例：

```bash
curl 'http://localhost:8888/proxy/request?url=https%3A%2F%2Fhttpbin.org%2Fanything&headers=%7B%22x-demo%22%3A%22ok%22%7D'
```

## POST 请求体

```json
{
  "url": "https://httpbin.org/anything",
  "method": "POST",
  "origin": "https://example.com",
  "referer": "https://example.com/form",
  "headers": "{\"Authorization\":\"Bearer token\"}",
  "body": "{\"hello\":\"world\"}"
}
```

## 环境变量

- `API_BASE_URL`
  必填于生产环境。`/api/parse` 会把请求转发到 `${API_BASE_URL}/api/parse`。

- `API_SECRET_KEY`
  如果设置了这个值，请求时必须携带 `x-api-key` 或 `Authorization: Bearer <key>`。

- `ALLOWED_PROXY_HOSTS`
  可选，逗号分隔的目标域名白名单，例如：`api.github.com,httpbin.org`

## 本地开发

```bash
pnpm install
pnpm dev
```

## 测试

```bash
pnpm test
```
