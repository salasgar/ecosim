import type { StatsMessage } from "../sim/protocol";
import { ConfigurableChart, MAX_POINTS, type AxisSide, type ChartSeriesConfig } from "./configurableChart";
import { DecimatingSeriesBuffer } from "./decimatingBuffer";
import { SERIES_CATALOG } from "./seriesCatalog";

interface ChartConfig {
  id: string;
  title: string;
  visible: boolean;
  series: ChartSeriesConfig[];
}

interface ChartEntry {
  config: ChartConfig;
  instance: ConfigurableChart;
  card: HTMLElement;
  titleEl: HTMLElement;
  resizeObserver: ResizeObserver;
}

// Seeds the same three charts the app used to hard-code, but now as
// ordinary, editable/removable entries — keeps the panel non-empty on
// first load instead of dropping the user into a blank charts area.
const DEFAULT_CHARTS: Array<Omit<ChartConfig, "id">> = [
  {
    title: "Población",
    visible: true,
    series: [
      { key: "creatureCount", axis: "left" },
      { key: "foodCount", axis: "left" },
      { key: "meanSpeedGene", axis: "right" },
      { key: "meanKinTolerance", axis: "right" },
    ],
  },
  {
    title: "Rasgos",
    visible: true,
    series: [
      { key: "meanReserveGene", axis: "left" },
      { key: "meanPrefSpeed", axis: "left" },
      { key: "meanPrefReserve", axis: "left" },
    ],
  },
  {
    title: "Comercio",
    visible: true,
    series: [
      { key: "meanSpecialization", axis: "left" },
      { key: "meanKinTradeBias", axis: "left" },
      { key: "totalTrades", axis: "right" },
    ],
  },
];

export interface ChartsManager {
  push(stats: StatsMessage): void;
  togglePanel(): void;
}

// Builds both halves of the configurable-charts feature: the "charts-area"
// where visible charts render (a flex-wrap container that redistributes
// space automatically as charts are added, removed, shown or hidden) and
// the "Gráficas" manager panel (mirrors the params panel) where the user
// creates charts and picks which stats each one plots.
export function createChartsManager(appHost: HTMLElement): ChartsManager {
  let nextId = 1;
  const entries = new Map<string, ChartEntry>();

  // Tracks every plottable field since tick 0, independent of which charts
  // currently exist or what they're configured to show — lets a chart
  // created mid-run be backfilled from the start instead of showing only
  // data pushed after it was created.
  const history = new DecimatingSeriesBuffer(MAX_POINTS, SERIES_CATALOG.length + 1);

  const chartsArea = document.createElement("div");
  chartsArea.className = "charts-area";
  appHost.appendChild(chartsArea);

  const managerPanel = document.createElement("div");
  managerPanel.className = "params-panel charts-manager-panel hidden";
  appHost.appendChild(managerPanel);

  const header = document.createElement("div");
  header.className = "params-panel-header";
  header.textContent = "Gráficas";
  managerPanel.appendChild(header);

  const newChartButton = document.createElement("button");
  newChartButton.textContent = "+ Nueva gráfica";
  managerPanel.appendChild(newChartButton);

  const listHost = document.createElement("div");
  managerPanel.appendChild(listHost);

  function createChart(config: ChartConfig): void {
    const card = document.createElement("div");
    card.className = config.visible ? "chart-card" : "chart-card hidden";

    const titleEl = document.createElement("div");
    titleEl.className = "chart-card-header";
    titleEl.textContent = config.title;
    card.appendChild(titleEl);

    const plotHost = document.createElement("div");
    plotHost.className = "chart-card-plot";
    card.appendChild(plotHost);

    chartsArea.appendChild(card);

    const instance = new ConfigurableChart(plotHost);
    instance.setSeries(config.series, history.data());

    const resizeObserver = new ResizeObserver((observedEntries) => {
      for (const observed of observedEntries) {
        instance.resize(observed.contentRect.width);
      }
    });
    resizeObserver.observe(plotHost);

    entries.set(config.id, { config, instance, card, titleEl, resizeObserver });
    renderManagerItem(config);
  }

  function removeChart(id: string, item: HTMLElement): void {
    const entry = entries.get(id);
    if (!entry) return;
    entry.resizeObserver.disconnect();
    entry.instance.destroy();
    entry.card.remove();
    item.remove();
    entries.delete(id);
  }

  function renderManagerItem(config: ChartConfig): void {
    const item = document.createElement("fieldset");
    item.className = "chart-manager-item";

    const legend = document.createElement("legend");
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "chart-title-input";
    titleInput.value = config.title;
    titleInput.addEventListener("input", () => {
      config.title = titleInput.value;
      const entry = entries.get(config.id);
      if (entry) entry.titleEl.textContent = config.title;
    });
    legend.appendChild(titleInput);
    item.appendChild(legend);

    const controls = document.createElement("div");
    controls.className = "chart-manager-controls";

    const visibleLabel = document.createElement("label");
    const visibleCheckbox = document.createElement("input");
    visibleCheckbox.type = "checkbox";
    visibleCheckbox.checked = config.visible;
    visibleCheckbox.addEventListener("change", () => {
      config.visible = visibleCheckbox.checked;
      entries.get(config.id)?.card.classList.toggle("hidden", !config.visible);
    });
    visibleLabel.appendChild(visibleCheckbox);
    visibleLabel.appendChild(document.createTextNode(" Visible"));
    controls.appendChild(visibleLabel);

    const deleteButton = document.createElement("button");
    deleteButton.className = "chart-delete-button";
    deleteButton.textContent = "Eliminar";
    deleteButton.addEventListener("click", () => removeChart(config.id, item));
    controls.appendChild(deleteButton);

    item.appendChild(controls);

    const seriesList = document.createElement("div");
    seriesList.className = "chart-series-list";
    for (const descriptor of SERIES_CATALOG) {
      const row = document.createElement("div");
      row.className = "chart-series-row";

      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      const existing = config.series.find((s) => s.key === descriptor.key);
      checkbox.checked = !!existing;
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(` ${descriptor.label}`));

      const axisSelect = document.createElement("select");
      axisSelect.className = "chart-axis-select";
      for (const [value, label2] of [
        ["left", "Izq"],
        ["right", "Der"],
      ] as const) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label2;
        axisSelect.appendChild(option);
      }
      axisSelect.value = existing?.axis ?? "left";
      axisSelect.disabled = !existing;

      const syncSeries = (): void => {
        const idx = config.series.findIndex((s) => s.key === descriptor.key);
        if (checkbox.checked) {
          const axis = axisSelect.value as AxisSide;
          if (idx === -1) config.series.push({ key: descriptor.key, axis });
          else config.series[idx].axis = axis;
        } else if (idx !== -1) {
          config.series.splice(idx, 1);
        }
        axisSelect.disabled = !checkbox.checked;
        entries.get(config.id)?.instance.setSeries([...config.series], history.data());
      };

      checkbox.addEventListener("change", syncSeries);
      axisSelect.addEventListener("change", syncSeries);

      row.appendChild(label);
      row.appendChild(axisSelect);
      seriesList.appendChild(row);
    }
    item.appendChild(seriesList);

    listHost.appendChild(item);
  }

  newChartButton.addEventListener("click", () => {
    const id = `chart-${nextId++}`;
    createChart({ id, title: `Gráfica ${nextId - 1}`, visible: true, series: [] });
  });

  for (const def of DEFAULT_CHARTS) {
    createChart({ id: `chart-${nextId++}`, ...def });
  }

  return {
    push(stats: StatsMessage): void {
      history.push([stats.tick, ...SERIES_CATALOG.map((d) => stats[d.key] as number)]);
      for (const entry of entries.values()) entry.instance.push(stats);
    },
    togglePanel(): void {
      managerPanel.classList.toggle("hidden");
    },
  };
}
