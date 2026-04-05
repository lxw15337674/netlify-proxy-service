import { handleImageProxy } from "./image-proxy-core.mjs";

export default async function handler(request) {
  return handleImageProxy(request);
}
