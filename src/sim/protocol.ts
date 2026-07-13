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

export type ToWorkerMessage = InitMessage | SetPausedMessage | SetSpeedMessage;

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

export type FromWorkerMessage = TickMessage;
