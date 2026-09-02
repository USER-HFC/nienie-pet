import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { SoftBodySolver, type FeelPreset } from "./SoftBodySolver";

export type SceneLoadState = "loading" | "ready" | "error";

export interface SceneStatus {
  state: SceneLoadState;
  message: string;
  stats?: {
    particles: number;
    edges: number;
    bends: number;
  };
}

interface PetSceneOptions {
  canvas: HTMLCanvasElement;
  modelUrl: string;
  compactFraming: boolean;
  reducedMotion: boolean;
  onStatus(status: SceneStatus): void;
  onGrabChange(grabbing: boolean): void;
}

interface PointerGrab {
  plane: THREE.Plane;
  localPoint: THREE.Vector3;
  localNormal: THREE.Vector3;
  startClientX: number;
  startClientY: number;
  clientX: number;
  clientY: number;
  maxDistance: number;
}

export class PetScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();
  private readonly root = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resizeObserver: ResizeObserver;
  private readonly interactionRoot: HTMLElement | null;
  private readonly activePointers = new Map<number, PointerGrab>();
  private readonly onStatus: PetSceneOptions["onStatus"];
  private readonly onGrabChange: PetSceneOptions["onGrabChange"];
  private readonly compactFraming: boolean;
  private animationFrame = 0;
  private solver?: SoftBodySolver;
  private mesh?: THREE.Mesh;
  private disposed = false;
  private reducedMotion: boolean;
  private feel: FeelPreset = "bouncy";
  private clayMode = false;
  private baseScale = 1;

  constructor(options: PetSceneOptions) {
    this.canvas = options.canvas;
    this.onStatus = options.onStatus;
    this.onGrabChange = options.onGrabChange;
    this.compactFraming = options.compactFraming;
    this.reducedMotion = options.reducedMotion;
    this.interactionRoot = this.canvas.parentElement;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.camera.position.set(0, 0.05, 4.25);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.root);

    const hemisphere = new THREE.HemisphereLight(0xf8fff9, 0x4d5962, 2.35);
    const key = new THREE.DirectionalLight(0xfff4dc, 4.1);
    const fill = new THREE.DirectionalLight(0xb8e1d6, 2.2);
    key.position.set(3.2, 4.8, 5.5);
    fill.position.set(-4, 1.2, 2.5);
    this.scene.add(hemisphere, key, fill);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.bindPointerEvents();
    this.onStatus({ state: "loading", message: "正在整理模型的软体网格" });
    this.loadModel(options.modelUrl);
    this.resize();
    this.animate();
  }

  setFeel(preset: FeelPreset): void {
    this.feel = preset;
    this.solver?.setFeel(preset);
  }

  setClayMode(enabled: boolean): void {
    this.clayMode = enabled;
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  reset(): void {
    this.activePointers.clear();
    this.solver?.reset();
    this.root.rotation.set(0, 0, 0);
    this.clearInteractionFeedback();
    this.onGrabChange(false);
  }

  poke(): void {
    this.pokeAtCanvasCenter();
  }

  snapshot(): void {
    this.renderer.render(this.scene, this.camera);
    const link = document.createElement("a");
    link.download = `nienie-pet-${Date.now()}.png`;
    link.href = this.canvas.toDataURL("image/png");
    link.click();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.unbindPointerEvents();
    this.clearInteractionFeedback();
    this.renderer.dispose();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
  }

  private loadModel(url: string): void {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      url,
      (gltf) => {
        if (this.disposed) return;
        let largestMesh: THREE.Mesh | undefined;
        let largestVertexCount = 0;

        gltf.scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const count = object.geometry.getAttribute("position")?.count ?? 0;
          if (count > largestVertexCount) {
            largestVertexCount = count;
            largestMesh = object;
          }
        });

        if (!largestMesh) {
          this.onStatus({ state: "error", message: "模型里没有找到可变形网格" });
          return;
        }

        const selectedMesh = largestMesh as THREE.Mesh;
        selectedMesh.geometry = selectedMesh.geometry.clone();
        selectedMesh.frustumCulled = false;
        selectedMesh.geometry.computeBoundingBox();
        const bounds = selectedMesh.geometry.boundingBox;
        if (!bounds) {
          this.onStatus({ state: "error", message: "模型尺寸读取失败" });
          return;
        }

        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z, 1e-3);
        this.baseScale = (this.compactFraming ? 1.26 : 1.4) / maxDimension;
        gltf.scene.scale.setScalar(this.baseScale);
        gltf.scene.position.copy(center).multiplyScalar(-this.baseScale);

        this.root.add(gltf.scene);
        this.mesh = selectedMesh;
        this.solver = new SoftBodySolver(selectedMesh.geometry);
        this.solver.setFeel(this.feel);
        const stats = this.solver.getStats();
        this.onStatus({
          state: "ready",
          message: "软体模拟已就绪",
          stats: {
            particles: stats.particles,
            edges: stats.edges,
            bends: stats.bends,
          },
        });
      },
      undefined,
      (error) => {
        console.error(error);
        this.onStatus({ state: "error", message: "奶龙模型没有加载成功，请检查调试资源" });
      },
    );
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.mesh || !this.solver || (event.pointerType === "mouse" && event.button !== 0)) return;
    const maxPointers = event.pointerType === "touch" ? 2 : 1;
    if (this.activePointers.size >= maxPointers) return;

    this.updatePointer(event);
    this.mesh.updateMatrixWorld(true);
    const intersection = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!intersection?.face) return;

    const localPoint = this.mesh.worldToLocal(intersection.point.clone());
    const began = this.solver.beginGrab(intersection.face, localPoint, event.pointerId);
    if (!began) return;

    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    const cameraDirection = this.camera.getWorldDirection(new THREE.Vector3()).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(cameraDirection, intersection.point);
    this.activePointers.set(event.pointerId, {
      plane,
      localPoint: localPoint.clone(),
      localNormal: intersection.face.normal.clone().normalize(),
      startClientX: event.clientX,
      startClientY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY,
      maxDistance: 0,
    });
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.classList.add("is-grabbing");
    this.interactionRoot?.classList.add("is-grabbing");
    this.updateDragFeedback(event.clientX, event.clientY, event.clientX, event.clientY);
    this.onGrabChange(true);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const active = this.activePointers.get(event.pointerId);
    if (!this.mesh || !this.solver) return;

    this.updatePointer(event);
    if (!active) {
      const overPet = this.raycaster.intersectObject(this.mesh, false).length > 0;
      this.canvas.classList.toggle("is-over-pet", overPet);
      this.updateHoverFeedback(event, overPet);
      return;
    }

    event.preventDefault();
    const worldTarget = this.raycaster.ray.intersectPlane(active.plane, new THREE.Vector3());
    if (!worldTarget) return;
    const localTarget = this.mesh.worldToLocal(worldTarget.clone());
    this.solver.updateGrabTarget(event.pointerId, localTarget);

    const dx = event.clientX - active.startClientX;
    const dy = event.clientY - active.startClientY;
    active.clientX = event.clientX;
    active.clientY = event.clientY;
    active.maxDistance = Math.max(active.maxDistance, Math.hypot(dx, dy));
    this.updateDragFeedback(
      active.startClientX,
      active.startClientY,
      event.clientX,
      event.clientY,
    );
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    const active = this.activePointers.get(event.pointerId);
    if (!active || !this.solver) return;
    this.solver.endGrab(event.pointerId);
    this.activePointers.delete(event.pointerId);
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);

    const isTap = event.type === "pointerup" && active.maxDistance < 6;
    if (isTap) {
      const poked = this.solver.poke(
        active.localPoint,
        active.localNormal.clone().multiplyScalar(-1),
      );
      if (poked) this.playPokeFeedback(active.clientX, active.clientY);
    }

    if (this.activePointers.size === 0) {
      if (this.clayMode) this.solver.bakeCurrentShape();
      this.canvas.classList.remove("is-grabbing");
      this.interactionRoot?.classList.remove("is-grabbing");
      this.onGrabChange(false);
      this.updateHoverFeedback(event, false);
    } else {
      const remaining = this.activePointers.values().next().value as PointerGrab | undefined;
      if (remaining) {
        this.updateDragFeedback(
          remaining.startClientX,
          remaining.startClientY,
          remaining.clientX,
          remaining.clientY,
        );
      }
    }
  };

  private readonly onPointerLeave = (): void => {
    if (this.activePointers.size > 0) return;
    this.canvas.classList.remove("is-over-pet");
    this.interactionRoot?.classList.remove("is-over-pet");
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!event.repeat) this.pokeAtCanvasCenter();
  };

  private updatePointer(event: PointerEvent): void {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private updateHoverFeedback(event: PointerEvent, overPet: boolean): void {
    const root = this.interactionRoot;
    if (!root) return;
    const bounds = this.canvas.getBoundingClientRect();
    root.style.setProperty("--grab-pointer-x", `${event.clientX - bounds.left}px`);
    root.style.setProperty("--grab-pointer-y", `${event.clientY - bounds.top}px`);
    root.classList.toggle("is-over-pet", overPet);
  }

  private updateDragFeedback(
    originClientX: number,
    originClientY: number,
    pointerClientX: number,
    pointerClientY: number,
  ): void {
    const root = this.interactionRoot;
    if (!root) return;
    const bounds = this.canvas.getBoundingClientRect();
    const originX = originClientX - bounds.left;
    const originY = originClientY - bounds.top;
    const pointerX = pointerClientX - bounds.left;
    const pointerY = pointerClientY - bounds.top;
    const dx = pointerX - originX;
    const dy = pointerY - originY;
    root.style.setProperty("--grab-origin-x", `${originX}px`);
    root.style.setProperty("--grab-origin-y", `${originY}px`);
    root.style.setProperty("--grab-pointer-x", `${pointerX}px`);
    root.style.setProperty("--grab-pointer-y", `${pointerY}px`);
    root.style.setProperty("--grab-distance", `${Math.hypot(dx, dy)}px`);
    root.style.setProperty("--grab-angle", `${Math.atan2(dy, dx)}rad`);
  }

  private playPokeFeedback(clientX: number, clientY: number): void {
    const root = this.interactionRoot;
    const pulse = root?.querySelector<HTMLElement>(".poke-feedback");
    if (!root || !pulse) return;
    const bounds = this.canvas.getBoundingClientRect();
    pulse.style.left = `${clientX - bounds.left}px`;
    pulse.style.top = `${clientY - bounds.top}px`;
    pulse.getAnimations().forEach((animation) => animation.cancel());
    pulse.animate(
      this.reducedMotion
        ? [{ opacity: 0.75 }, { opacity: 0 }]
        : [
            { opacity: 0.82, transform: "translate(-50%, -50%) scale(0.45)" },
            { opacity: 0, transform: "translate(-50%, -50%) scale(1.7)" },
          ],
      { duration: this.reducedMotion ? 160 : 440, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  }

  private pokeAtCanvasCenter(): void {
    if (!this.mesh || !this.solver) return;
    this.pointer.set(0, 0);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.mesh.updateMatrixWorld(true);
    const intersection = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!intersection?.face) return;
    const localPoint = this.mesh.worldToLocal(intersection.point.clone());
    const poked = this.solver.poke(
      localPoint,
      intersection.face.normal.clone().normalize().multiplyScalar(-1),
    );
    if (!poked) return;
    if (this.clayMode) this.solver.bakeCurrentShape();
    const bounds = this.canvas.getBoundingClientRect();
    this.playPokeFeedback(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  }

  private clearInteractionFeedback(): void {
    this.canvas.classList.remove("is-grabbing", "is-over-pet");
    this.interactionRoot?.classList.remove("is-grabbing", "is-over-pet");
  }

  private bindPointerEvents(): void {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerEnd);
    this.canvas.addEventListener("pointercancel", this.onPointerEnd);
    this.canvas.addEventListener("lostpointercapture", this.onPointerEnd);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.canvas.addEventListener("keydown", this.onKeyDown);
  }

  private unbindPointerEvents(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerEnd);
    this.canvas.removeEventListener("pointercancel", this.onPointerEnd);
    this.canvas.removeEventListener("lostpointercapture", this.onPointerEnd);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("keydown", this.onKeyDown);
  }

  private resize(): void {
    const width = Math.max(this.canvas.clientWidth, 1);
    const height = Math.max(this.canvas.clientHeight, 1);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    const compactFit = this.compactFraming
      ? THREE.MathUtils.clamp(Math.min(width / 430, height / 540), 0.68, 1)
      : 1;
    this.root.scale.setScalar(compactFit);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private readonly animate = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 1 / 15);
    const elapsed = this.clock.elapsedTime;

    this.solver?.step(delta, this.reducedMotion);
    const tiltEase = 1 - Math.exp(-delta * 8);
    this.root.rotation.x = THREE.MathUtils.lerp(this.root.rotation.x, 0, tiltEase);
    this.root.rotation.y = THREE.MathUtils.lerp(this.root.rotation.y, 0, tiltEase);

    if (!this.reducedMotion && !this.solver?.hasActiveGrabs()) {
      this.root.position.y = Math.sin(elapsed * 1.45) * 0.018;
      this.root.rotation.z = Math.sin(elapsed * 0.78) * 0.012;
    } else {
      this.root.position.y = THREE.MathUtils.lerp(this.root.position.y, 0, tiltEase);
      this.root.rotation.z = THREE.MathUtils.lerp(this.root.rotation.z, 0, tiltEase);
    }

    this.renderer.render(this.scene, this.camera);
  };
}
