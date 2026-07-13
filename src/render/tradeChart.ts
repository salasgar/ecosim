import uPlot from "uplot";
import type { StatsMessage } from "../sim/protocol";
import { DecimatingSeriesBuffer } from "./decimatingBuffer";

const MAX_POINTS = 8000;

// Tracks Experiment 3's core question: does the population specialize
// (Pareto trade-off between nutrient A and B extraction) and does trade
// partner choice lean on kinship?
export class TradeChart {
  private readonly plot: uPlot;
  private readonly buffer = new DecimatingSeriesBuffer(MAX_POINTS, 4);

  constructor(host: HTMLElement) {
    const options: uPlot.Options = {
      width: 420,
      height: 160,
      padding: [8, 8, 0, 0],
      scales: { x: { time: false }, value: {}, trades: {} },
      series: [
        {},
        { label: "especialización media", stroke: "#38bdf8", scale: "value", width: 2 },
        { label: "sesgo de parentesco en comercio", stroke: "#fb923c", scale: "value", width: 1 },
        { label: "comercios totales", stroke: "#f472b6", scale: "trades", width: 1 },
      ],
      axes: [
        { stroke: "#9ca3af", grid: { stroke: "#2e303a" } },
        { scale: "value", stroke: "#9ca3af", grid: { stroke: "#2e303a" }, side: 3 },
        { scale: "trades", stroke: "#f472b6", grid: { show: false }, side: 1 },
      ],
      legend: { show: true },
    };
    this.plot = new uPlot(options, [[], [], [], []], host);
  }

  push(stats: StatsMessage): void {
    this.buffer.push([stats.tick, stats.meanSpecialization, stats.meanKinTradeBias, stats.totalTrades]);
    this.plot.setData(this.buffer.data() as [number[], number[], number[], number[]]);
  }
}
