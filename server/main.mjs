import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import {
  downloadGlb,
  queryAiModel,
  serializeAiError,
  submitAiModel,
  testAiProvider,
} from "../shared/ai-providers.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "..");
const distDirectory = path.join(projectRoot, "dist");
const host = process.env.NIENIE_HOST || "127.0.0.1";
const port = Number(process.env.NIENIE_PORT || 8787);
const modelCache = new Map();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 15 * 1024 * 1024) throw Object.assign(new Error("请求内容过大"), { status: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("请求格式不是有效 JSON"), { status: 400 });
  }
}

function rememberModel(sourceUrl) {
  pruneModelCache();
  while (modelCache.size >= 8) {
    const oldest = modelCache.keys().next().value;
    if (!oldest) break;
    modelCache.delete(oldest);
  }
  const token = randomUUID();
  modelCache.set(token, { sourceUrl, buffer: null, expiresAt: Date.now() + 60 * 60 * 1000 });
  return `/api/ai3d/model/${token}`;
}

function pruneModelCache() {
  const now = Date.now();
  for (const [token, item] of modelCache) {
    if (item.expiresAt <= now) modelCache.delete(token);
  }
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname.startsWith("/api/ai3d/model/")) {
    pruneModelCache();
    const token = url.pathname.slice("/api/ai3d/model/".length);
    const cached = modelCache.get(token);
    if (!cached) return sendJson(response, 404, { error: "模型链接已失效，请重新生成" });
    if (!cached.buffer) cached.buffer = await downloadGlb(cached.sourceUrl);
    response.writeHead(200, {
      "Content-Type": "model/gltf-binary",
      "Content-Length": cached.buffer.length,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(cached.buffer);
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" });
    response.end();
    return;
  }

  const body = await readJson(request);
  if (url.pathname === "/api/ai3d/test") {
    return sendJson(response, 200, await testAiProvider(body));
  }
  if (url.pathname === "/api/ai3d/submit") {
    return sendJson(response, 202, await submitAiModel(body));
  }
  if (url.pathname === "/api/ai3d/query") {
    const result = await queryAiModel(body);
    if (result.status === "completed" && result.modelUrl) {
      result.modelUrl = rememberModel(result.modelUrl);
    }
    return sendJson(response, 200, result);
  }
  return sendJson(response, 404, { error: "接口不存在" });
}

async function serveStatic(response, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const requested = path.resolve(distDirectory, `.${pathname}`);
  const safePrefix = `${distDirectory}${path.sep}`;
  if (requested !== path.join(distDirectory, "index.html") && !requested.startsWith(safePrefix)) {
    response.writeHead(403);
    response.end();
    return;
  }

  let filePath = requested;
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    filePath = path.join(distDirectory, "index.html");
  }

  try {
    const data = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": path.basename(filePath) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
  try {
    if (url.pathname.startsWith("/api/ai3d/")) await handleApi(request, response, url);
    else await serveStatic(response, url);
  } catch (error) {
    const serialized = serializeAiError(error);
    const message = serialized.code === "UNKNOWN_ERROR" && error?.message
      ? error.message
      : serialized.message;
    sendJson(response, error?.status || serialized.status || 500, { error: message, code: serialized.code });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`捏捏宠 Web 服务：http://${host}:${port}\n`);
});
