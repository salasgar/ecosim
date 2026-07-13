import "./style.css";
import { Renderer } from "./render/renderer";
import type { FromWorkerMessage, ToWorkerMessage } from "./sim/protocol";

async function bootstrap(): Promise<void> {
  const appHost = document.querySelector<HTMLDivElement>("#app");
  if (!appHost) throw new Error("Missing #app host element");

  const renderer = await Renderer.create(appHost);

  const hud = document.createElement("div");
  hud.className = "hud";
  appHost.appendChild(hud);

  const pauseButton = document.createElement("button");
  pauseButton.textContent = "Pausa";
  hud.appendChild(pauseButton);

  const stats = document.createElement("span");
  stats.textContent = "iniciando…";
  hud.appendChild(stats);

  const worker = new Worker(new URL("./sim/worker.ts", import.meta.url), { type: "module" });

  let paused = false;
  pauseButton.addEventListener("click", () => {
    paused = !paused;
    pauseButton.textContent = paused ? "Reanudar" : "Pausa";
    const message: ToWorkerMessage = { type: "setPaused", paused };
    worker.postMessage(message);
  });

  worker.onmessage = (event: MessageEvent<FromWorkerMessage>) => {
    const message = event.data;
    renderer.update(message);
    stats.textContent = `tick ${message.tick} · criaturas ${message.creatureCount} · comida ${message.foodCount}`;
  };

  const seedParam = new URLSearchParams(location.search).get("seed");
  const seed = seedParam ? Number(seedParam) : 1;

  const init: ToWorkerMessage = {
    type: "init",
    seed,
    worldWidth: renderer.width,
    worldHeight: renderer.height,
  };
  worker.postMessage(init);
}

void bootstrap();
