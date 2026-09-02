import {
  ArrowCounterClockwise,
  CheckCircle,
  Eye,
  EyeSlash,
  ImageSquare,
  Key,
  MagicWand,
  SpinnerGap,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import {
  forgetAiKey,
  getAiCredentialState,
  queryModel,
  submitModel,
  testProvider,
} from "../ai/client";

interface AiModelDialogProps {
  open: boolean;
  isDesktop: boolean;
  usingGeneratedModel: boolean;
  onClose(): void;
  onModelReady(url: string): void;
  onUseDefault(): void;
}

type RequestState = "idle" | "testing" | "success" | "error" | "generating";

interface ReferenceImage {
  dataUrl: string;
  name: string;
  size: number;
  width: number;
  height: number;
}

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const PROVIDERS: Array<{
  id: AiProvider;
  name: string;
  detail: string;
  hint: string;
}> = [
  {
    id: "tencent",
    name: "腾讯混元",
    detail: "国内线路 · HY-3D-3.0",
    hint: "国内网络优先，输出 GLB 并限制为约 10K 面。",
  },
  {
    id: "tripo",
    name: "Tripo",
    detail: "海外线路 · P1 低模",
    hint: "低模生成更快，但部分国内网络可能连接超时。",
  },
];

function savedProvider(): AiProvider {
  const value = window.localStorage.getItem("nienie-ai-provider");
  return value === "tripo" ? "tripo" : "tencent";
}

function savedInputType(): AiGenerationInputType {
  return window.localStorage.getItem("nienie-ai-input-type") === "image" ? "image" : "text";
}

function formatImageSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function readReferenceImage(file: File): Promise<ReferenceImage> {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    throw new Error("仅支持 JPG、PNG 或 WebP 图片。");
  }
  if (file.size === 0) throw new Error("图片内容为空，请重新选择。");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("图片不能超过 10 MB。");

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("无法读取这张图片。"));
    reader.onerror = () => reject(new Error("无法读取这张图片。"));
    reader.readAsDataURL(file);
  });
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("图片已损坏或浏览器无法识别。"));
    image.src = dataUrl;
  });
  if (dimensions.width < 128 || dimensions.height < 128) {
    throw new Error("图片宽高都需要至少 128 px，建议使用 256 px 以上图片。");
  }
  if (dimensions.width > 5000 || dimensions.height > 5000) {
    throw new Error("图片宽高不能超过 5000 px。");
  }
  return { dataUrl, name: file.name, size: file.size, ...dimensions };
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function AiModelDialog({
  open,
  isDesktop,
  usingGeneratedModel,
  onClose,
  onModelReady,
  onUseDefault,
}: AiModelDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const [provider, setProvider] = useState<AiProvider>(savedProvider);
  const [inputType, setInputType] = useState<AiGenerationInputType>(savedInputType);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [remember, setRemember] = useState(isDesktop);
  const [canStoreSecurely, setCanStoreSecurely] = useState(false);
  const [savedProviders, setSavedProviders] = useState<AiProvider[]>([]);
  const [prompt, setPrompt] = useState("一个圆润可爱的原创小怪兽桌宠，完整身体，站立姿势，正面朝向，简洁卡通配色");
  const [referenceImage, setReferenceImage] = useState<ReferenceImage>();
  const [dragActive, setDragActive] = useState(false);
  const [apiKeyError, setApiKeyError] = useState("");
  const [promptError, setPromptError] = useState("");
  const [imageError, setImageError] = useState("");
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [statusMessage, setStatusMessage] = useState(() =>
    isDesktop
      ? "填写自己的 API Key，费用由对应账户承担；可使用 Windows 加密保存在本机。"
      : "填写自己的 API Key，费用由对应账户承担；刷新或关闭页面后不会保存 Key。",
  );
  const [progress, setProgress] = useState<number>();

  const hasSavedKey = savedProviders.includes(provider);
  const busy = requestState === "testing" || requestState === "generating";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open || !isDesktop) return;
    getAiCredentialState()
      .then((state) => {
        if (!mountedRef.current) return;
        setCanStoreSecurely(state.canStoreSecurely);
        setSavedProviders(state.savedProviders);
      })
      .catch((error) => {
        if (!mountedRef.current) return;
        setRequestState("error");
        setStatusMessage(error.message);
      });
  }, [isDesktop, open]);

  const chooseProvider = (nextProvider: AiProvider) => {
    if (busy) return;
    setProvider(nextProvider);
    setApiKey("");
    setApiKeyError("");
    setImageError(
      nextProvider === "tencent" && referenceImage && referenceImage.size > 6 * 1024 * 1024
        ? "腾讯混元要求原图不超过 6 MB；可压缩图片或切换 Tripo。"
        : "",
    );
    setRequestState("idle");
    setProgress(undefined);
    window.localStorage.setItem("nienie-ai-provider", nextProvider);
    const nextSaved = savedProviders.includes(nextProvider);
    setStatusMessage(
      nextSaved
        ? "已在本机安全保存这个服务的 Key，可以直接测试或生成。"
        : PROVIDERS.find((item) => item.id === nextProvider)?.hint ?? "填写 API Key 后测试连接。",
    );
  };

  const chooseInputType = (nextInputType: AiGenerationInputType) => {
    if (busy) return;
    setInputType(nextInputType);
    setPromptError("");
    setImageError(
      nextInputType === "image" && provider === "tencent" && referenceImage && referenceImage.size > 6 * 1024 * 1024
        ? "腾讯混元要求原图不超过 6 MB；可压缩图片或切换 Tripo。"
        : "",
    );
    setRequestState("idle");
    setProgress(undefined);
    window.localStorage.setItem("nienie-ai-input-type", nextInputType);
    setStatusMessage(
      nextInputType === "image"
        ? "上传主体清晰、背景简单的单张图片，AI 会从图片还原 3D 角色。"
        : PROVIDERS.find((item) => item.id === provider)?.hint ?? "输入描述后生成 3D 角色。",
    );
  };

  const validateKey = () => {
    const valid = Boolean(apiKey.trim() || hasSavedKey);
    setApiKeyError(valid ? "" : "请填写 API Key，或先保存一个可用的 Key。");
    return valid;
  };

  const validatePrompt = () => {
    const length = prompt.trim().length;
    const message = length < 2 ? "请至少输入两个字。" : length > 500 ? "模型描述不能超过 500 个字符。" : "";
    setPromptError(message);
    return !message;
  };

  const validateImage = () => {
    let message = referenceImage ? "" : "请先选择一张角色参考图。";
    if (!message && provider === "tencent" && referenceImage && referenceImage.size > 6 * 1024 * 1024) {
      message = "腾讯混元要求原图不超过 6 MB；可压缩图片或切换 Tripo。";
    }
    setImageError(message);
    return !message;
  };

  const handleImageFile = async (file?: File) => {
    if (!file || busy) return;
    setImageError("");
    try {
      const image = await readReferenceImage(file);
      setReferenceImage(image);
      if (provider === "tencent" && image.size > 6 * 1024 * 1024) {
        setImageError("腾讯混元要求原图不超过 6 MB；可压缩图片或切换 Tripo。");
      }
    } catch (error) {
      setReferenceImage(undefined);
      setImageError(error instanceof Error ? error.message : "无法读取这张图片。");
    }
  };

  const commonInput = () => ({
    provider,
    apiKey: apiKey.trim() || undefined,
    remember: isDesktop && canStoreSecurely && remember,
  });

  const handleTest = async () => {
    if (!validateKey()) return;
    setRequestState("testing");
    setStatusMessage(`正在连接${provider === "tencent" ? "腾讯混元" : " Tripo"}…`);
    setProgress(undefined);
    try {
      const result = await testProvider(commonInput());
      if (!mountedRef.current) return;
      setRequestState("success");
      setStatusMessage(`${result.message} · ${result.latencyMs} ms`);
      if (isDesktop && remember && apiKey.trim()) {
        setSavedProviders((current) => current.includes(provider) ? current : [...current, provider]);
        setApiKey("");
      }
    } catch (error) {
      if (!mountedRef.current) return;
      setRequestState("error");
      setStatusMessage(error instanceof Error ? error.message : "连接测试失败");
    }
  };

  const handleForget = async () => {
    if (!hasSavedKey || busy) return;
    try {
      await forgetAiKey(provider);
      setSavedProviders((current) => current.filter((item) => item !== provider));
      setRequestState("idle");
      setStatusMessage("已从本机删除这个服务的 API Key。");
    } catch (error) {
      setRequestState("error");
      setStatusMessage(error instanceof Error ? error.message : "删除 Key 失败");
    }
  };

  const handleGenerate = async () => {
    const contentValid = inputType === "text" ? validatePrompt() : validateImage();
    if (!validateKey() || !contentValid) return;
    setRequestState("generating");
    setStatusMessage(inputType === "image" ? "正在上传参考图并提交 3D 任务…" : "正在提交 3D 生成任务…");
    setProgress(0);

    try {
      const input = commonInput();
      const task = await submitModel({
        ...input,
        inputType,
        ...(inputType === "text"
          ? { prompt: prompt.trim() }
          : { imageData: referenceImage?.dataUrl, imageName: referenceImage?.name }),
      });
      if (isDesktop && remember && apiKey.trim()) {
        setSavedProviders((current) => current.includes(provider) ? current : [...current, provider]);
        setApiKey("");
      }
      setStatusMessage("任务已提交，正在生成约 10K 面的 GLB 模型…");

      for (let attempt = 0; attempt < 240; attempt += 1) {
        await delay(attempt === 0 ? 1200 : 2500);
        if (!mountedRef.current) return;
        const result = await queryModel({
          ...input,
          apiKey: input.apiKey || apiKey.trim() || undefined,
          taskId: task.taskId,
          model: task.model,
        });
        if (typeof result.progress === "number") setProgress(result.progress);
        if (result.status === "failed") throw new Error(result.message || "模型生成失败");
        if (result.status === "completed") {
          if (!result.modelUrl) throw new Error("生成完成，但没有找到 GLB 下载地址");
          setProgress(100);
          setRequestState("success");
          setStatusMessage("生成完成，正在把新角色装进三种互动模式。");
          onModelReady(new URL(result.modelUrl, window.location.href).href);
          return;
        }
        setStatusMessage(result.status === "queued" ? "任务正在排队…" : "模型生成中，请保持窗口开启…");
      }
      throw new Error("生成等待超时，可以稍后重试");
    } catch (error) {
      if (!mountedRef.current) return;
      setRequestState("error");
      setProgress(undefined);
      setStatusMessage(error instanceof Error ? error.message : "模型生成失败");
    }
  };

  const handleDefault = () => {
    onUseDefault();
    setRequestState("success");
    setStatusMessage("已恢复内置奶龙模型。");
  };

  return (
    <dialog
      ref={dialogRef}
      className={`ai-model-dialog ${isDesktop ? "is-desktop" : ""}`}
      aria-labelledby="ai-model-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      onClose={() => {
        if (open && !busy) onClose();
      }}
    >
      <form className="ai-dialog-form" onSubmit={(event) => event.preventDefault()}>
      <div className="ai-dialog-header">
        <div className="ai-dialog-title">
          <span className="ai-dialog-icon" aria-hidden="true"><MagicWand size={21} weight="fill" /></span>
          <div>
            <span id="ai-model-title">AI 生成桌宠</span>
            <small>使用你自己的模型服务额度</small>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="关闭 AI 生成设置"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>

      <div className="ai-dialog-body">
        <fieldset className="ai-fieldset" disabled={busy}>
          <legend>模型服务</legend>
          <div className="provider-selector">
            {PROVIDERS.map((item) => (
              <button
                key={item.id}
                className={provider === item.id ? "is-selected" : ""}
                type="button"
                aria-pressed={provider === item.id}
                onClick={() => chooseProvider(item.id)}
              >
                <span>{item.name}</span>
                <small>{item.detail}</small>
              </button>
            ))}
          </div>
          <p className="ai-helper">{PROVIDERS.find((item) => item.id === provider)?.hint}</p>
        </fieldset>

        <fieldset className="ai-fieldset" disabled={busy}>
          <legend>生成方式</legend>
          <div className="generation-selector" role="group" aria-label="选择生成方式">
            <button
              className={inputType === "text" ? "is-selected" : ""}
              type="button"
              aria-pressed={inputType === "text"}
              onClick={() => chooseInputType("text")}
            >
              <MagicWand size={17} aria-hidden="true" />文字生成
            </button>
            <button
              className={inputType === "image" ? "is-selected" : ""}
              type="button"
              aria-pressed={inputType === "image"}
              onClick={() => chooseInputType("image")}
            >
              <ImageSquare size={17} aria-hidden="true" />图片生成
            </button>
          </div>
        </fieldset>

        <div className="ai-form-field">
          <div className="ai-label-row">
            <label htmlFor="ai-api-key"><Key size={15} aria-hidden="true" />API Key</label>
            {hasSavedKey && <span className="saved-badge"><CheckCircle size={14} weight="fill" />本机已保存</span>}
          </div>
          <div className={`secret-input ${apiKeyError ? "is-invalid" : ""}`}>
            <input
              id="ai-api-key"
              type={showKey ? "text" : "password"}
              value={apiKey}
              autoComplete="off"
              spellCheck={false}
              placeholder={hasSavedKey ? "留空则使用本机保存的 Key" : provider === "tripo" ? "tsk_…" : "sk-…"}
              aria-describedby={apiKeyError ? "ai-api-key-error" : "ai-key-help"}
              aria-invalid={Boolean(apiKeyError)}
              disabled={busy}
              onBlur={validateKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                if (apiKeyError) setApiKeyError("");
              }}
            />
            <button
              type="button"
              aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
              disabled={busy}
              onClick={() => setShowKey((value) => !value)}
            >
              {showKey ? <EyeSlash size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <span id={apiKeyError ? "ai-api-key-error" : "ai-key-help"} className={`field-message ${apiKeyError ? "is-error" : ""}`}>
            {apiKeyError || (isDesktop ? "Key 只交给 Electron 主进程，界面不会读取已保存的明文。" : "网页端仅在当前会话使用，刷新页面后清除。")}
          </span>
        </div>

        {isDesktop && (
          <div className="credential-options">
            <label className="check-control">
              <input
                type="checkbox"
                checked={remember}
                disabled={busy || !canStoreSecurely}
                onChange={(event) => setRemember(event.target.checked)}
              />
              <span>使用 Windows 加密并记住 Key</span>
            </label>
            {hasSavedKey && (
              <button className="text-button is-danger" type="button" disabled={busy} onClick={handleForget}>
                <Trash size={15} />忘记 Key
              </button>
            )}
          </div>
        )}

        <button className="control-button ai-test-button" type="button" disabled={busy} onClick={handleTest}>
          {requestState === "testing" ? <SpinnerGap className="is-spinning" size={17} /> : <CheckCircle size={17} />}
          {requestState === "testing" ? "正在测试" : "测试连接"}
        </button>

        <div className={`ai-status is-${requestState}`} role="status" aria-live="polite" aria-atomic="true">
          {requestState === "testing" || requestState === "generating" ? (
            <SpinnerGap className="is-spinning" size={18} aria-hidden="true" />
          ) : requestState === "success" ? (
            <CheckCircle size={18} weight="fill" aria-hidden="true" />
          ) : requestState === "error" ? (
            <WarningCircle size={18} weight="fill" aria-hidden="true" />
          ) : (
            <Key size={18} aria-hidden="true" />
          )}
          <span>{statusMessage}</span>
          {requestState === "generating" && typeof progress === "number" && (
            <strong>{Math.round(progress)}%</strong>
          )}
        </div>

        <div className="ai-divider" />

        {inputType === "text" ? (
          <div className="ai-form-field">
            <div className="ai-label-row">
              <label htmlFor="ai-model-prompt">角色描述</label>
              <span className="character-count">{prompt.length}/500</span>
            </div>
            <textarea
              id="ai-model-prompt"
              rows={4}
              maxLength={500}
              value={prompt}
              aria-describedby={promptError ? "ai-prompt-error" : "ai-prompt-help"}
              aria-invalid={Boolean(promptError)}
              disabled={busy}
              onBlur={validatePrompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                if (promptError) setPromptError("");
              }}
            />
            <span id={promptError ? "ai-prompt-error" : "ai-prompt-help"} className={`field-message ${promptError ? "is-error" : ""}`}>
              {promptError || "会生成带贴图、约 10K 三角面的 GLB，完成后自动替换当前桌宠。"}
            </span>
          </div>
        ) : (
          <div className="ai-form-field">
            <div className="ai-label-row">
              <label htmlFor="ai-reference-image">角色参考图</label>
              <span className="character-count">JPG · PNG · WebP</span>
            </div>
            <input
              ref={fileInputRef}
              id="ai-reference-image"
              className="ai-file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-describedby={imageError ? "ai-image-error" : "ai-image-help"}
              aria-invalid={Boolean(imageError)}
              disabled={busy}
              onChange={(event) => {
                void handleImageFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            {referenceImage ? (
              <div className={`ai-image-preview ${imageError ? "is-invalid" : ""}`}>
                <img src={referenceImage.dataUrl} alt="已选择的角色参考图预览" />
                <div>
                  <strong title={referenceImage.name}>{referenceImage.name}</strong>
                  <span>{referenceImage.width} × {referenceImage.height} · {formatImageSize(referenceImage.size)}</span>
                </div>
                <button
                  className="text-button is-danger"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setReferenceImage(undefined);
                    setImageError("");
                  }}
                >
                  <Trash size={15} aria-hidden="true" />移除
                </button>
              </div>
            ) : (
              <div
                className={`ai-image-dropzone ${dragActive ? "is-dragging" : ""} ${imageError ? "is-invalid" : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (!busy) setDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? "none" : "copy";
                }}
                onDragLeave={(event) => {
                  const relatedTarget = event.relatedTarget;
                  if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
                    setDragActive(false);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  void handleImageFile(event.dataTransfer.files?.[0]);
                }}
              >
                <span className="ai-dropzone-icon" aria-hidden="true"><ImageSquare size={25} /></span>
                <div><strong>把角色图片拖到这里</strong><span>主体完整、正面清晰、背景简单效果更好</span></div>
                <button className="control-button" type="button" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                  <UploadSimple size={16} aria-hidden="true" />选择图片
                </button>
              </div>
            )}
            <span id={imageError ? "ai-image-error" : "ai-image-help"} className={`field-message ${imageError ? "is-error" : ""}`}>
              {imageError || `${provider === "tencent" ? "腾讯上限 6 MB" : "Tripo 上限 10 MB"}；宽高 128–5000 px，建议至少 256 px。图片不会保存在项目中。`}
            </span>
          </div>
        )}
      </div>

      <div className="ai-dialog-footer">
        {usingGeneratedModel && (
          <button className="text-button" type="button" disabled={busy} onClick={handleDefault}>
            <ArrowCounterClockwise size={16} />恢复奶龙
          </button>
        )}
        <button className="control-button ai-generate-button" type="button" disabled={busy} onClick={handleGenerate}>
          {requestState === "generating" ? <SpinnerGap className="is-spinning" size={18} /> : <MagicWand size={18} weight="fill" />}
          {requestState === "generating" ? "正在生成" : inputType === "image" ? "从图片生成" : "生成并使用"}
        </button>
      </div>
      </form>
    </dialog>
  );
}
