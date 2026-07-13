import { World } from "./world";
import type { FromWorkerMessage, TickMessage, ToWorkerMessage } from "./protocol";

// Typed narrowly instead of pulling in the "webworker" lib, which conflicts
// with the "DOM" lib already used by the main thread in the same tsconfig.
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<ToWorkerMessage>) => void) | null;
  postMessage: (message: FromWorkerMessage, transfer: Transferable[]) => void;
};

const TICK_MS = 1000 / 30;
const DT = TICK_MS / 1000;

let world: World | null = null;
let paused = false;
let ticksPerFrame = 1;
let intervalId: number | undefined;

function postSnapshot(w: World): void {
  const creaturePosX = w.creaturePosX.slice(0, w.creatureCount);
  const creaturePosY = w.creaturePosY.slice(0, w.creatureCount);
  const creatureEnergy = w.creatureEnergy.slice(0, w.creatureCount);
  const foodPosX = w.foodPosX.slice(0, w.foodCount);
  const foodPosY = w.foodPosY.slice(0, w.foodCount);

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
  };

  ctx.postMessage(message, [
    creaturePosX.buffer,
    creaturePosY.buffer,
    creatureEnergy.buffer,
    foodPosX.buffer,
    foodPosY.buffer,
  ]);
}

function startLoop(): void {
  intervalId = setInterval(() => {
    if (!world || paused) return;
    for (let t = 0; t < ticksPerFrame; t++) world.step(DT);
    postSnapshot(world);
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
  }
};
