import uPlot from "uplot";
import type { StatsMessage } from "../sim/protocol";

const MAX_POINTS = 2000;

// Tracks Experiment 2's core question: does mate preference for
// reserveGene vs. speedGene track which trait the climate currently
// rewards? All three series share one 0-2 scale — units differ slightly
// (reserveGene/prefReserve are 0-1, prefSpeed is ~0.4-1.8) but stay close
// enough for a diagnostic chart.
export class TraitChart {
  private readonly plot: uPlot;
  private ticks: number[] = [];
  private reserveGene: number[] = [];
  private prefSpeed: number[] = [];
  private prefReserve: number[] = [];

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
    this.ticks.push(stats.tick);
    this.reserveGene.push(stats.meanReserveGene);
    this.prefSpeed.push(stats.meanPrefSpeed);
    this.prefReserve.push(stats.meanPrefReserve);
    if (this.ticks.length > MAX_POINTS) this.decimate();
    this.plot.setData([this.ticks, this.reserveGene, this.prefSpeed, this.prefReserve]);
  }

  private decimate(): void {
    this.ticks = this.ticks.filter((_, i) => i % 2 === 0);
    this.reserveGene = this.reserveGene.filter((_, i) => i % 2 === 0);
    this.prefSpeed = this.prefSpeed.filter((_, i) => i % 2 === 0);
    this.prefReserve = this.prefReserve.filter((_, i) => i % 2 === 0);
  }
}
