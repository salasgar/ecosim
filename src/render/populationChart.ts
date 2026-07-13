import uPlot from "uplot";
import type { StatsMessage } from "../sim/protocol";

const MAX_POINTS = 2000;

export class PopulationChart {
  private readonly plot: uPlot;
  private ticks: number[] = [];
  private creatures: number[] = [];
  private food: number[] = [];
  private meanSpeed: number[] = [];
  private meanKinTolerance: number[] = [];

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
    this.ticks.push(stats.tick);
    this.creatures.push(stats.creatureCount);
    this.food.push(stats.foodCount);
    this.meanSpeed.push(stats.meanSpeedGene);
    this.meanKinTolerance.push(stats.meanKinTolerance);
    if (this.ticks.length > MAX_POINTS) this.decimate();
    this.plot.setData([this.ticks, this.creatures, this.food, this.meanSpeed, this.meanKinTolerance]);
  }

  private decimate(): void {
    this.ticks = this.ticks.filter((_, i) => i % 2 === 0);
    this.creatures = this.creatures.filter((_, i) => i % 2 === 0);
    this.food = this.food.filter((_, i) => i % 2 === 0);
    this.meanSpeed = this.meanSpeed.filter((_, i) => i % 2 === 0);
    this.meanKinTolerance = this.meanKinTolerance.filter((_, i) => i % 2 === 0);
  }
}
