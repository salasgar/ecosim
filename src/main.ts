import "./style.css";
import "uplot/dist/uPlot.min.css";
import { Renderer } from "./render/renderer";
import { PopulationChart } from "./render/populationChart";
import type { FromWorkerMessage, ToWorkerMessage, WorldSnapshot } from "./sim/protocol";

const MAX_SPEED_TICKS_PER_FRAME = 20;

function downloadSnapshot(snapshot: WorldSnapshot): void {
  const blob = new Blob([JSON.stringify(snapshot)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ecosim-tick${snapshot.tick}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

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

  const speedButton = document.createElement("button");
  speedButton.textContent = "Velocidad máxima";
  hud.appendChild(speedButton);

  const saveButton = document.createElement("button");
  saveButton.textContent = "Guardar";
  hud.appendChild(saveButton);

  const loadButton = document.createElement("button");
  loadButton.textContent = "Cargar";
  hud.appendChild(loadButton);

  const loadInput = document.createElement("input");
  loadInput.type = "file";
  loadInput.accept = "application/json";
  loadInput.style.display = "none";
  hud.appendChild(loadInput);

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = "";
  hud.appendChild(badge);

  const stats = document.createElement("span");
  stats.textContent = "iniciando…";
  hud.appendChild(stats);

  const chartHost = document.createElement("div");
  chartHost.className = "chart-panel";
  appHost.appendChild(chartHost);
  const chart = new PopulationChart(chartHost);

  const worker = new Worker(new URL("./sim/worker.ts", import.meta.url), { type: "module" });

  let paused = false;
  pauseButton.addEventListener("click", () => {
    paused = !paused;
    pauseButton.textContent = paused ? "Reanudar" : "Pausa";
    const message: ToWorkerMessage = { type: "setPaused", paused };
    worker.postMessage(message);
  });

  let maxSpeed = false;
  speedButton.addEventListener("click", () => {
    maxSpeed = !maxSpeed;
    speedButton.textContent = maxSpeed ? "Velocidad normal" : "Velocidad máxima";
    badge.textContent = maxSpeed ? "MODO RÁPIDO (sin render)" : "";
    const speedMessage: ToWorkerMessage = {
      type: "setSpeed",
      ticksPerFrame: maxSpeed ? MAX_SPEED_TICKS_PER_FRAME : 1,
    };
    const renderMessage: ToWorkerMessage = { type: "setRenderEnabled", enabled: !maxSpeed };
    worker.postMessage(speedMessage);
    worker.postMessage(renderMessage);
  });

  saveButton.addEventListener("click", () => {
    const message: ToWorkerMessage = { type: "requestSave" };
    worker.postMessage(message);
  });

  loadButton.addEventListener("click", () => loadInput.click());
  loadInput.addEventListener("change", () => {
    const file = loadInput.files?.[0];
    if (!file) return;
    file
      .text()
      .then((text) => {
        const snapshot = JSON.parse(text) as WorldSnapshot;
        const message: ToWorkerMessage = { type: "load", snapshot };
        worker.postMessage(message);
      })
      .finally(() => {
        loadInput.value = "";
      });
  });

  worker.onmessage = (event: MessageEvent<FromWorkerMessage>) => {
    const message = event.data;
    switch (message.type) {
      case "tick":
        renderer.update(message);
        break;
      case "stats":
        stats.textContent = `tick ${message.tick} · criaturas ${message.creatureCount} · comida ${message.foodCount} · vel. media ${message.meanSpeedGene.toFixed(2)}`;
        chart.push(message);
        break;
      case "save":
        downloadSnapshot(message.snapshot);
        break;
    }
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
