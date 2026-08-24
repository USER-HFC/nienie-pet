import * as THREE from "three";

export type FeelPreset = "fleshy" | "bouncy" | "soft";

interface FeelConfig {
  damping: number;
  edgeCompliance: number;
  bendCompliance: number;
  volumeCompliance: number;
  shapeCompliance: number;
  grabCompliance: number;
  grabRadius: number;
  iterations: number;
}

interface DistanceConstraints {
  a: Uint32Array;
  b: Uint32Array;
  rest: Float32Array;
  lambdas: Float32Array;
}

interface GrabConstraint {
  indices: Uint32Array;
  weights: Float32Array;
  starts: Float32Array;
  lambdas: Float32Array;
  origin: THREE.Vector3;
  target: THREE.Vector3;
}

interface EdgeRecord {
  a: number;
  b: number;
  opposite: number;
}

const FEEL_CONFIGS: Record<FeelPreset, FeelConfig> = {
  fleshy: {
    damping: 0.91,
    edgeCompliance: 5e-6,
    bendCompliance: 3e-5,
    volumeCompliance: 8e-9,
    shapeCompliance: 4e-4,
    grabCompliance: 4e-7,
    grabRadius: 0.34,
    iterations: 5,
  },
  bouncy: {
    damping: 0.974,
    edgeCompliance: 1.4e-5,
    bendCompliance: 6e-5,
    volumeCompliance: 2.5e-8,
    shapeCompliance: 1.1e-3,
    grabCompliance: 8e-7,
    grabRadius: 0.46,
    iterations: 6,
  },
  soft: {
    damping: 0.945,
    edgeCompliance: 4.8e-5,
    bendCompliance: 2.1e-4,
    volumeCompliance: 7e-8,
    shapeCompliance: 2.2e-3,
    grabCompliance: 1.3e-6,
    grabRadius: 0.56,
    iterations: 7,
  },
};

const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 3;

function smoothFalloff(value: number): number {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export class SoftBodySolver {
  private readonly geometry: THREE.BufferGeometry;
  private readonly renderPosition: THREE.BufferAttribute;
  private readonly renderToSimulation: Uint32Array;
  private readonly triangles: Uint32Array;
  private readonly inverseMasses: Float32Array;
  private readonly pinned: Uint8Array;
  private readonly originalRestPositions: Float32Array;
  private readonly restPositions: Float32Array;
  private readonly positions: Float32Array;
  private readonly previousPositions: Float32Array;
  private readonly predictedPositions: Float32Array;
  private readonly shapeLambdas: Float32Array;
  private readonly volumeGradients: Float32Array;
  private readonly edges: DistanceConstraints;
  private readonly bends: DistanceConstraints;
  private readonly grabs = new Map<number, GrabConstraint>();
  private readonly radius: number;
  private readonly restCenter: THREE.Vector3;
  private feel: FeelConfig = FEEL_CONFIGS.bouncy;
  private accumulator = 0;
  private restVolume = 0;
  private volumeLambda = 0;
  private normalFrame = 0;

  constructor(geometry: THREE.BufferGeometry) {
    this.geometry = geometry;

    const position = geometry.getAttribute("position");
    if (!(position instanceof THREE.BufferAttribute)) {
      throw new Error("模型缺少可编辑的位置缓冲区");
    }

    const index = geometry.getIndex();
    if (!index) {
      const generated = new Uint32Array(position.count);
      for (let i = 0; i < generated.length; i += 1) generated[i] = i;
      geometry.setIndex(new THREE.BufferAttribute(generated, 1));
    }

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    this.radius = Math.max(geometry.boundingSphere?.radius ?? 0.5, 1e-3);
    this.restCenter = geometry.boundingSphere?.center.clone() ?? new THREE.Vector3();
    this.renderPosition = position;

    const welded = this.weldVertices(position);
    this.renderToSimulation = welded.renderToSimulation;
    this.restPositions = new Float32Array(welded.simulationPositions);
    this.originalRestPositions = new Float32Array(welded.simulationPositions);
    this.positions = new Float32Array(welded.simulationPositions);
    this.previousPositions = new Float32Array(welded.simulationPositions);
    this.predictedPositions = new Float32Array(welded.simulationPositions);
    this.shapeLambdas = new Float32Array(welded.simulationPositions.length / 3);
    this.volumeGradients = new Float32Array(welded.simulationPositions.length);
    this.inverseMasses = new Float32Array(welded.simulationPositions.length / 3);
    this.inverseMasses.fill(1);
    this.pinned = new Uint8Array(this.inverseMasses.length);

    const topology = this.buildTopology();
    this.triangles = topology.triangles;
    this.edges = topology.edges;
    this.bends = topology.bends;
    this.initializePins();
    this.restVolume = this.computeVolume(this.restPositions);

    geometry.boundingSphere = new THREE.Sphere(this.restCenter.clone(), this.radius * 3.5);
  }

  setFeel(preset: FeelPreset): void {
    this.feel = FEEL_CONFIGS[preset];
  }

  beginGrab(face: { a: number; b: number; c: number }, point: THREE.Vector3, pointerId: number): boolean {
    const seeds = [
      this.renderToSimulation[face.a],
      this.renderToSimulation[face.b],
      this.renderToSimulation[face.c],
    ];
    const radius = this.radius * this.feel.grabRadius;
    const selected: number[] = [];
    const weights: number[] = [];

    for (let i = 0; i < this.inverseMasses.length; i += 1) {
      const offset = i * 3;
      const dx = this.positions[offset] - point.x;
      const dy = this.positions[offset + 1] - point.y;
      const dz = this.positions[offset + 2] - point.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > radius || this.inverseMasses[i] === 0) continue;
      selected.push(i);
      weights.push(smoothFalloff(1 - distance / radius));
    }

    if (selected.length === 0) {
      for (const seed of seeds) {
        if (this.inverseMasses[seed] === 0 || selected.includes(seed)) continue;
        selected.push(seed);
        weights.push(1);
      }
    }

    if (selected.length === 0) return false;

    const starts = new Float32Array(selected.length * 3);
    selected.forEach((particle, index) => {
      const source = particle * 3;
      const target = index * 3;
      starts[target] = this.positions[source];
      starts[target + 1] = this.positions[source + 1];
      starts[target + 2] = this.positions[source + 2];
    });

    this.grabs.set(pointerId, {
      indices: new Uint32Array(selected),
      weights: new Float32Array(weights),
      starts,
      lambdas: new Float32Array(selected.length),
      origin: point.clone(),
      target: point.clone(),
    });
    return true;
  }

  updateGrabTarget(pointerId: number, target: THREE.Vector3): void {
    const grab = this.grabs.get(pointerId);
    if (!grab) return;

    const delta = target.clone().sub(grab.origin);
    const limit = this.radius * 1.45;
    if (delta.lengthSq() > limit * limit) delta.setLength(limit);
    grab.target.copy(grab.origin).add(delta);
  }

  poke(point: THREE.Vector3, direction: THREE.Vector3, strength = 0.07): boolean {
    const normal = direction.clone();
    if (normal.lengthSq() < 1e-8) return false;
    normal.normalize();

    const radius = this.radius * Math.max(this.feel.grabRadius * 0.72, 0.24);
    const displacement = this.radius * strength;
    let affected = false;

    for (let i = 0; i < this.inverseMasses.length; i += 1) {
      if (this.inverseMasses[i] === 0) continue;
      const offset = i * 3;
      const dx = this.positions[offset] - point.x;
      const dy = this.positions[offset + 1] - point.y;
      const dz = this.positions[offset + 2] - point.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > radius) continue;

      const amount = displacement * smoothFalloff(1 - distance / radius);
      const x = normal.x * amount;
      const y = normal.y * amount;
      const z = normal.z * amount;
      this.positions[offset] += x;
      this.positions[offset + 1] += y;
      this.positions[offset + 2] += z;
      this.previousPositions[offset] += x;
      this.previousPositions[offset + 1] += y;
      this.previousPositions[offset + 2] += z;
      this.predictedPositions[offset] += x;
      this.predictedPositions[offset + 1] += y;
      this.predictedPositions[offset + 2] += z;
      affected = true;
    }

    if (affected) this.writeGeometry(true);
    return affected;
  }

  endGrab(pointerId?: number): void {
    if (pointerId === undefined) {
      this.grabs.clear();
      return;
    }
    this.grabs.delete(pointerId);
  }

  hasActiveGrabs(): boolean {
    return this.grabs.size > 0;
  }

  bakeCurrentShape(): void {
    this.restPositions.set(this.positions);
    this.previousPositions.set(this.positions);
    this.recomputeConstraintLengths(this.edges);
    this.recomputeConstraintLengths(this.bends);
    this.restVolume = this.computeVolume(this.restPositions);
  }

  reset(): void {
    this.grabs.clear();
    this.restPositions.set(this.originalRestPositions);
    this.positions.set(this.originalRestPositions);
    this.previousPositions.set(this.originalRestPositions);
    this.predictedPositions.set(this.originalRestPositions);
    this.recomputeConstraintLengths(this.edges);
    this.recomputeConstraintLengths(this.bends);
    this.restVolume = this.computeVolume(this.restPositions);
    this.accumulator = 0;
    this.writeGeometry(true);
  }

  step(frameDelta: number, reducedMotion = false): void {
    const clamped = Math.min(Math.max(frameDelta, 0), 1 / 15);
    this.accumulator = Math.min(this.accumulator + clamped, FIXED_DT * MAX_SUBSTEPS);
    let steps = 0;

    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this.substep(FIXED_DT, reducedMotion ? 3 : this.feel.iterations);
      this.accumulator -= FIXED_DT;
      steps += 1;
    }

    if (steps > 0) this.writeGeometry(false);
  }

  getStats(): { particles: number; edges: number; bends: number; grabbed: number } {
    let grabbed = 0;
    this.grabs.forEach((grab) => {
      grabbed += grab.indices.length;
    });
    return {
      particles: this.inverseMasses.length,
      edges: this.edges.a.length,
      bends: this.bends.a.length,
      grabbed,
    };
  }

  private weldVertices(position: THREE.BufferAttribute): {
    renderToSimulation: Uint32Array;
    simulationPositions: number[];
  } {
    const renderToSimulation = new Uint32Array(position.count);
    const simulationPositions: number[] = [];
    const lookup = new Map<string, number>();
    const epsilon = Math.max(this.radius * 1e-5, 1e-7);

    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const key = `${Math.round(x / epsilon)}:${Math.round(y / epsilon)}:${Math.round(z / epsilon)}`;
      let simulationIndex = lookup.get(key);
      if (simulationIndex === undefined) {
        simulationIndex = simulationPositions.length / 3;
        lookup.set(key, simulationIndex);
        simulationPositions.push(x, y, z);
      }
      renderToSimulation[i] = simulationIndex;
    }

    return { renderToSimulation, simulationPositions };
  }

  private buildTopology(): {
    triangles: Uint32Array;
    edges: DistanceConstraints;
    bends: DistanceConstraints;
  } {
    const index = this.geometry.getIndex();
    if (!index) throw new Error("模型缺少三角面索引");

    const triangles: number[] = [];
    const edgeRecords = new Map<string, EdgeRecord>();
    const bendPairs = new Set<string>();
    const bendA: number[] = [];
    const bendB: number[] = [];

    const registerEdge = (a: number, b: number, opposite: number) => {
      const key = pairKey(a, b);
      const existing = edgeRecords.get(key);
      if (!existing) {
        edgeRecords.set(key, { a: Math.min(a, b), b: Math.max(a, b), opposite });
        return;
      }
      if (existing.opposite === opposite) return;
      const bendKey = pairKey(existing.opposite, opposite);
      if (bendPairs.has(bendKey) || existing.opposite === opposite) return;
      bendPairs.add(bendKey);
      bendA.push(existing.opposite);
      bendB.push(opposite);
    };

    for (let i = 0; i + 2 < index.count; i += 3) {
      const a = this.renderToSimulation[index.getX(i)];
      const b = this.renderToSimulation[index.getX(i + 1)];
      const c = this.renderToSimulation[index.getX(i + 2)];
      if (a === b || b === c || c === a) continue;
      triangles.push(a, b, c);
      registerEdge(a, b, c);
      registerEdge(b, c, a);
      registerEdge(c, a, b);
    }

    const edgeA: number[] = [];
    const edgeB: number[] = [];
    edgeRecords.forEach((edge) => {
      edgeA.push(edge.a);
      edgeB.push(edge.b);
    });

    return {
      triangles: new Uint32Array(triangles),
      edges: this.makeDistanceConstraints(edgeA, edgeB),
      bends: this.makeDistanceConstraints(bendA, bendB),
    };
  }

  private makeDistanceConstraints(a: number[], b: number[]): DistanceConstraints {
    const constraint: DistanceConstraints = {
      a: new Uint32Array(a),
      b: new Uint32Array(b),
      rest: new Float32Array(a.length),
      lambdas: new Float32Array(a.length),
    };
    this.recomputeConstraintLengths(constraint);
    return constraint;
  }

  private recomputeConstraintLengths(constraint: DistanceConstraints): void {
    for (let i = 0; i < constraint.a.length; i += 1) {
      const a = constraint.a[i] * 3;
      const b = constraint.b[i] * 3;
      constraint.rest[i] = Math.hypot(
        this.restPositions[b] - this.restPositions[a],
        this.restPositions[b + 1] - this.restPositions[a + 1],
        this.restPositions[b + 2] - this.restPositions[a + 2],
      );
    }
  }

  private initializePins(): void {
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (let i = 2; i < this.restPositions.length; i += 3) {
      minZ = Math.min(minZ, this.restPositions[i]);
      maxZ = Math.max(maxZ, this.restPositions[i]);
    }
    const threshold = minZ + (maxZ - minZ) * 0.075;
    const candidates: Array<{ index: number; z: number }> = [];

    for (let i = 0; i < this.inverseMasses.length; i += 1) {
      const z = this.restPositions[i * 3 + 2];
      candidates.push({ index: i, z });
      if (z <= threshold) {
        this.inverseMasses[i] = 0;
        this.pinned[i] = 1;
      }
    }

    if (this.pinned.reduce((sum, value) => sum + value, 0) < 3) {
      candidates
        .sort((left, right) => left.z - right.z)
        .slice(0, 3)
        .forEach(({ index }) => {
          this.inverseMasses[index] = 0;
          this.pinned[index] = 1;
        });
    }
  }

  private substep(dt: number, iterations: number): void {
    const damping = this.feel.damping;
    for (let i = 0; i < this.inverseMasses.length; i += 1) {
      const offset = i * 3;
      if (this.inverseMasses[i] === 0) {
        this.predictedPositions[offset] = this.restPositions[offset];
        this.predictedPositions[offset + 1] = this.restPositions[offset + 1];
        this.predictedPositions[offset + 2] = this.restPositions[offset + 2];
        this.previousPositions[offset] = this.restPositions[offset];
        this.previousPositions[offset + 1] = this.restPositions[offset + 1];
        this.previousPositions[offset + 2] = this.restPositions[offset + 2];
        continue;
      }

      for (let axis = 0; axis < 3; axis += 1) {
        const current = this.positions[offset + axis];
        const velocity = (current - this.previousPositions[offset + axis]) * damping;
        this.previousPositions[offset + axis] = current;
        this.predictedPositions[offset + axis] = current + velocity;
      }
    }

    this.edges.lambdas.fill(0);
    this.bends.lambdas.fill(0);
    this.shapeLambdas.fill(0);
    this.volumeLambda = 0;
    this.grabs.forEach((grab) => grab.lambdas.fill(0));

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      this.applyPins();
      this.solveDistances(this.edges, this.feel.edgeCompliance, dt);
      this.solveDistances(this.bends, this.feel.bendCompliance, dt);
      this.solveVolume(dt);
      this.solveRestShape(dt);
      this.solveGrabs(dt);
    }

    this.applyPins();
    const maxDistance = this.radius * 3;
    for (let i = 0; i < this.inverseMasses.length; i += 1) {
      const offset = i * 3;
      const dx = this.predictedPositions[offset] - this.restPositions[offset];
      const dy = this.predictedPositions[offset + 1] - this.restPositions[offset + 1];
      const dz = this.predictedPositions[offset + 2] - this.restPositions[offset + 2];
      const distance = Math.hypot(dx, dy, dz);
      if (!Number.isFinite(distance)) {
        this.reset();
        return;
      }
      if (distance > maxDistance) {
        const scale = maxDistance / distance;
        this.predictedPositions[offset] = this.restPositions[offset] + dx * scale;
        this.predictedPositions[offset + 1] = this.restPositions[offset + 1] + dy * scale;
        this.predictedPositions[offset + 2] = this.restPositions[offset + 2] + dz * scale;
      }
    }
    this.positions.set(this.predictedPositions);
  }

  private applyPins(): void {
    for (let i = 0; i < this.pinned.length; i += 1) {
      if (this.pinned[i] === 0) continue;
      const offset = i * 3;
      this.predictedPositions[offset] = this.restPositions[offset];
      this.predictedPositions[offset + 1] = this.restPositions[offset + 1];
      this.predictedPositions[offset + 2] = this.restPositions[offset + 2];
    }
  }

  private solveDistances(constraint: DistanceConstraints, compliance: number, dt: number): void {
    const alpha = compliance / (dt * dt);
    for (let i = 0; i < constraint.a.length; i += 1) {
      const particleA = constraint.a[i];
      const particleB = constraint.b[i];
      const weightA = this.inverseMasses[particleA];
      const weightB = this.inverseMasses[particleB];
      const weight = weightA + weightB;
      if (weight === 0) continue;

      const a = particleA * 3;
      const b = particleB * 3;
      const dx = this.predictedPositions[b] - this.predictedPositions[a];
      const dy = this.predictedPositions[b + 1] - this.predictedPositions[a + 1];
      const dz = this.predictedPositions[b + 2] - this.predictedPositions[a + 2];
      const distance = Math.hypot(dx, dy, dz);
      if (distance < 1e-9) continue;

      const deltaLambda = (-(distance - constraint.rest[i]) - alpha * constraint.lambdas[i]) / (weight + alpha);
      constraint.lambdas[i] += deltaLambda;
      const scale = deltaLambda / distance;
      this.predictedPositions[a] -= weightA * scale * dx;
      this.predictedPositions[a + 1] -= weightA * scale * dy;
      this.predictedPositions[a + 2] -= weightA * scale * dz;
      this.predictedPositions[b] += weightB * scale * dx;
      this.predictedPositions[b + 1] += weightB * scale * dy;
      this.predictedPositions[b + 2] += weightB * scale * dz;
    }
  }

  private solveRestShape(dt: number): void {
    const alphaBase = this.feel.shapeCompliance / (dt * dt);
    for (let particle = 0; particle < this.inverseMasses.length; particle += 1) {
      const weight = this.inverseMasses[particle];
      if (weight === 0) continue;
      const offset = particle * 3;
      const dx = this.predictedPositions[offset] - this.restPositions[offset];
      const dy = this.predictedPositions[offset + 1] - this.restPositions[offset + 1];
      const dz = this.predictedPositions[offset + 2] - this.restPositions[offset + 2];
      const distance = Math.hypot(dx, dy, dz);
      if (distance < 1e-9) continue;

      const alpha = alphaBase * (0.35 + weight * 0.65);
      const deltaLambda = (-distance - alpha * this.shapeLambdas[particle]) / (weight + alpha);
      this.shapeLambdas[particle] += deltaLambda;
      const scale = (weight * deltaLambda) / distance;
      this.predictedPositions[offset] += scale * dx;
      this.predictedPositions[offset + 1] += scale * dy;
      this.predictedPositions[offset + 2] += scale * dz;
    }
  }

  private solveGrabs(dt: number): void {
    this.grabs.forEach((grab) => {
      const deltaX = grab.target.x - grab.origin.x;
      const deltaY = grab.target.y - grab.origin.y;
      const deltaZ = grab.target.z - grab.origin.z;

      for (let i = 0; i < grab.indices.length; i += 1) {
        const particle = grab.indices[i];
        const inverseMass = this.inverseMasses[particle];
        const influence = grab.weights[i];
        if (inverseMass === 0 || influence <= 1e-4) continue;

        const particleOffset = particle * 3;
        const grabOffset = i * 3;
        const desiredX = grab.starts[grabOffset] + deltaX * influence;
        const desiredY = grab.starts[grabOffset + 1] + deltaY * influence;
        const desiredZ = grab.starts[grabOffset + 2] + deltaZ * influence;
        const dx = this.predictedPositions[particleOffset] - desiredX;
        const dy = this.predictedPositions[particleOffset + 1] - desiredY;
        const dz = this.predictedPositions[particleOffset + 2] - desiredZ;
        const distance = Math.hypot(dx, dy, dz);
        if (distance < 1e-9) continue;

        const alpha = this.feel.grabCompliance / (influence * influence * dt * dt);
        const deltaLambda = (-distance - alpha * grab.lambdas[i]) / (inverseMass + alpha);
        grab.lambdas[i] += deltaLambda;
        const scale = (inverseMass * deltaLambda) / distance;
        this.predictedPositions[particleOffset] += scale * dx;
        this.predictedPositions[particleOffset + 1] += scale * dy;
        this.predictedPositions[particleOffset + 2] += scale * dz;
      }
    });
  }

  private solveVolume(dt: number): void {
    if (Math.abs(this.restVolume) < 1e-8) return;
    const gradients = this.volumeGradients;
    const positions = this.predictedPositions;
    gradients.fill(0);
    let volume = 0;

    for (let i = 0; i < this.triangles.length; i += 3) {
      const a = this.triangles[i] * 3;
      const b = this.triangles[i + 1] * 3;
      const c = this.triangles[i + 2] * 3;
      const ax = positions[a];
      const ay = positions[a + 1];
      const az = positions[a + 2];
      const bx = positions[b];
      const by = positions[b + 1];
      const bz = positions[b + 2];
      const cx = positions[c];
      const cy = positions[c + 1];
      const cz = positions[c + 2];

      volume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
      gradients[a] += (by * cz - bz * cy) / 6;
      gradients[a + 1] += (bz * cx - bx * cz) / 6;
      gradients[a + 2] += (bx * cy - by * cx) / 6;
      gradients[b] += (cy * az - cz * ay) / 6;
      gradients[b + 1] += (cz * ax - cx * az) / 6;
      gradients[b + 2] += (cx * ay - cy * ax) / 6;
      gradients[c] += (ay * bz - az * by) / 6;
      gradients[c + 1] += (az * bx - ax * bz) / 6;
      gradients[c + 2] += (ax * by - ay * bx) / 6;
    }
    volume /= 6;

    let denominator = 0;
    for (let particle = 0; particle < this.inverseMasses.length; particle += 1) {
      const offset = particle * 3;
      const weight = this.inverseMasses[particle];
      denominator += weight * (
        gradients[offset] * gradients[offset]
        + gradients[offset + 1] * gradients[offset + 1]
        + gradients[offset + 2] * gradients[offset + 2]
      );
    }

    const alpha = this.feel.volumeCompliance / (dt * dt);
    if (denominator + alpha < 1e-12) return;
    const deltaLambda = (-(volume - this.restVolume) - alpha * this.volumeLambda) / (denominator + alpha);
    this.volumeLambda += deltaLambda;

    for (let particle = 0; particle < this.inverseMasses.length; particle += 1) {
      const offset = particle * 3;
      const scale = this.inverseMasses[particle] * deltaLambda;
      this.predictedPositions[offset] += gradients[offset] * scale;
      this.predictedPositions[offset + 1] += gradients[offset + 1] * scale;
      this.predictedPositions[offset + 2] += gradients[offset + 2] * scale;
    }
  }

  private computeVolume(positions: Float32Array): number {
    let volume = 0;
    for (let i = 0; i < this.triangles.length; i += 3) {
      const a = this.triangles[i] * 3;
      const b = this.triangles[i + 1] * 3;
      const c = this.triangles[i + 2] * 3;
      volume += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]);
      volume += positions[a + 1] * (positions[b + 2] * positions[c] - positions[b] * positions[c + 2]);
      volume += positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
    }
    return volume / 6;
  }

  private writeGeometry(forceNormals: boolean): void {
    for (let renderVertex = 0; renderVertex < this.renderToSimulation.length; renderVertex += 1) {
      const simulationOffset = this.renderToSimulation[renderVertex] * 3;
      this.renderPosition.setXYZ(
        renderVertex,
        this.positions[simulationOffset],
        this.positions[simulationOffset + 1],
        this.positions[simulationOffset + 2],
      );
    }
    this.renderPosition.needsUpdate = true;

    this.normalFrame += 1;
    if (forceNormals || this.normalFrame % 2 === 0) {
      this.geometry.computeVertexNormals();
      const normal = this.geometry.getAttribute("normal");
      if (normal instanceof THREE.BufferAttribute) normal.needsUpdate = true;
    }
  }
}
