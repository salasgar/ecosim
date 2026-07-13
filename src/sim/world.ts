import { Rng } from "./rng";
import { SpatialGrid } from "./spatialGrid";
import type { WorldSnapshot } from "./protocol";

// Phase 1: a single creature type that wanders, senses nearby food via the
// spatial grid, eats, metabolizes, dies, and reproduces asexually with a
// mutating "speed gene".
//
// Phase 3 (Experiment 1 — kinship & cannibalism): each creature also carries
// a small vector of neutral "marker genes". Kinship isn't tracked via
// pedigree (that would explode in memory over many generations); instead,
// relatedness is approximated by genome similarity at these markers —
// phenotype matching / "greenbeard" recognition. Each creature also has an
// evolvable `kinTolerance`: how genetically different another creature must
// be before it's treated as fair prey rather than kin. Hungry creatures
// attack and eat non-kin within range. Since markers are inherited like any
// other gene, similarity at these loci correlates with true relatedness at
// every other locus too — including the kinTolerance gene itself — so kin
// selection (Hamilton's rule, rB > C) has something to act on.

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
// Regrowth is modeled per empty slot (logistic-ish): the emptier the food
// supply, the faster it regrows in absolute terms, which self-stabilizes
// population instead of the flat-rate model collapsing under a boom.
const FOOD_REGROWTH_PROBABILITY = 0.05; // fraction of empty capacity regrown/s

const MARKER_GENE_COUNT = 6;
const MAX_GENOME_DISTANCE = Math.sqrt(MARKER_GENE_COUNT);
const GENOME_MUTATION_STD_DEV = 0.05;
const KIN_TOLERANCE_MUTATION_STD_DEV = 0.1;
const ATTACK_RADIUS = 8;
const PREDATION_HUNGER_THRESHOLD = 35; // attempt predation when energy drops below this
const PREDATION_EFFICIENCY = 0.55; // fraction of victim's energy gained (imperfect digestion)

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
  readonly creatureGenomeMarkers: Float32Array; // flattened, MARKER_GENE_COUNT per creature
  readonly creatureKinTolerance: Float32Array;

  readonly foodCapacity: number;
  foodCount = 0;
  readonly foodPosX: Float32Array;
  readonly foodPosY: Float32Array;

  tick = 0;
  totalPredations = 0;

  private readonly rng: Rng;
  private readonly foodGrid: SpatialGrid;
  private readonly creatureGrid: SpatialGrid;

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
    this.creatureGenomeMarkers = new Float32Array(this.creatureCapacity * MARKER_GENE_COUNT);
    this.creatureKinTolerance = new Float32Array(this.creatureCapacity);

    this.foodPosX = new Float32Array(this.foodCapacity);
    this.foodPosY = new Float32Array(this.foodCapacity);

    this.rng = new Rng(options.seed);
    this.foodGrid = new SpatialGrid(this.worldWidth, this.worldHeight, PERCEPTION_RADIUS);
    this.creatureGrid = new SpatialGrid(this.worldWidth, this.worldHeight, ATTACK_RADIUS);

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

    this.resolvePredation();
    this.spawnFoodOverTime(dt);
    this.tick++;
  }

  // Hungry creatures attack and eat the nearest non-kin creature in range.
  // Runs as a pass separate from the main loop for clarity; it only sees
  // survivors of that loop, and any creature it kills is deferred (via the
  // usual swap-pop) to be re-evaluated next tick if a replacement lands in
  // its slot.
  private resolvePredation(): void {
    this.creatureGrid.clear();
    for (let i = 0; i < this.creatureCount; i++) {
      this.creatureGrid.insert(i, this.creaturePosX[i], this.creaturePosY[i]);
    }

    for (let i = this.creatureCount - 1; i >= 0; i--) {
      if (this.creatureEnergy[i] >= PREDATION_HUNGER_THRESHOLD) continue;

      const cx = this.creaturePosX[i];
      const cy = this.creaturePosY[i];
      const kinTolerance = this.creatureKinTolerance[i];

      let victim = -1;
      let victimDistSq = ATTACK_RADIUS * ATTACK_RADIUS;
      this.creatureGrid.forEachNear(cx, cy, ATTACK_RADIUS, (other) => {
        if (other === i || other >= this.creatureCount) return;
        const dx = this.creaturePosX[other] - cx;
        const dy = this.creaturePosY[other] - cy;
        const distSq = dx * dx + dy * dy;
        if (distSq <= victimDistSq && this.genomeDistance(i, other) > kinTolerance) {
          victimDistSq = distSq;
          victim = other;
        }
      });

      if (victim >= 0 && victim < this.creatureCount) {
        this.creatureEnergy[i] += PREDATION_EFFICIENCY * this.creatureEnergy[victim];
        this.removeCreature(victim);
        this.totalPredations++;
      }
    }
  }

  private genomeDistance(a: number, b: number): number {
    let sumSq = 0;
    const baseA = a * MARKER_GENE_COUNT;
    const baseB = b * MARKER_GENE_COUNT;
    for (let g = 0; g < MARKER_GENE_COUNT; g++) {
      const diff = this.creatureGenomeMarkers[baseA + g] - this.creatureGenomeMarkers[baseB + g];
      sumSq += diff * diff;
    }
    return Math.sqrt(sumSq);
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
    const base = i * MARKER_GENE_COUNT;
    for (let g = 0; g < MARKER_GENE_COUNT; g++) this.creatureGenomeMarkers[base + g] = this.rng.next();
    this.creatureKinTolerance[i] = this.rng.range(0, MAX_GENOME_DISTANCE);
  }

  private spawnFood(): void {
    const i = this.foodCount++;
    this.foodPosX[i] = this.rng.next() * this.worldWidth;
    this.foodPosY[i] = this.rng.next() * this.worldHeight;
  }

  private spawnFoodOverTime(dt: number): void {
    const emptySlots = this.foodCapacity - this.foodCount;
    if (emptySlots <= 0) return;
    const expected = FOOD_REGROWTH_PROBABILITY * emptySlots * dt;
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
    this.creatureKinTolerance[index] = this.creatureKinTolerance[last];
    const indexBase = index * MARKER_GENE_COUNT;
    const lastBase = last * MARKER_GENE_COUNT;
    for (let g = 0; g < MARKER_GENE_COUNT; g++) {
      this.creatureGenomeMarkers[indexBase + g] = this.creatureGenomeMarkers[lastBase + g];
    }
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

    const mutatedSpeed = this.creatureSpeedGene[parentIndex] + this.rng.gaussian(0, MUTATION_STD_DEV);
    this.creatureSpeedGene[childIndex] = Math.min(SPEED_GENE_MAX, Math.max(SPEED_GENE_MIN, mutatedSpeed));

    const parentBase = parentIndex * MARKER_GENE_COUNT;
    const childBase = childIndex * MARKER_GENE_COUNT;
    for (let g = 0; g < MARKER_GENE_COUNT; g++) {
      const mutated = this.creatureGenomeMarkers[parentBase + g] + this.rng.gaussian(0, GENOME_MUTATION_STD_DEV);
      this.creatureGenomeMarkers[childBase + g] = Math.min(1, Math.max(0, mutated));
    }

    const mutatedTolerance =
      this.creatureKinTolerance[parentIndex] + this.rng.gaussian(0, KIN_TOLERANCE_MUTATION_STD_DEV);
    this.creatureKinTolerance[childIndex] = Math.min(MAX_GENOME_DISTANCE, Math.max(0, mutatedTolerance));
  }

  meanSpeedGene(): number {
    if (this.creatureCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.creatureCount; i++) sum += this.creatureSpeedGene[i];
    return sum / this.creatureCount;
  }

  meanKinTolerance(): number {
    if (this.creatureCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.creatureCount; i++) sum += this.creatureKinTolerance[i];
    return sum / this.creatureCount;
  }

  toSnapshot(): WorldSnapshot {
    return {
      version: 2,
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
      creatureGenomeMarkers: Array.from(
        this.creatureGenomeMarkers.subarray(0, this.creatureCount * MARKER_GENE_COUNT),
      ),
      creatureKinTolerance: Array.from(this.creatureKinTolerance.subarray(0, this.creatureCount)),
      totalPredations: this.totalPredations,
      foodCount: this.foodCount,
      foodPosX: Array.from(this.foodPosX.subarray(0, this.foodCount)),
      foodPosY: Array.from(this.foodPosY.subarray(0, this.foodCount)),
    };
  }

  loadSnapshot(snapshot: WorldSnapshot): void {
    if (snapshot.version !== 2) {
      throw new Error(`Versión de guardado incompatible: se esperaba 2, el archivo tiene ${snapshot.version}`);
    }
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
    this.creatureGenomeMarkers.set(snapshot.creatureGenomeMarkers);
    this.creatureKinTolerance.set(snapshot.creatureKinTolerance);
    this.totalPredations = snapshot.totalPredations;

    this.foodCount = snapshot.foodCount;
    this.foodPosX.set(snapshot.foodPosX);
    this.foodPosY.set(snapshot.foodPosY);
  }
}
