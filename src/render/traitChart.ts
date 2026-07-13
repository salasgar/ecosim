import uPlot from "uplot";
import type { StatsMessage } from "../sim/protocol";
import { DecimatingSeriesBuffer } from "./decimatingBuffer";

const MAX_POINTS = 8000;

// Tracks Experiment 2's core question: does mate preference for
// reserveGene vs. speedGene track which trait the climate currently
// rewards? All three series share one 0-2 scale — units differ slightly
// (reserveGene/prefReserve are 0-1, prefSpeed is ~0.4-1.8) but stay close
// enough for a diagnostic chart.
export class TraitChart {
  private readonly plot: uPlot;
  private readonly buffer = new DecimatingSeriesBuffer(MAX_POINTS, 4);

  constructor(host: HTMLElement) {
    const options: uPlot.Options = {
      width: 420,
      height: 160,
      padding: [8, 8, 0, 0],
      scales: { x: { time: false }, value: {} },
      series: [
        {},
        { label: "reservaGen medio", stroke: "#38bdf8", scale: "value", width: 2 },
        { label: "vel. preferida media", stroke: "#c084fc", scale: "value", width: 1 },
        { label: "reserva preferida media", stroke: "#f472b6", scale: "value", width: 1 },
      ],
      axes: [
        { stroke: "#9ca3af", grid: { stroke: "#2e303a" } },
        { scale: "value", stroke: "#9ca3af", grid: { stroke: "#2e303a" }, side: 3 },
      ],
      legend: { show: true },
    };
    this.plot = new uPlot(options, [[], [], [], []], host);
  }

  push(stats: StatsMessage): void {
    this.buffer.push([stats.tick, stats.meanReserveGene, stats.meanPrefSpeed, stats.meanPrefReserve]);
    this.plot.setData(this.buffer.data() as [number[], number[], number[], number[]]);
  }
}
