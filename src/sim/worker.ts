import { World } from "./world";
import type {
  ErrorMessage,
  FromWorkerMessage,
  SaveMessage,
  StatsMessage,
  TickMessage,
  ToWorkerMessage,
} from "./protocol";

// Typed narrowly instead of pulling in the "webworker" lib, which conflicts
// with the "DOM" lib already used by the main thread in the same tsconfig.
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<ToWorkerMessage>) => void) | null;
  postMessage: (message: FromWorkerMessage, transfer?: Transferable[]) => void;
};

const TICK_MS = 1000 / 30;
const DT = TICK_MS / 1000;

let world: World | null = null;
let paused = false;
let ticksPerFrame = 1;
let renderEnabled = true;
let intervalId: number | undefined;

function postTick(w: World): void {
  const creaturePosX = w.creaturePosX.slice(0, w.creatureCount);
  const creaturePosY = w.creaturePosY.slice(0, w.creatureCount);
  const creatureEnergy = w.creatureEnergy.slice(0, w.creatureCount);
  const foodPosX = w.foodPosX.slice(0, w.foodCount);
  const foodPosY = w.foodPosY.slice(0, w.foodCount);
  const foodAPosX = w.foodAPosX.slice(0, w.foodACount);
  const foodAPosY = w.foodAPosY.slice(0, w.foodACount);
  const foodBPosX = w.foodBPosX.slice(0, w.foodBCount);
  const foodBPosY = w.foodBPosY.slice(0, w.foodBCount);

  const message: TickMessage = {
    type: "tick",
    tick: w.tick,
    creatureCount: w.creatureCount,
    creaturePosX,
    creaturePosY,
    creatureEnergy,
    foodCount: w.foodCount,
    foodPosX,
    foodPosY,
    foodACount: w.foodACount,
    foodAPosX,
    foodAPosY,
    foodBCount: w.foodBCount,
    foodBPosX,
    foodBPosY,
  };

  ctx.postMessage(message, [
    creaturePosX.buffer,
    creaturePosY.buffer,
    creatureEnergy.buffer,
    foodPosX.buffer,
    foodPosY.buffer,
    foodAPosX.buffer,
    foodAPosY.buffer,
    foodBPosX.buffer,
    foodBPosY.buffer,
  ]);
}

function postStats(w: World): void {
  const message: StatsMessage = {
    type: "stats",
    tick: w.tick,
    creatureCount: w.creatureCount,
    foodCount: w.foodCount,
    meanSpeedGene: w.meanSpeedGene(),
    meanKinTolerance: w.meanKinTolerance(),
    meanReserveGene: w.meanReserveGene(),
    meanPrefSpeed: w.meanPrefSpeed(),
    meanPrefReserve: w.meanPrefReserve(),
    meanSpecialization: w.meanSpecialization(),
    meanKinTradeBias: w.meanKinTradeBias(),
    totalPredations: w.totalPredations,
    totalMatings: w.totalMatings,
    totalTrades: w.totalTrades,
    climateMultiplier: w.climateMultiplier(),
  };
  ctx.postMessage(message);
}

function startLoop(): void {
  intervalId = setInterval(() => {
    if (!world || paused) return;
    for (let t = 0; t < ticksPerFrame; t++) world.step(DT);
    postStats(world);
    if (renderEnabled) postTick(world);
  }, TICK_MS);
}

ctx.onmessage = (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "init":
      world = new World({ seed: msg.seed, worldWidth: msg.worldWidth, worldHeight: msg.worldHeight });
      if (intervalId === undefined) startLoop();
      break;
    case "setPaused":
      paused = msg.paused;
      break;
    case "setSpeed":
      ticksPerFrame = Math.max(1, Math.floor(msg.ticksPerFrame));
      break;
    case "setRenderEnabled":
      renderEnabled = msg.enabled;
      if (renderEnabled && world) postTick(world);
      break;
    case "requestSave":
      if (world) {
        const message: SaveMessage = { type: "save", snapshot: world.toSnapshot() };
        ctx.postMessage(message);
      }
      break;
    case "setParams":
      if (world) world.setParams(msg.params);
      break;
    case "load":
      try {
        const candidate = new World({
          seed: 0,
          worldWidth: msg.snapshot.worldWidth,
          worldHeight: msg.snapshot.worldHeight,
          initialCreatures: 0,
          initialFood: 0,
          initialNutrient: 0,
        });
        candidate.loadSnapshot(msg.snapshot);
        world = candidate;
      } catch (err) {
        const message: ErrorMessage = { type: "error", message: err instanceof Error ? err.message : String(err) };
        ctx.postMessage(message);
      }
      break;
  }
};
