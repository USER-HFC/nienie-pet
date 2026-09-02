const PROVIDER_CONFIG = {
  tencent: {
    label: "腾讯混元",
    baseUrl: "https://tokenhub.tencentmaas.com",
    model: "hy-3d-3.0",
  },
  tripo: {
    label: "Tripo",
    baseUrl: "https://api.tripo3d.ai/v2/openapi",
    model: "P1-20260311",
  },
};

export const AI_PROVIDERS = Object.freeze(Object.keys(PROVIDER_CONFIG));

export class AiProviderError extends Error {
  constructor(message, { code = "PROVIDER_ERROR", status = 500 } = {}) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.status = status;
  }
}

function getProviderConfig(provider) {
  const config = PROVIDER_CONFIG[provider];
  if (!config) {
    throw new AiProviderError("暂不支持这个模型服务", {
      code: "UNSUPPORTED_PROVIDER",
      status: 400,
    });
  }
  return config;
}

function requireApiKey(apiKey) {
  const normalized = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!normalized) {
    throw new AiProviderError("请先填写 API Key", {
      code: "MISSING_API_KEY",
      status: 400,
    });
  }
  if (normalized.length > 512) {
    throw new AiProviderError("API Key 格式不正确", {
      code: "INVALID_API_KEY",
      status: 400,
    });
  }
  return normalized;
}

function requirePrompt(prompt) {
  const normalized = typeof prompt === "string" ? prompt.trim() : "";
  if (normalized.length < 2) {
    throw new AiProviderError("请至少输入两个字的模型描述", {
      code: "INVALID_PROMPT",
      status: 400,
    });
  }
  if (normalized.length > 500) {
    throw new AiProviderError("模型描述不能超过 500 个字符", {
      code: "INVALID_PROMPT",
      status: 400,
    });
  }
  return normalized;
}

const IMAGE_DATA_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\s]+)$/i;
const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function hasExpectedImageSignature(buffer, mimeType) {
  if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (mimeType === "image/webp") {
    return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  }
  return false;
}

function requireGenerationInput({ inputType = "text", prompt, imageData, provider }) {
  if (inputType === "text") {
    return { inputType, prompt: requirePrompt(prompt) };
  }
  if (inputType !== "image") {
    throw new AiProviderError("不支持这个生成方式", {
      code: "INVALID_INPUT_TYPE",
      status: 400,
    });
  }

  const match = typeof imageData === "string" ? imageData.match(IMAGE_DATA_PATTERN) : null;
  if (!match) {
    throw new AiProviderError("请选择 JPG、PNG 或 WebP 图片", {
      code: "INVALID_IMAGE",
      status: 400,
    });
  }

  const mimeType = match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, "");
  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    throw new AiProviderError("图片数据已损坏，请重新选择", {
      code: "INVALID_IMAGE",
      status: 400,
    });
  }
  if (
    buffer.length === 0
    || buffer.toString("base64").replace(/=+$/, "") !== base64.replace(/=+$/, "")
    || !hasExpectedImageSignature(buffer, mimeType)
  ) {
    throw new AiProviderError("图片数据已损坏，请重新选择", {
      code: "INVALID_IMAGE",
      status: 400,
    });
  }

  const maxBytes = provider === "tencent" ? 6 * 1024 * 1024 : 10 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    throw new AiProviderError(
      provider === "tencent" ? "腾讯混元要求原图不超过 6 MB" : "Tripo 要求原图不超过 10 MB",
      { code: "IMAGE_TOO_LARGE", status: 413 },
    );
  }

  return {
    inputType,
    image: {
      base64,
      buffer,
      mimeType,
      fileType: IMAGE_TYPES[mimeType],
    },
  };
}

function readableProviderError(provider, status, payload) {
  const config = getProviderConfig(provider);
  const vendorMessage =
    payload?.error?.message ?? payload?.message ?? payload?.error_message ?? payload?.suggestion;

  if (status === 401 || status === 403) return `${config.label} API Key 无效或没有访问权限`;
  if (status === 402) return `${config.label} 账户余额不足`;
  if (status === 429) return `${config.label} 请求过于频繁，请稍后再试`;
  if (typeof vendorMessage === "string" && vendorMessage.trim()) {
    return `${config.label}：${vendorMessage.trim().slice(0, 240)}`;
  }
  return `${config.label} 请求失败（HTTP ${status}）`;
}

async function requestJson(
  provider,
  path,
  { apiKey, method = "GET", body, timeoutMs = 15000, fetchImpl = fetch } = {},
) {
  const config = getProviderConfig(provider);
  const key = requireApiKey(apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${config.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text.slice(0, 240) };
      }
    }

    if (!response.ok) {
      throw new AiProviderError(readableProviderError(provider, response.status, payload), {
        code: "UPSTREAM_ERROR",
        status: response.status,
      });
    }
    return payload;
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error?.name === "AbortError") {
      throw new AiProviderError(`${config.label} 连接超时，请检查当前网络或切换服务`, {
        code: "TIMEOUT",
        status: 504,
      });
    }
    throw new AiProviderError(`${config.label} 暂时无法连接，请检查网络`, {
      code: "NETWORK_ERROR",
      status: 502,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadTripoImage({ apiKey, image, imageName, fetchImpl = fetch }) {
  const config = getProviderConfig("tripo");
  const key = requireApiKey(apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const form = new FormData();
  const safeName = typeof imageName === "string" && imageName.trim()
    ? imageName.trim().replace(/[^a-z0-9._-]/gi, "-").slice(-96)
    : `reference.${image.fileType}`;
  form.append("file", new Blob([image.buffer], { type: image.mimeType }), safeName);

  try {
    const response = await fetchImpl(`${config.baseUrl}/upload/sts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text.slice(0, 240) };
      }
    }
    if (!response.ok) {
      throw new AiProviderError(readableProviderError("tripo", response.status, payload), {
        code: "UPSTREAM_ERROR",
        status: response.status,
      });
    }
    const imageToken = payload?.data?.image_token ?? payload?.image_token;
    if (!imageToken) {
      throw new AiProviderError("Tripo 没有返回图片凭证", { code: "INVALID_RESPONSE" });
    }
    return String(imageToken);
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error?.name === "AbortError") {
      throw new AiProviderError("Tripo 图片上传超时，请检查当前网络", {
        code: "TIMEOUT",
        status: 504,
      });
    }
    throw new AiProviderError("Tripo 图片上传失败，请检查网络", {
      code: "NETWORK_ERROR",
      status: 502,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function testAiProvider({ provider, apiKey, fetchImpl = fetch }) {
  const startedAt = Date.now();

  if (provider === "tencent") {
    const payload = await requestJson(provider, "/v1/models", { apiKey, timeoutMs: 10000, fetchImpl });
    const models = Array.isArray(payload?.data)
      ? payload.data.map((item) => item?.id).filter((id) => typeof id === "string")
      : [];
    const preferred = models.filter((id) => id.toLowerCase().includes("3d"));
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      message: preferred.length > 0 ? `已连接 · ${preferred[0]} 可用` : "已连接腾讯 TokenHub",
      models: preferred,
    };
  }

  const payload = await requestJson(provider, "/user/balance", { apiKey, timeoutMs: 10000, fetchImpl });
  const balance = payload?.data?.balance ?? payload?.balance;
  return {
    ok: true,
    latencyMs: Date.now() - startedAt,
    message: typeof balance === "number" ? `已连接 · 余额 ${balance} credits` : "已连接 Tripo",
    balance: typeof balance === "number" ? balance : undefined,
  };
}

export async function submitAiModel({
  provider,
  apiKey,
  inputType = "text",
  prompt,
  imageData,
  imageName,
  fetchImpl = fetch,
}) {
  const config = getProviderConfig(provider);
  const input = requireGenerationInput({ inputType, prompt, imageData, provider });

  if (provider === "tencent") {
    const payload = await requestJson(provider, "/v1/api/3d/submit", {
      apiKey,
      method: "POST",
      timeoutMs: 30000,
      body: {
        model: config.model,
        ...(input.inputType === "text"
          ? { prompt: input.prompt }
          : { image_base64: input.image.base64 }),
        generate_type: "Normal",
        face_count: 10000,
        enable_pbr: false,
      },
      fetchImpl,
    });
    if (!payload?.id) {
      throw new AiProviderError("腾讯混元没有返回任务编号", { code: "INVALID_RESPONSE" });
    }
    return { taskId: String(payload.id), model: config.model, status: payload.status ?? "queued" };
  }

  const imageToken = input.inputType === "image"
    ? await uploadTripoImage({ apiKey, image: input.image, imageName, fetchImpl })
    : undefined;

  const payload = await requestJson(provider, "/task", {
    apiKey,
    method: "POST",
    timeoutMs: 30000,
    body: {
      type: input.inputType === "image" ? "image_to_model" : "text_to_model",
      model_version: config.model,
      ...(input.inputType === "text"
        ? { prompt: input.prompt }
        : {
            file: {
              type: input.image.fileType,
              file_token: imageToken,
            },
            enable_image_autofix: true,
          }),
      face_limit: 10000,
      texture: true,
      pbr: false,
      export_uv: true,
      auto_size: true,
    },
    fetchImpl,
  });
  const taskId = payload?.data?.task_id ?? payload?.task_id;
  if (!taskId) {
    throw new AiProviderError("Tripo 没有返回任务编号", { code: "INVALID_RESPONSE" });
  }
  return { taskId: String(taskId), model: config.model, status: "queued" };
}

function normalizeTencentStatus(payload) {
  const status = String(payload?.status ?? "in_progress").toLowerCase();
  if (status === "completed" || status === "done") return "completed";
  if (status === "failed" || status === "fail") return "failed";
  if (status === "queued" || status === "wait") return "queued";
  return "running";
}

function normalizeTripoStatus(payload) {
  const status = String(payload?.status ?? "running").toLowerCase();
  if (status === "success") return "completed";
  if (["failed", "cancelled", "banned", "expired"].includes(status)) return "failed";
  if (status === "queued") return "queued";
  return "running";
}

export async function queryAiModel({ provider, apiKey, taskId, model, fetchImpl = fetch }) {
  if (!taskId || typeof taskId !== "string") {
    throw new AiProviderError("生成任务编号无效", { code: "INVALID_TASK", status: 400 });
  }

  if (provider === "tencent") {
    const payload = await requestJson(provider, "/v1/api/3d/query", {
      apiKey,
      method: "POST",
      timeoutMs: 20000,
      body: { model: model || PROVIDER_CONFIG.tencent.model, id: taskId },
      fetchImpl,
    });
    const status = normalizeTencentStatus(payload);
    const files = Array.isArray(payload?.data) ? payload.data : [];
    const glb = files.find((item) => String(item?.type).toLowerCase() === "glb");
    return {
      status,
      progress: status === "completed" ? 100 : undefined,
      modelUrl: typeof glb?.url === "string" ? glb.url : undefined,
      previewUrl: typeof glb?.preview_image_url === "string" ? glb.preview_image_url : undefined,
      message: status === "failed" ? payload?.error?.message ?? "腾讯混元生成失败" : undefined,
    };
  }

  const response = await requestJson(provider, `/task/${encodeURIComponent(taskId)}`, {
    apiKey,
    timeoutMs: 20000,
    fetchImpl,
  });
  const payload = response?.data ?? response;
  const status = normalizeTripoStatus(payload);
  const output = payload?.output ?? {};
  const modelUrl = output?.pbr_model ?? output?.model ?? output?.base_model;
  return {
    status,
    progress: typeof payload?.progress === "number" ? payload.progress : undefined,
    modelUrl: typeof modelUrl === "string" ? modelUrl : undefined,
    previewUrl: typeof output?.rendered_image === "string" ? output.rendered_image : undefined,
    message: status === "failed" ? payload?.message ?? payload?.error ?? "Tripo 生成失败" : undefined,
  };
}

export async function downloadGlb(
  url,
  { timeoutMs = 120000, maxBytes = 40 * 1024 * 1024, fetchImpl = fetch } = {},
) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new AiProviderError("生成结果地址无效", { code: "INVALID_MODEL_URL" });
  }
  if (parsed.protocol !== "https:") {
    throw new AiProviderError("只允许下载 HTTPS 模型地址", { code: "INVALID_MODEL_URL" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(parsed, { redirect: "follow", signal: controller.signal });
    if (!response.ok) {
      throw new AiProviderError(`模型下载失败（HTTP ${response.status}）`, {
        code: "MODEL_DOWNLOAD_FAILED",
        status: response.status,
      });
    }
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > maxBytes) {
      throw new AiProviderError("生成模型超过 40 MB 限制", { code: "MODEL_TOO_LARGE", status: 413 });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new AiProviderError("生成模型超过 40 MB 限制", { code: "MODEL_TOO_LARGE", status: 413 });
    }
    if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "glTF") {
      throw new AiProviderError("生成结果不是有效的 GLB 模型", { code: "INVALID_GLB" });
    }
    return buffer;
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error?.name === "AbortError") {
      throw new AiProviderError("模型下载超时", { code: "MODEL_DOWNLOAD_TIMEOUT", status: 504 });
    }
    throw new AiProviderError("模型下载失败，请稍后重试", { code: "MODEL_DOWNLOAD_FAILED" });
  } finally {
    clearTimeout(timeout);
  }
}

export function serializeAiError(error) {
  if (error instanceof AiProviderError) {
    return { message: error.message, code: error.code, status: error.status };
  }
  return { message: "模型服务发生未知错误", code: "UNKNOWN_ERROR", status: 500 };
}
