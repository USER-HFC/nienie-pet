import {
  ArrowCounterClockwise,
  Camera,
  DesktopTower,
  Drop,
  EyeSlash,
  HandGrabbing,
  Moon,
  PushPin,
  Sun,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    action: "直接拖动模型",
    detail: "触屏支持双指同时捏拉",
    loading: "正在建立柔软回弹约束",
  },
  clay: {
    headline: ["捏出造型，", "松手留下。"],
    body: "把奶龙捏成新造型，每次松手都会保存当前形状。",
    action: "捏出新造型",
    detail: "点击恢复按钮可回到原样",
    loading: "正在准备橡皮泥网格",
  },
  liquid: {
    headline: ["指尖一动，", "光就流动。"],
    body: "移动指针搅动液体，让奶龙在折射和涟漪中流动。",
    action: "移动指针搅动液体",
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
  const modelUrl = useMemo(
    () => new URL(`${import.meta.env.BASE_URL}assets/nailong.glb`, window.location.href).href,
    [],
  );
  const [mode, setMode] = useState<PetMode>("squish");
  const [liquidVersion, setLiquidVersion] = useState(0);
  const [grabbing, setGrabbing] = useState(false);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [reducedMotion, setReducedMotion] = useState(false);
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

  const toggleAlwaysOnTop = async () => {
    if (!window.desktopPet) return;
    const nextValue = !alwaysOnTop;
    await window.desktopPet.setAlwaysOnTop(nextValue);
    setAlwaysOnTop(nextValue);
  };

  const viewport = mode === "liquid" ? (
    <LiquidViewport
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
      key={mode}
      ref={viewportRef}
      modelUrl={modelUrl}
      compactFraming={isDesktop}
      feel={feelForMode(mode)}
      clayMode={mode === "clay"}
      reducedMotion={reducedMotion}
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

  if (isDesktop) {
    return (
      <main className={`desktop-pet is-${mode}`} aria-label="捏捏宠桌面窗口">
        <div className="desktop-drag-strip">
          <span>捏捏宠</span>
          <div className="desktop-window-actions">
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
          <div className="desktop-pet-controls">
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
              <span>{grabbing ? "继续拉，软体约束正在工作" : copy.detail}</span>
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
