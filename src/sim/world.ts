import { Rng } from "./rng";
import { SpatialGrid } from "./spatialGrid";
import type { WorldSnapshot } from "./protocol";

// Phase 1: a single creature type that wanders, senses nearby food via the
// spatial grid, eats, metabolizes, dies, and reproduces asexually with a
// mutating "speed gene". This is the substrate the three experiments build
// on top of (genome comparison, sexual selection, trade) — deliberately
// minimal for now.

const PERCEPTION_RADIUS = 80;
const EAT_RADIUS = 6;
const BASE_SPEED = 60; // px/s at speedGene == 1
const TURN_JITTER = 0.6; // max radians/tick heading change while wandering
const METABOLISM_BASE = 4; // energy/s
const METABOLISM_SPEED_FACTOR = 3; // extra energy/s per unit of speedGene
const FOOD_ENERGY = 40;
const INITIAL_ENERGY = 50;
const REPRODUCE_THRESHOLD = 80;
const MUTATION_STD_DEV = 0.05;
const SPEED_GENE_MIN = 0.4;
const SPEED_GENE_MAX = 1.8;
const FOOD_SPAWN_RATE = 12; // food items/s while below capacity

export interface WorldOptions {
  seed: number;
  worldWidth: number;
  worldHeight: number;
  creatureCapacity?: number;
  foodCapacity?: number;
  initialCreatures?: number;
  initialFood?: number;
}

export class World {
  readonly worldWidth: number;
  readonly worldHeight: number;

  readonly creatureCapacity: number;
  creatureCount = 0;
  readonly creaturePosX: Float32Array;
  readonly creaturePosY: Float32Array;
  readonly creatureHeadingX: Float32Array;
  readonly creatureHeadingY: Float32Array;
  readonly creatureSpeedGene: Float32Array;
  readonly creatureEnergy: Float32Array;

  readonly foodCapacity: number;
  foodCount = 0;
  readonly foodPosX: Float32Array;
  readonly foodPosY: Float32Array;

  tick = 0;

  private readonly rng: Rng;
  private readonly foodGrid: SpatialGrid;

  constructor(options: WorldOptions) {
    this.worldWidth = options.worldWidth;
    this.worldHeight = options.worldHeight;
    this.creatureCapacity = options.creatureCapacity ?? 4000;
    this.foodCapacity = options.foodCapacity ?? 2000;

    this.creaturePosX = new Float32Array(this.creatureCapacity);
    this.creaturePosY = new Float32Array(this.creatureCapacity);
    this.creatureHeadingX = new Float32Array(this.creatureCapacity);
    this.creatureHeadingY = new Float32Array(this.creatureCapacity);
    this.creatureSpeedGene = new Float32Array(this.creatureCapacity);
    this.creatureEnergy = new Float32Array(this.creatureCapacity);

    this.foodPosX = new Float32Array(this.foodCapacity);
    this.foodPosY = new Float32Array(this.foodCapacity);

    this.rng = new Rng(options.seed);
    this.foodGrid = new SpatialGrid(this.worldWidth, this.worldHeight, PERCEPTION_RADIUS);

    const initialCreatures = options.initialCreatures ?? 200;
    for (let i = 0; i < initialCreatures; i++) this.spawnCreature();

    const initialFood = options.initialFood ?? 400;
    for (let i = 0; i < initialFood; i++) this.spawnFood();
  }

  step(dt: number): void {
    this.foodGrid.clear();
    for (let i = 0; i < this.foodCount; i++) {
      this.foodGrid.insert(i, this.foodPosX[i], this.foodPosY[i]);
    }

    for (let i = this.creatureCount - 1; i >= 0; i--) {
      const cx = this.creaturePosX[i];
      const cy = this.creaturePosY[i];

      let nearestFood = -1;
      let nearestDistSq = PERCEPTION_RADIUS * PERCEPTION_RADIUS;
      this.foodGrid.forEachNear(cx, cy, PERCEPTION_RADIUS, (foodIndex) => {
        const dx = this.foodPosX[foodIndex] - cx;
        const dy = this.foodPosY[foodIndex] - cy;
        const distSq = dx * dx + dy * dy;
        if (distSq < nearestDistSq) {
          nearestDistSq = distSq;
          nearestFood = foodIndex;
        }
      });

      if (nearestFood >= 0) {
        const dist = Math.sqrt(nearestDistSq) || 1;
        this.creatureHeadingX[i] = (this.foodPosX[nearestFood] - cx) / dist;
        this.creatureHeadingY[i] = (this.foodPosY[nearestFood] - cy) / dist;
      } else {
        const currentAngle = Math.atan2(this.creatureHeadingY[i], this.creatureHeadingX[i]);
        const newAngle = currentAngle + this.rng.range(-TURN_JITTER, TURN_JITTER) * dt;
        this.creatureHeadingX[i] = Math.cos(newAngle);
        this.creatureHeadingY[i] = Math.sin(newAngle);
      }

      const speed = BASE_SPEED * this.creatureSpeedGene[i];
      let nx = cx + this.creatureHeadingX[i] * speed * dt;
      let ny = cy + this.creatureHeadingY[i] * speed * dt;
      if (nx < 0) nx += this.worldWidth;
      else if (nx >= this.worldWidth) nx -= this.worldWidth;
      if (ny < 0) ny += this.worldHeight;
      else if (ny >= this.worldHeight) ny -= this.worldHeight;
      this.creaturePosX[i] = nx;
      this.creaturePosY[i] = ny;

      this.creatureEnergy[i] -= (METABOLISM_BASE + METABOLISM_SPEED_FACTOR * this.creatureSpeedGene[i]) * dt;

      if (nearestFood >= 0 && nearestFood < this.foodCount) {
        const dx = this.foodPosX[nearestFood] - nx;
        const dy = this.foodPosY[nearestFood] - ny;
        if (dx * dx + dy * dy <= EAT_RADIUS * EAT_RADIUS) {
          this.creatureEnergy[i] += FOOD_ENERGY;
          this.removeFood(nearestFood);
        }
      }

      if (this.creatureEnergy[i] <= 0) {
        this.removeCreature(i);
        continue;
      }

      if (this.creatureEnergy[i] >= REPRODUCE_THRESHOLD && this.creatureCount < this.creatureCapacity) {
        this.reproduce(i);
      }
    }

    this.spawnFoodOverTime(dt);
    this.tick++;
  }

  private spawnCreature(): void {
    const i = this.creatureCount++;
    this.creaturePosX[i] = this.rng.next() * this.worldWidth;
    this.creaturePosY[i] = this.rng.next() * this.worldHeight;
    const angle = this.rng.range(0, Math.PI * 2);
    this.creatureHeadingX[i] = Math.cos(angle);
    this.creatureHeadingY[i] = Math.sin(angle);
    this.creatureSpeedGene[i] = this.rng.range(0.8, 1.2);
    this.creatureEnergy[i] = INITIAL_ENERGY;
  }

  private spawnFood(): void {
    const i = this.foodCount++;
    this.foodPosX[i] = this.rng.next() * this.worldWidth;
    this.foodPosY[i] = this.rng.next() * this.worldHeight;
  }

  private spawnFoodOverTime(dt: number): void {
    if (this.foodCount >= this.foodCapacity) return;
    const expected = FOOD_SPAWN_RATE * dt;
    let spawns = Math.floor(expected);
    if (this.rng.next() < expected - spawns) spawns++;
    for (let s = 0; s < spawns && this.foodCount < this.foodCapacity; s++) this.spawnFood();
  }

  private removeFood(index: number): void {
    const last = this.foodCount - 1;
    this.foodPosX[index] = this.foodPosX[last];
    this.foodPosY[index] = this.foodPosY[last];
    this.foodCount--;
  }

  private removeCreature(index: number): void {
    const last = this.creatureCount - 1;
    this.creaturePosX[index] = this.creaturePosX[last];
    this.creaturePosY[index] = this.creaturePosY[last];
    this.creatureHeadingX[index] = this.creatureHeadingX[last];
    this.creatureHeadingY[index] = this.creatureHeadingY[last];
    this.creatureSpeedGene[index] = this.creatureSpeedGene[last];
    this.creatureEnergy[index] = this.creatureEnergy[last];
    this.creatureCount--;
  }

  private reproduce(parentIndex: number): void {
    const childIndex = this.creatureCount++;
    const childEnergy = this.creatureEnergy[parentIndex] / 2;
    this.creatureEnergy[parentIndex] = childEnergy;

    this.creaturePosX[childIndex] = this.creaturePosX[parentIndex];
    this.creaturePosY[childIndex] = this.creaturePosY[parentIndex];
    const angle = this.rng.range(0, Math.PI * 2);
    this.creatureHeadingX[childIndex] = Math.cos(angle);
    this.creatureHeadingY[childIndex] = Math.sin(angle);
    this.creatureEnergy[childIndex] = childEnergy;

    const mutated = this.creatureSpeedGene[parentIndex] + this.rng.gaussian(0, MUTATION_STD_DEV);
    this.creatureSpeedGene[childIndex] = Math.min(SPEED_GENE_MAX, Math.max(SPEED_GENE_MIN, mutated));
  }

  meanSpeedGene(): number {
    if (this.creatureCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.creatureCount; i++) sum += this.creatureSpeedGene[i];
    return sum / this.creatureCount;
  }

  toSnapshot(): WorldSnapshot {
    return {
      version: 1,
      tick: this.tick,
      worldWidth: this.worldWidth,
      worldHeight: this.worldHeight,
      rngState: this.rng.getState(),
      creatureCount: this.creatureCount,
      creaturePosX: Array.from(this.creaturePosX.subarray(0, this.creatureCount)),
      creaturePosY: Array.from(this.creaturePosY.subarray(0, this.creatureCount)),
      creatureHeadingX: Array.from(this.creatureHeadingX.subarray(0, this.creatureCount)),
      creatureHeadingY: Array.from(this.creatureHeadingY.subarray(0, this.creatureCount)),
      creatureSpeedGene: Array.from(this.creatureSpeedGene.subarray(0, this.creatureCount)),
      creatureEnergy: Array.from(this.creatureEnergy.subarray(0, this.creatureCount)),
      foodCount: this.foodCount,
      foodPosX: Array.from(this.foodPosX.subarray(0, this.foodCount)),
      foodPosY: Array.from(this.foodPosY.subarray(0, this.foodCount)),
    };
  }

  loadSnapshot(snapshot: WorldSnapshot): void {
    if (snapshot.creatureCount > this.creatureCapacity) {
      throw new Error(
        `Snapshot has ${snapshot.creatureCount} creatures, capacity is ${this.creatureCapacity}`,
      );
    }
    if (snapshot.foodCount > this.foodCapacity) {
      throw new Error(`Snapshot has ${snapshot.foodCount} food items, capacity is ${this.foodCapacity}`);
    }

    this.tick = snapshot.tick;
    this.rng.setState(snapshot.rngState);

    this.creatureCount = snapshot.creatureCount;
    this.creaturePosX.set(snapshot.creaturePosX);
    this.creaturePosY.set(snapshot.creaturePosY);
    this.creatureHeadingX.set(snapshot.creatureHeadingX);
    this.creatureHeadingY.set(snapshot.creatureHeadingY);
    this.creatureSpeedGene.set(snapshot.creatureSpeedGene);
    this.creatureEnergy.set(snapshot.creatureEnergy);

    this.foodCount = snapshot.foodCount;
    this.foodPosX.set(snapshot.foodPosX);
    this.foodPosY.set(snapshot.foodPosY);
  }
}
