import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { PetScene, type SceneStatus } from "../three/PetScene";
import type { FeelPreset } from "../three/SoftBodySolver";

export interface ModelViewportHandle {
  reset(): void;
  snapshot(): void;
}

interface ModelViewportProps {
  modelUrl: string;
  compactFraming: boolean;
  feel: FeelPreset;
  clayMode: boolean;
  reducedMotion: boolean;
  onStatus(status: SceneStatus): void;
  onGrabChange(grabbing: boolean): void;
}

export const ModelViewport = forwardRef<ModelViewportHandle, ModelViewportProps>(
  function ModelViewport(
    { modelUrl, compactFraming, feel, clayMode, reducedMotion, onStatus, onGrabChange },
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
        reset: () => sceneRef.current?.reset(),
        snapshot: () => sceneRef.current?.snapshot(),
      }),
      [],
    );

    return (
      <canvas
        ref={canvasRef}
        className="pet-canvas"
        aria-label="可拖拽变形的奶龙 3D 模型"
      />
    );
  },
);
