import { forwardRef, useImperativeHandle, useRef } from "react";
import { LiquidObject } from "./canvasui/LiquidObject";

export interface LiquidViewportHandle {
  snapshot(): void;
}

interface LiquidViewportProps {
  modelUrl: string;
  compactFraming: boolean;
  reducedMotion: boolean;
  version: number;
  onLoad(): void;
  onError(error: unknown): void;
}

export const LiquidViewport = forwardRef<LiquidViewportHandle, LiquidViewportProps>(
  function LiquidViewport(
    { modelUrl, compactFraming, reducedMotion, version, onLoad, onError },
    forwardedRef,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(
      forwardedRef,
      () => ({
        snapshot() {
          const canvas = hostRef.current?.querySelector("canvas");
          if (!canvas) return;
          const link = document.createElement("a");
          link.download = `nienie-liquid-${Date.now()}.png`;
          link.href = canvas.toDataURL("image/png");
          link.click();
        },
      }),
      [],
    );

    return (
      <div ref={hostRef} className="liquid-viewport" aria-label="液体模式奶龙 3D 模型">
        <LiquidObject
          key={version}
          className="liquid-object"
          src={modelUrl}
          distortion={2.6}
          aberration={0.55}
          grain={0.32}
          sheen={1.35}
          cursorSize={0.82}
          cursorForce={1.35}
          persistence={0.72}
          swirl={0.82}
          iridescence={0.72}
          splash={1.15}
          ambient={reducedMotion ? 0 : 0.52}
          wobble={reducedMotion ? 0 : 0.62}
          highlight="#58bd92"
          environmentIntensity={1.15}
          brightness={1.04}
          saturation={1.05}
          background=""
          scale={compactFraming ? 2.15 : 2.7}
          yOffset={compactFraming ? -0.04 : -0.12}
          floatIntensity={reducedMotion ? 0 : 0.38}
          rotationIntensity={reducedMotion ? 0 : 0.16}
          floatSpeed={1.15}
          orbit
          zoom={false}
          autoRotate={false}
          fov={60}
          cameraDistance={4}
          onLoad={onLoad}
          onError={onError}
        />
      </div>
    );
  },
);
