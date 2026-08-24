import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { PetScene, type SceneStatus } from "../three/PetScene";
import type { FeelPreset } from "../three/SoftBodySolver";

export interface ModelViewportHandle {
  poke(): void;
  reset(): void;
  snapshot(): void;
}

interface ModelViewportProps {
  modelUrl: string;
  compactFraming: boolean;
  feel: FeelPreset;
  clayMode: boolean;
  reducedMotion: boolean;
  showGrabFeedback: boolean;
  onStatus(status: SceneStatus): void;
  onGrabChange(grabbing: boolean): void;
}

export const ModelViewport = forwardRef<ModelViewportHandle, ModelViewportProps>(
  function ModelViewport(
    {
      modelUrl,
      compactFraming,
      feel,
      clayMode,
      reducedMotion,
      showGrabFeedback,
      onStatus,
      onGrabChange,
    },
    forwardedRef,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sceneRef = useRef<PetScene | null>(null);

    useEffect(() => {
      if (!canvasRef.current) return;
      const scene = new PetScene({
        canvas: canvasRef.current,
        modelUrl,
        compactFraming,
        reducedMotion,
        onStatus,
        onGrabChange,
      });
      sceneRef.current = scene;
      return () => {
        scene.dispose();
        sceneRef.current = null;
      };
    }, [compactFraming, modelUrl, onGrabChange, onStatus]);

    useEffect(() => {
      sceneRef.current?.setFeel(feel);
    }, [feel]);

    useEffect(() => {
      sceneRef.current?.setClayMode(clayMode);
    }, [clayMode]);

    useEffect(() => {
      sceneRef.current?.setReducedMotion(reducedMotion);
    }, [reducedMotion]);

    useImperativeHandle(
      forwardedRef,
      () => ({
        poke: () => sceneRef.current?.poke(),
        reset: () => sceneRef.current?.reset(),
        snapshot: () => sceneRef.current?.snapshot(),
      }),
      [],
    );

    return (
      <div className={`model-viewport ${showGrabFeedback ? "show-grab-feedback" : ""}`}>
        <canvas
          ref={canvasRef}
          className="pet-canvas"
          aria-keyshortcuts="Enter Space"
          aria-label="可拖拽变形的奶龙 3D 模型，按回车或空格可轻捏一下"
          tabIndex={0}
        />
        <div className="grab-feedback-layer" aria-hidden="true">
          <span className="grab-hover" />
          <span className="grab-origin" />
          <span className="grab-tether" />
          <span className="grab-handle" />
          <span className="poke-feedback" />
        </div>
      </div>
    );
  },
);
