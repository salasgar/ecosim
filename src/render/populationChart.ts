import uPlot from "uplot";
import type { StatsMessage } from "../sim/protocol";
import { DecimatingSeriesBuffer } from "./decimatingBuffer";

const MAX_POINTS = 8000;

export class PopulationChart {
  private readonly plot: uPlot;
  private readonly buffer = new DecimatingSeriesBuffer(MAX_POINTS, 5);

  constructor(host: HTMLElement) {
    const options: uPlot.Options = {
      width: 420,
      height: 180,
      padding: [8, 8, 0, 0],
      scales: {
        x: { time: false },
        count: {},
        trait: {},
      },
      series: [
        {},
        { label: "criaturas", stroke: "#4ade80", scale: "count", width: 2 },
        { label: "comida", stroke: "#86efac", scale: "count", width: 1 },
        { label: "gen velocidad medio", stroke: "#c084fc", scale: "trait", width: 1 },
        { label: "umbral parentesco medio", stroke: "#fb923c", scale: "trait", width: 1 },
      ],
      axes: [
        { stroke: "#9ca3af", grid: { stroke: "#2e303a" } },
        { scale: "count", stroke: "#9ca3af", grid: { stroke: "#2e303a" }, side: 3 },
        { scale: "trait", stroke: "#c084fc", grid: { show: false }, side: 1 },
      ],
      legend: { show: true },
    };
    this.plot = new uPlot(options, [[], [], [], [], []], host);
  }

  push(stats: StatsMessage): void {
    this.buffer.push([stats.tick, stats.creatureCount, stats.foodCount, stats.meanSpeedGene, stats.meanKinTolerance]);
    this.plot.setData(this.buffer.data() as [number[], number[], number[], number[], number[]]);
  }
}
