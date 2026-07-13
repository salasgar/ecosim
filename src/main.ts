import "./style.css";
import "uplot/dist/uPlot.min.css";
import { Renderer } from "./render/renderer";
import { PopulationChart } from "./render/populationChart";
import { TraitChart } from "./render/traitChart";
import { TradeChart } from "./render/tradeChart";
import type { FromWorkerMessage, ToWorkerMessage, WorldSnapshot } from "./sim/protocol";
import { DEFAULT_PARAMS, PARAM_DESCRIPTORS, type SimParams } from "./sim/params";

const MAX_SPEED_TICKS_PER_FRAME = 20;

function decimalsForStep(step: number): number {
  const dot = step.toString().indexOf(".");
  return dot === -1 ? 0 : step.toString().length - dot - 1;
}

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

  const paramsButton = document.createElement("button");
  paramsButton.textContent = "Parámetros";
  hud.appendChild(paramsButton);

  const worldVisibilityButton = document.createElement("button");
  worldVisibilityButton.textContent = "Ocultar mundo";
  hud.appendChild(worldVisibilityButton);

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

  const traitChartHost = document.createElement("div");
  traitChartHost.className = "chart-panel chart-panel-right";
  appHost.appendChild(traitChartHost);
  const traitChart = new TraitChart(traitChartHost);

  const tradeChartHost = document.createElement("div");
  tradeChartHost.className = "chart-panel chart-panel-center";
  appHost.appendChild(tradeChartHost);
  const tradeChart = new TradeChart(tradeChartHost);

  const worker = new Worker(new URL("./sim/worker.ts", import.meta.url), { type: "module" });

  const currentParams: SimParams = { ...DEFAULT_PARAMS };
  const paramInputs = new Map<keyof SimParams, HTMLInputElement>();
  const paramValueSpans = new Map<keyof SimParams, HTMLSpanElement>();

  const paramsPanel = document.createElement("div");
  paramsPanel.className = "params-panel hidden";
  appHost.appendChild(paramsPanel);

  const paramsHeader = document.createElement("div");
  paramsHeader.className = "params-panel-header";
  paramsHeader.textContent = "Parámetros de la simulación";
  paramsPanel.appendChild(paramsHeader);

  const resetParamsButton = document.createElement("button");
  resetParamsButton.textContent = "Restablecer valores por defecto";
  paramsPanel.appendChild(resetParamsButton);

  let currentGroup = "";
  let groupFieldset: HTMLFieldSetElement | null = null;
  for (const descriptor of PARAM_DESCRIPTORS) {
    if (descriptor.group !== currentGroup) {
      currentGroup = descriptor.group;
      groupFieldset = document.createElement("fieldset");
      const legend = document.createElement("legend");
      legend.textContent = currentGroup;
      groupFieldset.appendChild(legend);
      paramsPanel.appendChild(groupFieldset);
    }

    const row = document.createElement("label");
    row.className = "param-row";

    const labelText = document.createElement("span");
    labelText.className = "param-label";
    labelText.textContent = descriptor.label;

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(descriptor.min);
    input.max = String(descriptor.max);
    input.step = String(descriptor.step);
    input.value = String(currentParams[descriptor.key]);
    paramInputs.set(descriptor.key, input);

    const valueSpan = document.createElement("span");
    valueSpan.className = "param-value";
    valueSpan.textContent = currentParams[descriptor.key].toFixed(decimalsForStep(descriptor.step));
    paramValueSpans.set(descriptor.key, valueSpan);

    input.addEventListener("input", () => {
      const value = Number(input.value);
      currentParams[descriptor.key] = value;
      valueSpan.textContent = value.toFixed(decimalsForStep(descriptor.step));
      const patch = { [descriptor.key]: value } as Partial<SimParams>;
      const message: ToWorkerMessage = { type: "setParams", params: patch };
      worker.postMessage(message);
    });

    row.appendChild(labelText);
    row.appendChild(input);
    row.appendChild(valueSpan);
    (groupFieldset as HTMLFieldSetElement).appendChild(row);
  }

  resetParamsButton.addEventListener("click", () => {
    Object.assign(currentParams, DEFAULT_PARAMS);
    for (const descriptor of PARAM_DESCRIPTORS) {
      const input = paramInputs.get(descriptor.key);
      const valueSpan = paramValueSpans.get(descriptor.key);
      const value = DEFAULT_PARAMS[descriptor.key];
      if (input) input.value = String(value);
      if (valueSpan) valueSpan.textContent = value.toFixed(decimalsForStep(descriptor.step));
    }
    const message: ToWorkerMessage = { type: "setParams", params: { ...DEFAULT_PARAMS } };
    worker.postMessage(message);
  });

  paramsButton.addEventListener("click", () => {
    paramsPanel.classList.toggle("hidden");
  });

  let worldVisible = true;
  worldVisibilityButton.addEventListener("click", () => {
    worldVisible = !worldVisible;
    renderer.setWorldVisible(worldVisible);
    worldVisibilityButton.textContent = worldVisible ? "Ocultar mundo" : "Mostrar mundo";
  });

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
      case "stats": {
        const climate = message.climateMultiplier < 1 ? "escasez" : "abundancia";
        stats.textContent = `tick ${message.tick} · criaturas ${message.creatureCount} · comida ${message.foodCount} · vel. media ${message.meanSpeedGene.toFixed(2)} · umbral parentesco ${message.meanKinTolerance.toFixed(2)} · especialización ${message.meanSpecialization.toFixed(2)} · depredaciones ${message.totalPredations} · uniones ${message.totalMatings} · comercios ${message.totalTrades} · clima ${climate}`;
        chart.push(message);
        traitChart.push(message);
        tradeChart.push(message);
        break;
      }
      case "save":
        downloadSnapshot(message.snapshot);
        break;
      case "error":
        alert(message.message);
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
