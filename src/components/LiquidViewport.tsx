import { forwardRef, useImperativeHandle, useRef } from "react";
import { LiquidObject, type LiquidObjectHandle } from "./canvasui/LiquidObject";

export interface LiquidViewportHandle {
  rotate(direction: -1 | 1): void;
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
    const liquidObjectRef = useRef<LiquidObjectHandle>(null);

    useImperativeHandle(
      forwardedRef,
      () => ({
        rotate(direction) {
          liquidObjectRef.current?.orbitBy(direction * 0.24);
        },
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
      <div
        ref={hostRef}
        className="liquid-viewport"
        aria-keyshortcuts="ArrowLeft ArrowRight Home"
        aria-label="液体模式奶龙 3D 模型，拖动可旋转，左右方向键可微调视角"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            liquidObjectRef.current?.orbitBy(event.key === "ArrowLeft" ? -0.24 : 0.24);
          } else if (event.key === "Home") {
            event.preventDefault();
            liquidObjectRef.current?.resetOrbit();
          }
        }}
        onPointerDown={() => hostRef.current?.focus({ preventScroll: true })}
      >
        <LiquidObject
          ref={liquidObjectRef}
          key={version}
          className="liquid-object"
          src={modelUrl}
          distortion={2.05}
          aberration={0.44}
          grain={0.28}
          sheen={1.35}
          cursorSize={0.82}
          cursorForce={0.92}
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
