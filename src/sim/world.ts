import { Rng } from "./rng";
import { SpatialGrid } from "./spatialGrid";
import type { WorldSnapshot } from "./protocol";

// Phase 1: a single creature type that wanders, senses nearby food via the
// spatial grid, eats, metabolizes, dies. Movement/food/metabolism are the
// substrate every experiment builds on.
//
// Phase 3 (Experiment 1 — kinship & cannibalism): each creature carries a
// small vector of neutral "marker genes". Kinship isn't tracked via
// pedigree (that would explode in memory over many generations); instead,
// relatedness is approximated by genome similarity at these markers —
// phenotype matching / "greenbeard" recognition. Each creature also has an
// evolvable `kinTolerance`: how genetically different another creature must
// be before it's treated as fair prey rather than kin.
//
// Phase 4 (Experiment 2 — mate choice & sexual selection): reproduction is
// biparental. Every creature has two functional traits — `speedGene`
// (agility) and `reserveGene` (metabolic efficiency, i.e. fat reserves) —
// plus a preference genome (`prefSpeed`, `prefReserve`, `mateTolerance`)
// describing what it looks for in a mate. Two ready creatures reproduce only
// if each finds the other's traits within its own tolerance of its own
// preference — mutual mate choice. Children recombine each gene
// independently from either parent (Mendelian-style assortment) plus
// mutation. A slow climate cycle alternates food scarcity and abundance to
// test whether mate preference tracks which trait actually pays off.
//
// Phase 6 (Experiment 3 — trade & cooperation): besides the generic energy
// food, creatures need two nutrients, A and B. Extraction ability is
// constrained to a Pareto frontier (habA^2 + habB^2 == 1, via a single
// `habAngle` gene) so no one can be great at gathering both — specialists
// emerge under selection. A creature with a surplus of one nutrient and a
// deficit of the other can trade chunks with a nearby creature with the
// complementary profile; both sides only ever gain (v1 assumes honest,
// atomic exchange — no defection is modeled yet). Trade partner choice is
// biased toward genetic kin via an evolvable `kinTradeBias`, reusing
// Experiment 1's genome-similarity machinery: kin cooperation is the
// easiest form of cooperation to evolve, so it's the natural bootstrap.

const PERCEPTION_RADIUS = 80;
const EAT_RADIUS = 6;
const BASE_SPEED = 60; // px/s at speedGene == 1
const TURN_JITTER = 0.6; // max radians/tick heading change while wandering
const METABOLISM_BASE = 4; // energy/s
const METABOLISM_SPEED_FACTOR = 3; // extra energy/s per unit of speedGene
const RESERVE_METABOLISM_DISCOUNT = 0.35; // up to 35% less metabolic drain at reserveGene == 1
const FOOD_ENERGY = 40;
const INITIAL_ENERGY = 50;
const ENERGY_CAP = 200; // bounds unmated individuals from accumulating energy forever
const REPRODUCE_THRESHOLD = 80;
const MUTATION_STD_DEV = 0.05;
const SPEED_GENE_MIN = 0.4;
const SPEED_GENE_MAX = 1.8;

// Regrowth is modeled per empty slot (logistic-ish): the emptier the food
// supply, the faster it regrows in absolute terms, which self-stabilizes
// population instead of a flat rate collapsing under a boom.
const FOOD_REGROWTH_PROBABILITY = 0.05; // fraction of empty capacity regrown/s
const CLIMATE_PERIOD_TICKS = 6000; // full scarcity+abundance cycle length
const CLIMATE_SCARCITY_MULTIPLIER = 0.3;
const CLIMATE_ABUNDANCE_MULTIPLIER = 1.8;

const MARKER_GENE_COUNT = 6;
const MAX_GENOME_DISTANCE = Math.sqrt(MARKER_GENE_COUNT);
const GENOME_MUTATION_STD_DEV = 0.05;
const KIN_TOLERANCE_MUTATION_STD_DEV = 0.1;
const ATTACK_RADIUS = 8;
const PREDATION_HUNGER_THRESHOLD = 35; // attempt predation when energy drops below this
const PREDATION_EFFICIENCY = 0.55; // fraction of victim's energy gained (imperfect digestion)

const RESERVE_GENE_MIN = 0;
const RESERVE_GENE_MAX = 1;
const MATE_TOLERANCE_MIN = 0;
const MATE_TOLERANCE_MAX = 1.8; // covers the full possible speed+reserve preference distance
const MATE_TOLERANCE_MUTATION_STD_DEV = 0.1;
const MATE_SEEK_RADIUS = 40;
const SEXUAL_REPRODUCE_COST_PER_PARENT = 30;
const CHILD_INITIAL_ENERGY = SEXUAL_REPRODUCE_COST_PER_PARENT * 2;

const HAB_ANGLE_MUTATION_STD_DEV = 0.15; // radians
const NUTRIENT_GAIN_MAX = 30; // nutrient gained per patch at hab == 1
const NUTRIENT_RESERVE_CAP = 150;
const NUTRIENT_TARGET_RESERVE = 50; // surplus/deficit are measured against this
const NUTRIENT_MIN_FOR_REPRODUCTION = 20;
const NUTRIENT_REPRODUCE_COST = 15; // each parent pays this from both reserveA and reserveB
const NUTRIENT_CHILD_INITIAL_RESERVE = 20;
const NUTRIENT_INITIAL_RESERVE = 25; // starting individuals have no parents to inherit from
const TRADE_RADIUS = 30;
const TRADE_CHUNK = 10;
const KIN_TRADE_BIAS_MUTATION_STD_DEV = 0.1;

export interface WorldOptions {
  seed: number;
  worldWidth: number;
  worldHeight: number;
  creatureCapacity?: number;
  foodCapacity?: number;
  initialCreatures?: number;
  initialFood?: number;
  nutrientCapacity?: number;
  initialNutrient?: number;
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
  readonly creatureReserveGene: Float32Array;
  readonly creaturePrefSpeed: Float32Array;
  readonly creaturePrefReserve: Float32Array;
  readonly creatureMateTolerance: Float32Array;
  readonly creatureHabAngle: Float32Array; // habA = cos(angle), habB = sin(angle)
  readonly creatureReserveA: Float32Array;
  readonly creatureReserveB: Float32Array;
  readonly creatureKinTradeBias: Float32Array;

  readonly foodCapacity: number;
  foodCount = 0;
  readonly foodPosX: Float32Array;
  readonly foodPosY: Float32Array;

  readonly nutrientCapacity: number;
  foodACount = 0;
  readonly foodAPosX: Float32Array;
  readonly foodAPosY: Float32Array;
  foodBCount = 0;
  readonly foodBPosX: Float32Array;
  readonly foodBPosY: Float32Array;

  tick = 0;
  totalPredations = 0;
  totalMatings = 0;
  totalTrades = 0;

  private readonly rng: Rng;
  private readonly foodGrid: SpatialGrid;
  private readonly foodAGrid: SpatialGrid;
  private readonly foodBGrid: SpatialGrid;
  private readonly creatureGrid: SpatialGrid;
  private readonly matingGrid: SpatialGrid;
  private readonly tradeGrid: SpatialGrid;
  private hasMatedThisTick: Uint8Array;
  private hasTradedThisTick: Uint8Array;

  constructor(options: WorldOptions) {
    this.worldWidth = options.worldWidth;
    this.worldHeight = options.worldHeight;
    this.creatureCapacity = options.creatureCapacity ?? 4000;
    this.foodCapacity = options.foodCapacity ?? 2000;
    this.nutrientCapacity = options.nutrientCapacity ?? 1500;

    this.creaturePosX = new Float32Array(this.creatureCapacity);
    this.creaturePosY = new Float32Array(this.creatureCapacity);
    this.creatureHeadingX = new Float32Array(this.creatureCapacity);
    this.creatureHeadingY = new Float32Array(this.creatureCapacity);
    this.creatureSpeedGene = new Float32Array(this.creatureCapacity);
    this.creatureEnergy = new Float32Array(this.creatureCapacity);
    this.creatureGenomeMarkers = new Float32Array(this.creatureCapacity * MARKER_GENE_COUNT);
    this.creatureKinTolerance = new Float32Array(this.creatureCapacity);
    this.creatureReserveGene = new Float32Array(this.creatureCapacity);
    this.creaturePrefSpeed = new Float32Array(this.creatureCapacity);
    this.creaturePrefReserve = new Float32Array(this.creatureCapacity);
    this.creatureMateTolerance = new Float32Array(this.creatureCapacity);
    this.creatureHabAngle = new Float32Array(this.creatureCapacity);
    this.creatureReserveA = new Float32Array(this.creatureCapacity);
    this.creatureReserveB = new Float32Array(this.creatureCapacity);
    this.creatureKinTradeBias = new Float32Array(this.creatureCapacity);
    this.hasMatedThisTick = new Uint8Array(this.creatureCapacity);
    this.hasTradedThisTick = new Uint8Array(this.creatureCapacity);

    this.foodPosX = new Float32Array(this.foodCapacity);
    this.foodPosY = new Float32Array(this.foodCapacity);
    this.foodAPosX = new Float32Array(this.nutrientCapacity);
    this.foodAPosY = new Float32Array(this.nutrientCapacity);
    this.foodBPosX = new Float32Array(this.nutrientCapacity);
    this.foodBPosY = new Float32Array(this.nutrientCapacity);

    this.rng = new Rng(options.seed);
    this.foodGrid = new SpatialGrid(this.worldWidth, this.worldHeight, PERCEPTION_RADIUS);
    this.foodAGrid = new SpatialGrid(this.worldWidth, this.worldHeight, PERCEPTION_RADIUS);
    this.foodBGrid = new SpatialGrid(this.worldWidth, this.worldHeight, PERCEPTION_RADIUS);
    this.creatureGrid = new SpatialGrid(this.worldWidth, this.worldHeight, ATTACK_RADIUS);
    this.matingGrid = new SpatialGrid(this.worldWidth, this.worldHeight, MATE_SEEK_RADIUS);
    this.tradeGrid = new SpatialGrid(this.worldWidth, this.worldHeight, TRADE_RADIUS);

    const initialCreatures = options.initialCreatures ?? 200;
    for (let i = 0; i < initialCreatures; i++) this.spawnCreature();

    const initialFood = options.initialFood ?? 400;
    for (let i = 0; i < initialFood; i++) this.spawnFood();

    const initialNutrient = options.initialNutrient ?? 300;
    for (let i = 0; i < initialNutrient; i++) this.spawnFoodA();
    for (let i = 0; i < initialNutrient; i++) this.spawnFoodB();
  }

  step(dt: number): void {
    this.foodGrid.clear();
    for (let i = 0; i < this.foodCount; i++) {
      this.foodGrid.insert(i, this.foodPosX[i], this.foodPosY[i]);
    }
    this.foodAGrid.clear();
    for (let i = 0; i < this.foodACount; i++) {
      this.foodAGrid.insert(i, this.foodAPosX[i], this.foodAPosY[i]);
    }
    this.foodBGrid.clear();
    for (let i = 0; i < this.foodBCount; i++) {
      this.foodBGrid.insert(i, this.foodBPosX[i], this.foodBPosY[i]);
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

      // Nutrient-seeking only kicks in when nothing pulls the creature
      // toward energy food this tick — it fills in the former pure-wander
      // branch with purposeful movement toward whichever nutrient (A or B)
      // it's currently more deficient in.
      let nutrientTarget = -1;
      let nutrientIsA = true;

      if (nearestFood >= 0) {
        const dist = Math.sqrt(nearestDistSq) || 1;
        this.creatureHeadingX[i] = (this.foodPosX[nearestFood] - cx) / dist;
        this.creatureHeadingY[i] = (this.foodPosY[nearestFood] - cy) / dist;
      } else {
        const deficitA = NUTRIENT_TARGET_RESERVE - this.creatureReserveA[i];
        const deficitB = NUTRIENT_TARGET_RESERVE - this.creatureReserveB[i];
        nutrientIsA = deficitA >= deficitB;
        const moreDeficit = nutrientIsA ? deficitA : deficitB;
        const grid = nutrientIsA ? this.foodAGrid : this.foodBGrid;
        const patchX = nutrientIsA ? this.foodAPosX : this.foodBPosX;
        const patchY = nutrientIsA ? this.foodAPosY : this.foodBPosY;

        let nutrientDistSq = PERCEPTION_RADIUS * PERCEPTION_RADIUS;
        if (moreDeficit > 0) {
          grid.forEachNear(cx, cy, PERCEPTION_RADIUS, (patchIndex) => {
            const dx = patchX[patchIndex] - cx;
            const dy = patchY[patchIndex] - cy;
            const distSq = dx * dx + dy * dy;
            if (distSq < nutrientDistSq) {
              nutrientDistSq = distSq;
              nutrientTarget = patchIndex;
            }
          });
        }

        if (nutrientTarget >= 0) {
          const dist = Math.sqrt(nutrientDistSq) || 1;
          this.creatureHeadingX[i] = (patchX[nutrientTarget] - cx) / dist;
          this.creatureHeadingY[i] = (patchY[nutrientTarget] - cy) / dist;
        } else {
          const currentAngle = Math.atan2(this.creatureHeadingY[i], this.creatureHeadingX[i]);
          const newAngle = currentAngle + this.rng.range(-TURN_JITTER, TURN_JITTER) * dt;
          this.creatureHeadingX[i] = Math.cos(newAngle);
          this.creatureHeadingY[i] = Math.sin(newAngle);
        }
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

      const metabolism =
        (METABOLISM_BASE + METABOLISM_SPEED_FACTOR * this.creatureSpeedGene[i]) *
        (1 - RESERVE_METABOLISM_DISCOUNT * this.creatureReserveGene[i]);
      this.creatureEnergy[i] -= metabolism * dt;

      if (nearestFood >= 0 && nearestFood < this.foodCount) {
        const dx = this.foodPosX[nearestFood] - nx;
        const dy = this.foodPosY[nearestFood] - ny;
        if (dx * dx + dy * dy <= EAT_RADIUS * EAT_RADIUS) {
          this.creatureEnergy[i] = Math.min(ENERGY_CAP, this.creatureEnergy[i] + FOOD_ENERGY);
          this.removeFood(nearestFood);
        }
      } else if (nutrientTarget >= 0) {
        const patchX = nutrientIsA ? this.foodAPosX : this.foodBPosX;
        const patchY = nutrientIsA ? this.foodAPosY : this.foodBPosY;
        const patchCount = nutrientIsA ? this.foodACount : this.foodBCount;
        if (nutrientTarget < patchCount) {
          const dx = patchX[nutrientTarget] - nx;
          const dy = patchY[nutrientTarget] - ny;
          if (dx * dx + dy * dy <= EAT_RADIUS * EAT_RADIUS) {
            const angle = this.creatureHabAngle[i];
            if (nutrientIsA) {
              const hab = Math.cos(angle);
              this.creatureReserveA[i] = Math.min(NUTRIENT_RESERVE_CAP, this.creatureReserveA[i] + hab * NUTRIENT_GAIN_MAX);
              this.removeFoodA(nutrientTarget);
            } else {
              const hab = Math.sin(angle);
              this.creatureReserveB[i] = Math.min(NUTRIENT_RESERVE_CAP, this.creatureReserveB[i] + hab * NUTRIENT_GAIN_MAX);
              this.removeFoodB(nutrientTarget);
            }
          }
        }
      }

      if (this.creatureEnergy[i] <= 0) {
        this.removeCreature(i);
        continue;
      }
    }

    this.resolvePredation();
    this.resolveTrading();
    this.resolveMating();
    this.spawnFoodOverTime(dt);
    this.spawnFoodAOverTime(dt);
    this.spawnFoodBOverTime(dt);
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
        this.creatureEnergy[i] = Math.min(
          ENERGY_CAP,
          this.creatureEnergy[i] + PREDATION_EFFICIENCY * this.creatureEnergy[victim],
        );
        this.removeCreature(victim);
        this.totalPredations++;
      }
    }
  }

  // A creature with a surplus of one nutrient and a deficit of the other
  // looks for a nearby creature with the complementary profile and swaps
  // chunks — both only ever gain (v1: honest, atomic exchange, no
  // defection). Among qualifying partners, preference is biased toward
  // genetic kin via `kinTradeBias`, since kin cooperation is the easiest
  // to evolve and gives the mechanism somewhere to bootstrap from.
  private resolveTrading(): void {
    const snapshot = this.creatureCount;
    this.hasTradedThisTick.fill(0, 0, snapshot);

    this.tradeGrid.clear();
    for (let i = 0; i < snapshot; i++) {
      const surplusA = this.creatureReserveA[i] - NUTRIENT_TARGET_RESERVE;
      const surplusB = this.creatureReserveB[i] - NUTRIENT_TARGET_RESERVE;
      if (surplusA > 0 || surplusB > 0) {
        this.tradeGrid.insert(i, this.creaturePosX[i], this.creaturePosY[i]);
      }
    }

    for (let i = 0; i < snapshot; i++) {
      if (this.hasTradedThisTick[i]) continue;

      const mySurplusA = Math.max(0, this.creatureReserveA[i] - NUTRIENT_TARGET_RESERVE);
      const mySurplusB = Math.max(0, this.creatureReserveB[i] - NUTRIENT_TARGET_RESERVE);
      const myDeficitA = Math.max(0, NUTRIENT_TARGET_RESERVE - this.creatureReserveA[i]);
      const myDeficitB = Math.max(0, NUTRIENT_TARGET_RESERVE - this.creatureReserveB[i]);
      const iOffersA = mySurplusA > 0 && myDeficitB > 0;
      const iOffersB = mySurplusB > 0 && myDeficitA > 0;
      if (!iOffersA && !iOffersB) continue;

      const cx = this.creaturePosX[i];
      const cy = this.creaturePosY[i];
      const kinBias = this.creatureKinTradeBias[i];

      let bestPartner = -1;
      let bestScore = Infinity;
      this.tradeGrid.forEachNear(cx, cy, TRADE_RADIUS, (other) => {
        if (other === i || other >= snapshot || this.hasTradedThisTick[other]) return;
        const otherSurplusA = Math.max(0, this.creatureReserveA[other] - NUTRIENT_TARGET_RESERVE);
        const otherSurplusB = Math.max(0, this.creatureReserveB[other] - NUTRIENT_TARGET_RESERVE);
        const otherDeficitA = Math.max(0, NUTRIENT_TARGET_RESERVE - this.creatureReserveA[other]);
        const otherDeficitB = Math.max(0, NUTRIENT_TARGET_RESERVE - this.creatureReserveB[other]);
        const complementary =
          (iOffersA && otherSurplusB > 0 && otherDeficitA > 0) ||
          (iOffersB && otherSurplusA > 0 && otherDeficitB > 0);
        if (!complementary) return;

        const dx = this.creaturePosX[other] - cx;
        const dy = this.creaturePosY[other] - cy;
        const distSq = dx * dx + dy * dy;
        if (distSq > TRADE_RADIUS * TRADE_RADIUS) return;

        const spatialScore = distSq / (TRADE_RADIUS * TRADE_RADIUS);
        const kinScore = kinBias * (this.genomeDistance(i, other) / MAX_GENOME_DISTANCE);
        const score = spatialScore + kinScore;
        if (score < bestScore) {
          bestScore = score;
          bestPartner = other;
        }
      });

      if (bestPartner >= 0) this.executeTrade(i, bestPartner);
    }
  }

  private executeTrade(a: number, b: number): void {
    const surplusAofA = Math.max(0, this.creatureReserveA[a] - NUTRIENT_TARGET_RESERVE);
    const deficitAofB = Math.max(0, NUTRIENT_TARGET_RESERVE - this.creatureReserveA[b]);
    const surplusBofB = Math.max(0, this.creatureReserveB[b] - NUTRIENT_TARGET_RESERVE);
    const deficitBofA = Math.max(0, NUTRIENT_TARGET_RESERVE - this.creatureReserveB[a]);

    const surplusBofA = Math.max(0, this.creatureReserveB[a] - NUTRIENT_TARGET_RESERVE);
    const deficitBofB = Math.max(0, NUTRIENT_TARGET_RESERVE - this.creatureReserveB[b]);
    const surplusAofB = Math.max(0, this.creatureReserveA[b] - NUTRIENT_TARGET_RESERVE);
    const deficitAofA = Math.max(0, NUTRIENT_TARGET_RESERVE - this.creatureReserveA[a]);

    // Case 1: a gives A (has surplus, b has deficit), b gives B back.
    const aGivesA = Math.min(surplusAofA, deficitAofB, TRADE_CHUNK);
    const bGivesB = Math.min(surplusBofB, deficitBofA, TRADE_CHUNK);
    // Case 2 (mirror): a gives B, b gives A.
    const aGivesB = Math.min(surplusBofA, deficitBofB, TRADE_CHUNK);
    const bGivesA = Math.min(surplusAofB, deficitAofA, TRADE_CHUNK);

    if (aGivesA > 0 && bGivesB > 0) {
      this.creatureReserveA[a] -= aGivesA;
      this.creatureReserveA[b] += aGivesA;
      this.creatureReserveB[b] -= bGivesB;
      this.creatureReserveB[a] += bGivesB;
    } else if (aGivesB > 0 && bGivesA > 0) {
      this.creatureReserveB[a] -= aGivesB;
      this.creatureReserveB[b] += aGivesB;
      this.creatureReserveA[b] -= bGivesA;
      this.creatureReserveA[a] += bGivesA;
    } else {
      return;
    }

    this.hasTradedThisTick[a] = 1;
    this.hasTradedThisTick[b] = 1;
    this.totalTrades++;
  }

  private isReadyToMate(i: number): boolean {
    return (
      this.creatureEnergy[i] >= REPRODUCE_THRESHOLD &&
      this.creatureReserveA[i] >= NUTRIENT_MIN_FOR_REPRODUCTION &&
      this.creatureReserveB[i] >= NUTRIENT_MIN_FOR_REPRODUCTION
    );
  }

  // Ready creatures pair up only if each finds the other's traits within
  // its own preference tolerance — mutual mate choice. Reproduction only
  // appends children (never removes), so unlike predation there's no
  // swap-pop hazard; we just snapshot the count up front so children
  // created this tick aren't visited again.
  private resolveMating(): void {
    const readyCountSnapshot = this.creatureCount;
    this.hasMatedThisTick.fill(0, 0, readyCountSnapshot);

    this.matingGrid.clear();
    for (let i = 0; i < readyCountSnapshot; i++) {
      if (this.isReadyToMate(i)) this.matingGrid.insert(i, this.creaturePosX[i], this.creaturePosY[i]);
    }

    for (let i = 0; i < readyCountSnapshot; i++) {
      if (this.hasMatedThisTick[i] || !this.isReadyToMate(i)) continue;

      const cx = this.creaturePosX[i];
      const cy = this.creaturePosY[i];

      let mate = -1;
      let mateDistSq = MATE_SEEK_RADIUS * MATE_SEEK_RADIUS;
      this.matingGrid.forEachNear(cx, cy, MATE_SEEK_RADIUS, (other) => {
        if (other === i || other >= readyCountSnapshot || this.hasMatedThisTick[other]) return;
        const dx = this.creaturePosX[other] - cx;
        const dy = this.creaturePosY[other] - cy;
        const distSq = dx * dx + dy * dy;
        if (distSq > mateDistSq) return;
        if (!this.mutuallyCompatible(i, other)) return;
        mateDistSq = distSq;
        mate = other;
      });

      if (mate >= 0) {
        this.hasMatedThisTick[i] = 1;
        this.hasMatedThisTick[mate] = 1;
        this.reproduceSexual(i, mate);
      }
    }
  }

  private mutuallyCompatible(a: number, b: number): boolean {
    return (
      this.matePreferenceDistance(a, b) <= this.creatureMateTolerance[a] &&
      this.matePreferenceDistance(b, a) <= this.creatureMateTolerance[b]
    );
  }

  // How far candidate's actual traits fall from observer's ideal.
  private matePreferenceDistance(observer: number, candidate: number): number {
    const speedDiff = this.creatureSpeedGene[candidate] - this.creaturePrefSpeed[observer];
    const reserveDiff = this.creatureReserveGene[candidate] - this.creaturePrefReserve[observer];
    return Math.sqrt(speedDiff * speedDiff + reserveDiff * reserveDiff);
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

  // Picks one parent's allele per locus (independent assortment) then
  // applies mutation — proper recombination rather than averaging.
  private recombine(rng: Rng, valueA: number, valueB: number, mutationStd: number, min: number, max: number): number {
    const inherited = rng.next() < 0.5 ? valueA : valueB;
    const mutated = inherited + rng.gaussian(0, mutationStd);
    return Math.min(max, Math.max(min, mutated));
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
    this.creatureReserveGene[i] = this.rng.range(RESERVE_GENE_MIN, RESERVE_GENE_MAX);
    this.creaturePrefSpeed[i] = this.rng.range(SPEED_GENE_MIN, SPEED_GENE_MAX);
    this.creaturePrefReserve[i] = this.rng.range(RESERVE_GENE_MIN, RESERVE_GENE_MAX);
    this.creatureMateTolerance[i] = this.rng.range(MATE_TOLERANCE_MIN, MATE_TOLERANCE_MAX);
    this.creatureHabAngle[i] = this.rng.range(0, Math.PI / 2);
    this.creatureReserveA[i] = NUTRIENT_INITIAL_RESERVE;
    this.creatureReserveB[i] = NUTRIENT_INITIAL_RESERVE;
    this.creatureKinTradeBias[i] = this.rng.next();
  }

  private spawnFood(): void {
    const i = this.foodCount++;
    this.foodPosX[i] = this.rng.next() * this.worldWidth;
    this.foodPosY[i] = this.rng.next() * this.worldHeight;
  }

  private spawnFoodA(): void {
    const i = this.foodACount++;
    this.foodAPosX[i] = this.rng.next() * this.worldWidth;
    this.foodAPosY[i] = this.rng.next() * this.worldHeight;
  }

  private spawnFoodB(): void {
    const i = this.foodBCount++;
    this.foodBPosX[i] = this.rng.next() * this.worldWidth;
    this.foodBPosY[i] = this.rng.next() * this.worldHeight;
  }

  // Square-wave climate: alternates scarcity and abundance so we can test
  // whether mate preference for reserveGene vs. speedGene tracks which
  // trait actually pays off right now.
  climateMultiplier(): number {
    const phase = this.tick % CLIMATE_PERIOD_TICKS;
    return phase < CLIMATE_PERIOD_TICKS / 2 ? CLIMATE_SCARCITY_MULTIPLIER : CLIMATE_ABUNDANCE_MULTIPLIER;
  }

  private spawnFoodOverTime(dt: number): void {
    const emptySlots = this.foodCapacity - this.foodCount;
    if (emptySlots <= 0) return;
    const expected = FOOD_REGROWTH_PROBABILITY * this.climateMultiplier() * emptySlots * dt;
    let spawns = Math.floor(expected);
    if (this.rng.next() < expected - spawns) spawns++;
    for (let s = 0; s < spawns && this.foodCount < this.foodCapacity; s++) this.spawnFood();
  }

  private spawnFoodAOverTime(dt: number): void {
    const emptySlots = this.nutrientCapacity - this.foodACount;
    if (emptySlots <= 0) return;
    const expected = FOOD_REGROWTH_PROBABILITY * emptySlots * dt;
    let spawns = Math.floor(expected);
    if (this.rng.next() < expected - spawns) spawns++;
    for (let s = 0; s < spawns && this.foodACount < this.nutrientCapacity; s++) this.spawnFoodA();
  }

  private spawnFoodBOverTime(dt: number): void {
    const emptySlots = this.nutrientCapacity - this.foodBCount;
    if (emptySlots <= 0) return;
    const expected = FOOD_REGROWTH_PROBABILITY * emptySlots * dt;
    let spawns = Math.floor(expected);
    if (this.rng.next() < expected - spawns) spawns++;
    for (let s = 0; s < spawns && this.foodBCount < this.nutrientCapacity; s++) this.spawnFoodB();
  }

  private removeFood(index: number): void {
    const last = this.foodCount - 1;
    this.foodPosX[index] = this.foodPosX[last];
    this.foodPosY[index] = this.foodPosY[last];
    this.foodCount--;
  }

  private removeFoodA(index: number): void {
    const last = this.foodACount - 1;
    this.foodAPosX[index] = this.foodAPosX[last];
    this.foodAPosY[index] = this.foodAPosY[last];
    this.foodACount--;
  }

  private removeFoodB(index: number): void {
    const last = this.foodBCount - 1;
    this.foodBPosX[index] = this.foodBPosX[last];
    this.foodBPosY[index] = this.foodBPosY[last];
    this.foodBCount--;
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
    this.creatureReserveGene[index] = this.creatureReserveGene[last];
    this.creaturePrefSpeed[index] = this.creaturePrefSpeed[last];
    this.creaturePrefReserve[index] = this.creaturePrefReserve[last];
    this.creatureMateTolerance[index] = this.creatureMateTolerance[last];
    this.creatureHabAngle[index] = this.creatureHabAngle[last];
    this.creatureReserveA[index] = this.creatureReserveA[last];
    this.creatureReserveB[index] = this.creatureReserveB[last];
    this.creatureKinTradeBias[index] = this.creatureKinTradeBias[last];
    const indexBase = index * MARKER_GENE_COUNT;
    const lastBase = last * MARKER_GENE_COUNT;
    for (let g = 0; g < MARKER_GENE_COUNT; g++) {
      this.creatureGenomeMarkers[indexBase + g] = this.creatureGenomeMarkers[lastBase + g];
    }
    this.creatureCount--;
  }

  private reproduceSexual(parentA: number, parentB: number): void {
    if (this.creatureCount >= this.creatureCapacity) return;

    const childIndex = this.creatureCount++;
    this.creatureEnergy[parentA] -= SEXUAL_REPRODUCE_COST_PER_PARENT;
    this.creatureEnergy[parentB] -= SEXUAL_REPRODUCE_COST_PER_PARENT;
    this.creatureReserveA[parentA] -= NUTRIENT_REPRODUCE_COST;
    this.creatureReserveB[parentA] -= NUTRIENT_REPRODUCE_COST;
    this.creatureReserveA[parentB] -= NUTRIENT_REPRODUCE_COST;
    this.creatureReserveB[parentB] -= NUTRIENT_REPRODUCE_COST;

    this.creaturePosX[childIndex] = this.creaturePosX[parentA];
    this.creaturePosY[childIndex] = this.creaturePosY[parentA];
    const angle = this.rng.range(0, Math.PI * 2);
    this.creatureHeadingX[childIndex] = Math.cos(angle);
    this.creatureHeadingY[childIndex] = Math.sin(angle);
    this.creatureEnergy[childIndex] = CHILD_INITIAL_ENERGY;
    this.creatureReserveA[childIndex] = NUTRIENT_CHILD_INITIAL_RESERVE;
    this.creatureReserveB[childIndex] = NUTRIENT_CHILD_INITIAL_RESERVE;

    this.creatureSpeedGene[childIndex] = this.recombine(
      this.rng,
      this.creatureSpeedGene[parentA],
      this.creatureSpeedGene[parentB],
      MUTATION_STD_DEV,
      SPEED_GENE_MIN,
      SPEED_GENE_MAX,
    );
    this.creatureReserveGene[childIndex] = this.recombine(
      this.rng,
      this.creatureReserveGene[parentA],
      this.creatureReserveGene[parentB],
      GENOME_MUTATION_STD_DEV,
      RESERVE_GENE_MIN,
      RESERVE_GENE_MAX,
    );
    this.creaturePrefSpeed[childIndex] = this.recombine(
      this.rng,
      this.creaturePrefSpeed[parentA],
      this.creaturePrefSpeed[parentB],
      MUTATION_STD_DEV,
      SPEED_GENE_MIN,
      SPEED_GENE_MAX,
    );
    this.creaturePrefReserve[childIndex] = this.recombine(
      this.rng,
      this.creaturePrefReserve[parentA],
      this.creaturePrefReserve[parentB],
      GENOME_MUTATION_STD_DEV,
      RESERVE_GENE_MIN,
      RESERVE_GENE_MAX,
    );
    this.creatureMateTolerance[childIndex] = this.recombine(
      this.rng,
      this.creatureMateTolerance[parentA],
      this.creatureMateTolerance[parentB],
      MATE_TOLERANCE_MUTATION_STD_DEV,
      MATE_TOLERANCE_MIN,
      MATE_TOLERANCE_MAX,
    );
    this.creatureKinTolerance[childIndex] = this.recombine(
      this.rng,
      this.creatureKinTolerance[parentA],
      this.creatureKinTolerance[parentB],
      KIN_TOLERANCE_MUTATION_STD_DEV,
      0,
      MAX_GENOME_DISTANCE,
    );
    this.creatureHabAngle[childIndex] = this.recombine(
      this.rng,
      this.creatureHabAngle[parentA],
      this.creatureHabAngle[parentB],
      HAB_ANGLE_MUTATION_STD_DEV,
      0,
      Math.PI / 2,
    );
    this.creatureKinTradeBias[childIndex] = this.recombine(
      this.rng,
      this.creatureKinTradeBias[parentA],
      this.creatureKinTradeBias[parentB],
      KIN_TRADE_BIAS_MUTATION_STD_DEV,
      0,
      1,
    );

    const baseA = parentA * MARKER_GENE_COUNT;
    const baseB = parentB * MARKER_GENE_COUNT;
    const baseChild = childIndex * MARKER_GENE_COUNT;
    for (let g = 0; g < MARKER_GENE_COUNT; g++) {
      this.creatureGenomeMarkers[baseChild + g] = this.recombine(
        this.rng,
        this.creatureGenomeMarkers[baseA + g],
        this.creatureGenomeMarkers[baseB + g],
        GENOME_MUTATION_STD_DEV,
        0,
        1,
      );
    }

    this.totalMatings++;
  }

  meanSpeedGene(): number {
    return this.meanOf(this.creatureSpeedGene);
  }

  meanKinTolerance(): number {
    return this.meanOf(this.creatureKinTolerance);
  }

  meanReserveGene(): number {
    return this.meanOf(this.creatureReserveGene);
  }

  meanPrefSpeed(): number {
    return this.meanOf(this.creaturePrefSpeed);
  }

  meanPrefReserve(): number {
    return this.meanOf(this.creaturePrefReserve);
  }

  meanKinTradeBias(): number {
    return this.meanOf(this.creatureKinTradeBias);
  }

  // 0 (angle == pi/4, a pure generalist) to 1 (angle == 0 or pi/2, a pure
  // A- or B-specialist).
  meanSpecialization(): number {
    if (this.creatureCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.creatureCount; i++) sum += Math.abs(Math.cos(2 * this.creatureHabAngle[i]));
    return sum / this.creatureCount;
  }

  private meanOf(values: Float32Array): number {
    if (this.creatureCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.creatureCount; i++) sum += values[i];
    return sum / this.creatureCount;
  }

  toSnapshot(): WorldSnapshot {
    return {
      version: 4,
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
      creatureReserveGene: Array.from(this.creatureReserveGene.subarray(0, this.creatureCount)),
      creaturePrefSpeed: Array.from(this.creaturePrefSpeed.subarray(0, this.creatureCount)),
      creaturePrefReserve: Array.from(this.creaturePrefReserve.subarray(0, this.creatureCount)),
      creatureMateTolerance: Array.from(this.creatureMateTolerance.subarray(0, this.creatureCount)),
      creatureHabAngle: Array.from(this.creatureHabAngle.subarray(0, this.creatureCount)),
      creatureReserveA: Array.from(this.creatureReserveA.subarray(0, this.creatureCount)),
      creatureReserveB: Array.from(this.creatureReserveB.subarray(0, this.creatureCount)),
      creatureKinTradeBias: Array.from(this.creatureKinTradeBias.subarray(0, this.creatureCount)),
      totalPredations: this.totalPredations,
      totalMatings: this.totalMatings,
      totalTrades: this.totalTrades,
      foodCount: this.foodCount,
      foodPosX: Array.from(this.foodPosX.subarray(0, this.foodCount)),
      foodPosY: Array.from(this.foodPosY.subarray(0, this.foodCount)),
      foodACount: this.foodACount,
      foodAPosX: Array.from(this.foodAPosX.subarray(0, this.foodACount)),
      foodAPosY: Array.from(this.foodAPosY.subarray(0, this.foodACount)),
      foodBCount: this.foodBCount,
      foodBPosX: Array.from(this.foodBPosX.subarray(0, this.foodBCount)),
      foodBPosY: Array.from(this.foodBPosY.subarray(0, this.foodBCount)),
    };
  }

  loadSnapshot(snapshot: WorldSnapshot): void {
    if (snapshot.version !== 4) {
      throw new Error(`Versión de guardado incompatible: se esperaba 4, el archivo tiene ${snapshot.version}`);
    }
    if (snapshot.creatureCount > this.creatureCapacity) {
      throw new Error(
        `Snapshot has ${snapshot.creatureCount} creatures, capacity is ${this.creatureCapacity}`,
      );
    }
    if (snapshot.foodCount > this.foodCapacity) {
      throw new Error(`Snapshot has ${snapshot.foodCount} food items, capacity is ${this.foodCapacity}`);
    }
    if (snapshot.foodACount > this.nutrientCapacity || snapshot.foodBCount > this.nutrientCapacity) {
      throw new Error(`Snapshot nutrient counts exceed capacity ${this.nutrientCapacity}`);
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
    this.creatureReserveGene.set(snapshot.creatureReserveGene);
    this.creaturePrefSpeed.set(snapshot.creaturePrefSpeed);
    this.creaturePrefReserve.set(snapshot.creaturePrefReserve);
    this.creatureMateTolerance.set(snapshot.creatureMateTolerance);
    this.creatureHabAngle.set(snapshot.creatureHabAngle);
    this.creatureReserveA.set(snapshot.creatureReserveA);
    this.creatureReserveB.set(snapshot.creatureReserveB);
    this.creatureKinTradeBias.set(snapshot.creatureKinTradeBias);
    this.totalPredations = snapshot.totalPredations;
    this.totalMatings = snapshot.totalMatings;
    this.totalTrades = snapshot.totalTrades;

    this.foodCount = snapshot.foodCount;
    this.foodPosX.set(snapshot.foodPosX);
    this.foodPosY.set(snapshot.foodPosY);
    this.foodACount = snapshot.foodACount;
    this.foodAPosX.set(snapshot.foodAPosX);
    this.foodAPosY.set(snapshot.foodAPosY);
    this.foodBCount = snapshot.foodBCount;
    this.foodBPosX.set(snapshot.foodBPosX);
    this.foodBPosY.set(snapshot.foodBPosY);
  }
}
