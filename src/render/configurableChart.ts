import uPlot from "uplot";
import type { StatsMessage } from "../sim/protocol";
import { DecimatingSeriesBuffer } from "./decimatingBuffer";
import { seriesColor, seriesLabel, type PlottableKey } from "./seriesCatalog";

const MAX_POINTS = 8000;
const CHART_HEIGHT = 140;

export type AxisSide = "left" | "right";

export interface ChartSeriesConfig {
  key: PlottableKey;
  axis: AxisSide;
}

// A time series chart whose plotted fields are fully driven by `series`,
// set from the charts manager panel rather than fixed at build time.
// Changing the series list rebuilds the underlying uPlot instance and
// resets the buffered history, since the old columns no longer line up
// with the new selection.
export class ConfigurableChart {
  private readonly host: HTMLElement;
  private plot: uPlot | null = null;
  private buffer = new DecimatingSeriesBuffer(MAX_POINTS, 1);
  private series: ChartSeriesConfig[] = [];

  constructor(host: HTMLElement) {
    this.host = host;
  }

  setSeries(series: ChartSeriesConfig[]): void {
    this.series = series;
    this.buffer = new DecimatingSeriesBuffer(MAX_POINTS, series.length + 1);
    this.rebuildPlot();
  }

  push(stats: StatsMessage): void {
    if (this.series.length === 0 || !this.plot) return;
    const values = [stats.tick, ...this.series.map((s) => stats[s.key] as number)];
    this.buffer.push(values);
    this.plot.setData(this.buffer.data() as unknown as uPlot.AlignedData);
  }

  // Height stays fixed (the card's height is driven by its content — the
  // canvas plus uPlot's own legend, which can wrap to more than one line
  // depending on how many series are selected) — only width tracks the
  // host's flex-layout size.
  resize(width: number): void {
    if (width <= 0) return;
    this.plot?.setSize({ width, height: CHART_HEIGHT });
  }

  destroy(): void {
    this.plot?.destroy();
    this.plot = null;
  }

  private rebuildPlot(): void {
    this.plot?.destroy();
    this.plot = null;
    this.host.replaceChildren();
    if (this.series.length === 0) return;

    const usesLeft = this.series.some((s) => s.axis === "left");
    const usesRight = this.series.some((s) => s.axis === "right");

    const scales: uPlot.Scales = { x: { time: false } };
    if (usesLeft) scales.left = {};
    if (usesRight) scales.right = {};

    const seriesOpts: uPlot.Series[] = [{}];
    for (const s of this.series) {
      seriesOpts.push({ label: seriesLabel(s.key), stroke: seriesColor(s.key), scale: s.axis, width: 2 });
    }

    const axesOpts: uPlot.Axis[] = [{ stroke: "#9ca3af", grid: { stroke: "#2e303a" } }];
    if (usesLeft) axesOpts.push({ scale: "left", stroke: "#9ca3af", grid: { stroke: "#2e303a" }, side: 3 });
    if (usesRight) axesOpts.push({ scale: "right", stroke: "#9ca3af", grid: { show: false }, side: 1 });

    const width = this.host.clientWidth || 360;

    this.plot = new uPlot(
      {
        width,
        height: CHART_HEIGHT,
        padding: [8, 8, 0, 0],
        scales,
        series: seriesOpts,
        axes: axesOpts,
        legend: { show: true },
      },
      [[], ...this.series.map(() => [])] as unknown as uPlot.AlignedData,
      this.host,
    );
  }
}
