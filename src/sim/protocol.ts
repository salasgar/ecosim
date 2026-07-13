// Message contract between the main thread and the simulation worker.
// Kept in one place so both sides stay in sync.

export interface InitMessage {
  type: "init";
  seed: number;
  worldWidth: number;
  worldHeight: number;
}

export interface SetPausedMessage {
  type: "setPaused";
  paused: boolean;
}

export interface SetSpeedMessage {
  type: "setSpeed";
  ticksPerFrame: number;
}

// When disabled, the worker stops building and transferring per-creature
// position snapshots (the expensive part at thousands of creatures) while
// still emitting cheap StatsMessages, so "max speed" buys a real speedup
// instead of just hiding the canvas.
export interface SetRenderEnabledMessage {
  type: "setRenderEnabled";
  enabled: boolean;
}

export interface RequestSaveMessage {
  type: "requestSave";
}

export interface LoadMessage {
  type: "load";
  snapshot: WorldSnapshot;
}

export type ToWorkerMessage =
  | InitMessage
  | SetPausedMessage
  | SetSpeedMessage
  | SetRenderEnabledMessage
  | RequestSaveMessage
  | LoadMessage;

export interface TickMessage {
  type: "tick";
  tick: number;
  creatureCount: number;
  creaturePosX: Float32Array;
  creaturePosY: Float32Array;
  creatureEnergy: Float32Array;
  foodCount: number;
  foodPosX: Float32Array;
  foodPosY: Float32Array;
}

// Cheap, array-free summary sent every tick regardless of render mode —
// drives the HUD text and the population chart even in max-speed mode.
export interface StatsMessage {
  type: "stats";
  tick: number;
  creatureCount: number;
  foodCount: number;
  meanSpeedGene: number;
  meanKinTolerance: number;
  meanReserveGene: number;
  meanPrefSpeed: number;
  meanPrefReserve: number;
  totalPredations: number;
  totalMatings: number;
  climateMultiplier: number;
}

// A full, JSON-serializable copy of world state, precise enough (including
// the RNG's internal state) to resume a run bit-for-bit identically.
export interface WorldSnapshot {
  version: 3;
  tick: number;
  worldWidth: number;
  worldHeight: number;
  rngState: number;
  creatureCount: number;
  creaturePosX: number[];
  creaturePosY: number[];
  creatureHeadingX: number[];
  creatureHeadingY: number[];
  creatureSpeedGene: number[];
  creatureEnergy: number[];
  creatureGenomeMarkers: number[];
  creatureKinTolerance: number[];
  creatureReserveGene: number[];
  creaturePrefSpeed: number[];
  creaturePrefReserve: number[];
  creatureMateTolerance: number[];
  totalPredations: number;
  totalMatings: number;
  foodCount: number;
  foodPosX: number[];
  foodPosY: number[];
}

export interface SaveMessage {
  type: "save";
  snapshot: WorldSnapshot;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type FromWorkerMessage = TickMessage | StatsMessage | SaveMessage | ErrorMessage;
