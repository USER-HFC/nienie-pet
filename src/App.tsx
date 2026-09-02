import {
  ArrowLeft,
  ArrowRight,
  ArrowCounterClockwise,
  Camera,
  Crosshair,
  DesktopTower,
  Drop,
  EyeSlash,
  HandGrabbing,
  MagicWand,
  Moon,
  PushPin,
  Sun,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiModelDialog } from "./components/AiModelDialog";
import { LiquidViewport, type LiquidViewportHandle } from "./components/LiquidViewport";
import { ModelViewport, type ModelViewportHandle } from "./components/ModelViewport";
import type { SceneStatus } from "./three/PetScene";
import type { FeelPreset } from "./three/SoftBodySolver";

type PetMode = "squish" | "clay" | "liquid";
type Theme = "light" | "dark";

const MODES: Array<{ id: PetMode; label: string; description: string }> = [
  { id: "squish", label: "捏捏", description: "柔软回弹" },
  { id: "clay", label: "橡皮泥", description: "保留造型" },
  { id: "liquid", label: "液体", description: "流动折射" },
];

const MODE_COPY: Record<PetMode, {
  headline: [string, string];
  body: string;
  action: string;
  detail: string;
  loading: string;
}> = {
  squish: {
    headline: ["现实可抓，", "松手会弹。"],
    body: "抓住奶龙，把它拉长、压扁，再看它恢复原样。",
    action: "拖住哪里，就拉哪里",
    detail: "轻点会戳一下 · 触屏支持双指捏拉",
    loading: "正在建立柔软回弹约束",
  },
  clay: {
    headline: ["捏出造型，", "松手留下。"],
    body: "把奶龙捏成新造型，每次松手都会保存当前形状。",
    action: "拖动塑形，松手定型",
    detail: "轻点留下凹痕 · 恢复按钮回到原样",
    loading: "正在准备橡皮泥网格",
  },
  liquid: {
    headline: ["指尖一动，", "光就流动。"],
    body: "移动指针搅动液体，让奶龙在折射和涟漪中流动。",
    action: "移动搅动 · 拖动旋转",
    detail: "点击模型会激起一圈液体冲击",
    loading: "正在建立 GPU 液体场",
  },
};

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem("nienie-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function initialGrabGuides(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem("nienie-grab-guides") !== "false";
}

function initialWindowFocus(): boolean {
  if (typeof document === "undefined") return true;
  return document.hasFocus();
}

function initialModelUrl(defaultUrl: string): string {
  if (!window.desktopPet) return defaultUrl;
  const saved = window.localStorage.getItem("nienie-active-model");
  return saved?.startsWith("nienie-model://local/") ? saved : defaultUrl;
}

function feelForMode(mode: PetMode): FeelPreset {
  return mode === "clay" ? "soft" : "bouncy";
}

export function App() {
  const viewportRef = useRef<ModelViewportHandle>(null);
  const liquidRef = useRef<LiquidViewportHandle>(null);
  const isDesktop = useMemo(
    () => new URLSearchParams(window.location.search).get("desktop") === "1",
    [],
  );
  const defaultModelUrl = useMemo(
    () => new URL(`${import.meta.env.BASE_URL}assets/nailong.glb`, window.location.href).href,
    [],
  );
  const [modelUrl, setModelUrl] = useState(() => initialModelUrl(defaultModelUrl));
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [mode, setMode] = useState<PetMode>("squish");
  const [liquidVersion, setLiquidVersion] = useState(0);
  const [grabbing, setGrabbing] = useState(false);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [showGrabGuides, setShowGrabGuides] = useState(initialGrabGuides);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [windowFocused, setWindowFocused] = useState(initialWindowFocus);
  const [status, setStatus] = useState<SceneStatus>({
    state: "loading",
    message: MODE_COPY.squish.loading,
  });
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.desktop = String(isDesktop);
    window.localStorage.setItem("nienie-theme", theme);
  }, [isDesktop, theme]);

  useEffect(() => {
    window.localStorage.setItem("nienie-grab-guides", String(showGrabGuides));
  }, [showGrabGuides]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!window.desktopPet) return;
    window.desktopPet.getState().then((state) => setAlwaysOnTop(state.alwaysOnTop));
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    const syncFocus = () => setWindowFocused(document.hasFocus());
    syncFocus();
    window.addEventListener("focus", syncFocus);
    window.addEventListener("blur", syncFocus);
    return () => {
      window.removeEventListener("focus", syncFocus);
      window.removeEventListener("blur", syncFocus);
    };
  }, [isDesktop]);

  useEffect(() => {
    setGrabbing(false);
    setStatus({ state: "loading", message: MODE_COPY[mode].loading });
  }, [mode]);

  const handleStatus = useCallback((nextStatus: SceneStatus) => setStatus(nextStatus), []);
  const handleGrabChange = useCallback((nextGrabbing: boolean) => setGrabbing(nextGrabbing), []);
  const handleLiquidLoad = useCallback(() => {
    setStatus({ state: "ready", message: "液体模拟已就绪" });
  }, []);
  const handleLiquidError = useCallback((error: unknown) => {
    console.error(error);
    setStatus({ state: "error", message: "液体模式没有加载成功" });
  }, []);

  const reset = () => {
    if (mode === "liquid") {
      setStatus({ state: "loading", message: MODE_COPY.liquid.loading });
      setLiquidVersion((value) => value + 1);
      return;
    }
    viewportRef.current?.reset();
  };

  const snapshot = () => {
    if (mode === "liquid") {
      liquidRef.current?.snapshot();
      return;
    }
    viewportRef.current?.snapshot();
  };

  const poke = () => viewportRef.current?.poke();
  const rotateLiquid = (direction: -1 | 1) => liquidRef.current?.rotate(direction);

  const useGeneratedModel = (url: string) => {
    setStatus({ state: "loading", message: "正在装载新桌宠" });
    setModelUrl(url);
    if (window.desktopPet && url.startsWith("nienie-model://local/")) {
      window.localStorage.setItem("nienie-active-model", url);
    }
    setLiquidVersion((value) => value + 1);
  };

  const useDefaultModel = () => {
    setStatus({ state: "loading", message: MODE_COPY[mode].loading });
    setModelUrl(defaultModelUrl);
    window.localStorage.removeItem("nienie-active-model");
    setLiquidVersion((value) => value + 1);
  };

  const toggleAlwaysOnTop = async () => {
    if (!window.desktopPet) return;
    const nextValue = !alwaysOnTop;
    await window.desktopPet.setAlwaysOnTop(nextValue);
    setAlwaysOnTop(nextValue);
  };

  const viewport = mode === "liquid" ? (
    <LiquidViewport
      key={`liquid-${modelUrl}-${liquidVersion}`}
      ref={liquidRef}
      modelUrl={modelUrl}
      compactFraming={isDesktop}
      reducedMotion={reducedMotion}
      version={liquidVersion}
      onLoad={handleLiquidLoad}
      onError={handleLiquidError}
    />
  ) : (
    <ModelViewport
      key={`viewport-${mode}-${modelUrl}`}
      ref={viewportRef}
      modelUrl={modelUrl}
      compactFraming={isDesktop}
      feel={feelForMode(mode)}
      clayMode={mode === "clay"}
      reducedMotion={reducedMotion}
      showGrabFeedback={showGrabGuides}
      onStatus={handleStatus}
      onGrabChange={handleGrabChange}
    />
  );

  const modeSelector = (compact = false) => (
    <div
      className={compact ? "desktop-mode-selector" : "mode-selector"}
      role="group"
      aria-label="互动模式"
    >
      {MODES.map((option) => (
        <button
          key={option.id}
          className={mode === option.id ? "is-selected" : ""}
          type="button"
          aria-pressed={mode === option.id}
          title={option.description}
          onClick={() => setMode(option.id)}
        >
          {compact ? option.label : (
            <>
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );

  const grabGuideToggle = (size: number) => (
    <button
      className={`icon-button ${showGrabGuides ? "is-active" : ""}`}
      type="button"
      aria-label={showGrabGuides ? "关闭抓取引导" : "显示抓取引导"}
      aria-pressed={showGrabGuides}
      data-tooltip={showGrabGuides ? "关闭抓取引导" : "显示抓取引导"}
      onClick={() => setShowGrabGuides((value) => !value)}
    >
      <Crosshair size={size} weight={showGrabGuides ? "bold" : "regular"} />
    </button>
  );

  if (isDesktop) {
    return (
      <>
        <main
          className={`desktop-pet is-${mode} ${windowFocused ? "is-window-focused" : "is-window-blurred"}`}
          aria-label="捏捏宠桌面窗口"
        >
          <div className="desktop-drag-strip">
            <span>捏捏宠</span>
            <div className="desktop-window-actions">
              <button
                className="icon-button"
                type="button"
                aria-label="AI 生成桌宠"
                data-tooltip="AI 生成桌宠"
                onClick={() => setAiDialogOpen(true)}
              >
                <MagicWand size={17} weight="fill" />
              </button>
              <button
                className={`icon-button ${alwaysOnTop ? "is-active" : ""}`}
                type="button"
                aria-label="切换窗口置顶"
                data-tooltip={alwaysOnTop ? "取消置顶" : "保持置顶"}
                onClick={toggleAlwaysOnTop}
              >
                <PushPin size={17} weight={alwaysOnTop ? "fill" : "regular"} />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="隐藏桌宠"
                data-tooltip="隐藏到托盘"
                onClick={() => window.desktopPet?.hide()}
              >
                <EyeSlash size={18} />
              </button>
            </div>
          </div>

          <section className="desktop-stage">
            {viewport}
            {status.state === "loading" && <LoadingState compact message={MODE_COPY[mode].loading} />}
            {status.state === "error" && <ErrorState message={status.message} />}
            <div key={`gesture-${mode}`} className="desktop-gesture-hint">
              {mode === "liquid"
                ? "移动搅动 · 拖动旋转"
                : mode === "clay"
                  ? "拖动塑形 · 松手定型"
                  : "拖动拉扯 · 轻点戳一下"}
            </div>
            <div className="desktop-pet-controls">
              {mode === "liquid" ? (
                <>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="向左旋转"
                    data-tooltip="向左旋转"
                    onClick={() => rotateLiquid(-1)}
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="向右旋转"
                    data-tooltip="向右旋转"
                    onClick={() => rotateLiquid(1)}
                  >
                    <ArrowRight size={18} />
                  </button>
                </>
              ) : (
                <>
                  {grabGuideToggle(18)}
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="轻捏一下"
                    data-tooltip="轻捏一下"
                    onClick={poke}
                  >
                    <HandGrabbing size={18} />
                  </button>
                </>
              )}
              <button
                className="icon-button"
                type="button"
                aria-label="恢复原样"
                data-tooltip="恢复原样"
                onClick={reset}
              >
                <ArrowCounterClockwise size={18} />
              </button>
              {modeSelector(true)}
            </div>
          </section>
        </main>
        <AiModelDialog
          open={aiDialogOpen}
          isDesktop={Boolean(window.desktopPet)}
          usingGeneratedModel={modelUrl !== defaultModelUrl}
          onClose={() => setAiDialogOpen(false)}
          onModelReady={useGeneratedModel}
          onUseDefault={useDefaultModel}
        />
      </>
    );
  }

  const copy = MODE_COPY[mode];

  return (
    <div className={`app-shell is-${mode}`}>
      <header className="site-header">
        <a className="brand" href="/" aria-label="捏捏宠首页">
          <span className="brand-mark" aria-hidden="true">捏</span>
          <span>捏捏宠</span>
        </a>
        <nav className="header-actions" aria-label="页面操作">
          <button
            className="control-button"
            type="button"
            onClick={() => setAiDialogOpen(true)}
          >
            <MagicWand size={18} weight="fill" />
            AI 生成
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="切换页面主题"
            data-tooltip={theme === "light" ? "切换深色" : "切换浅色"}
            onClick={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
          </button>
          <a className="control-button" href="?desktop=1" target="_blank" rel="noreferrer">
            <DesktopTower size={18} />
            预览桌宠
          </a>
        </nav>
      </header>

      <main className="studio-layout">
        <section className="intro-panel" aria-labelledby="page-title">
          <p className="eyebrow">三态桌宠实验</p>
          <h1 id="page-title">
            <span>{copy.headline[0]}</span>
            <span>{copy.headline[1]}</span>
          </h1>
          <p className="intro-copy">{copy.body}</p>

          <div className="interaction-note">
            {mode === "liquid" ? (
              <Drop size={24} weight="fill" />
            ) : (
              <HandGrabbing size={24} weight={grabbing ? "fill" : "regular"} />
            )}
            <div>
              <strong>{grabbing ? "抓住了" : copy.action}</strong>
              <span>
                {grabbing
                  ? mode === "clay"
                    ? "继续拖动，松手会保留这个形状"
                    : "继续拖动，松手会自然回弹"
                  : copy.detail}
              </span>
            </div>
          </div>

          <div className="mode-section">
            <span className="field-label">选择模式</span>
            {modeSelector()}
          </div>
        </section>

        <section className="stage-panel" aria-label={`${MODES.find((item) => item.id === mode)?.label}互动区`}>
          <div className="stage-toolbar">
            <div className="simulation-status" aria-live="polite">
              <span className={`status-light is-${status.state}`} aria-hidden="true" />
              <span>{status.message}</span>
            </div>
            <div className="stage-actions">
              {mode === "liquid" ? (
                <>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="向左旋转"
                    data-tooltip="向左旋转"
                    onClick={() => rotateLiquid(-1)}
                  >
                    <ArrowLeft size={19} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="向右旋转"
                    data-tooltip="向右旋转"
                    onClick={() => rotateLiquid(1)}
                  >
                    <ArrowRight size={19} />
                  </button>
                </>
              ) : (
                <>
                  {grabGuideToggle(19)}
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="轻捏一下"
                    data-tooltip="轻捏一下"
                    onClick={poke}
                  >
                    <HandGrabbing size={19} />
                  </button>
                </>
              )}
              <button
                className="icon-button"
                type="button"
                aria-label="恢复原样"
                data-tooltip="恢复原样"
                onClick={reset}
              >
                <ArrowCounterClockwise size={19} />
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="保存截图"
                data-tooltip="保存截图"
                onClick={snapshot}
              >
                <Camera size={19} />
              </button>
            </div>
          </div>

          <div className="viewport-wrap">
            {viewport}
            {status.state === "loading" && <LoadingState message={MODE_COPY[mode].loading} />}
            {status.state === "error" && <ErrorState message={status.message} />}
            {status.state === "ready" && status.stats && (
              <div className="mesh-stats" aria-label="软体模型统计">
                {status.stats.particles.toLocaleString()} 粒子
                <span aria-hidden="true">/</span>
                {status.stats.edges.toLocaleString()} 结构边
              </div>
            )}
          </div>
        </section>
      </main>
      <AiModelDialog
        open={aiDialogOpen}
        isDesktop={false}
        usingGeneratedModel={modelUrl !== defaultModelUrl}
        onClose={() => setAiDialogOpen(false)}
        onModelReady={useGeneratedModel}
        onUseDefault={useDefaultModel}
      />
    </div>
  );
}

function LoadingState({ compact = false, message }: { compact?: boolean; message: string }) {
  return (
    <div className={`loading-state ${compact ? "is-compact" : ""}`} role="status">
      <span className="loading-blob" aria-hidden="true" />
      {!compact && <span>{message}</span>}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="error-state" role="alert">
      <strong>模型暂时没出现</strong>
      <span>{message}</span>
    </div>
  );
}
