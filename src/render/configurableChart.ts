import uPlot from "uplot";
import type { StatsMessage } from "../sim/protocol";
import { DecimatingSeriesBuffer } from "./decimatingBuffer";
import { SERIES_CATALOG, seriesColor, seriesLabel, type PlottableKey } from "./seriesCatalog";

// Shared with the charts manager's history buffer, which is sized to match
// so a freshly configured chart can be backfilled at full available
// resolution instead of starting blank at the current tick.
export const MAX_POINTS = 8000;
const FALLBACK_HEIGHT = 140;

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
  private lastWidth = 360;
  private lastHeight = FALLBACK_HEIGHT;
  private legendObserver: ResizeObserver | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  // `historyColumns`, when given, is the charts manager's shared
  // tick-indexed history (column 0 is tick, column i+1 is
  // SERIES_CATALOG[i]) — passing it backfills this chart from tick 0
  // instead of leaving it blank until the next live stats push.
  setSeries(series: ChartSeriesConfig[], historyColumns?: readonly number[][]): void {
    this.series = series;
    this.buffer = new DecimatingSeriesBuffer(MAX_POINTS, series.length + 1);
    this.rebuildPlot();
    if (this.series.length === 0 || !historyColumns || historyColumns.length === 0) return;

    const columnIndexes = this.series.map((s) => SERIES_CATALOG.findIndex((d) => d.key === s.key) + 1);
    const tickColumn = historyColumns[0];
    for (let i = 0; i < tickColumn.length; i++) {
      this.buffer.push([tickColumn[i], ...columnIndexes.map((col) => historyColumns[col][i])]);
    }
    this.plot?.setData(this.buffer.data() as unknown as uPlot.AlignedData);
  }

  push(stats: StatsMessage): void {
    if (this.series.length === 0 || !this.plot) return;
    const values = [stats.tick, ...this.series.map((s) => stats[s.key] as number)];
    this.buffer.push(values);
    this.plot.setData(this.buffer.data() as unknown as uPlot.AlignedData);
  }

  // The card's row height is fixed by the 3x3 grid layout, and must hold
  // both the canvas and uPlot's own legend below it — so the canvas gets
  // whatever's left after the legend's *actual* rendered height, measured
  // fresh each time, rather than a guessed constant. That keeps charts
  // with more series (taller, possibly wrapped legend) from overflowing
  // their card the way a fixed canvas height did.
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.lastWidth = width;
    this.lastHeight = height;
    this.applySize();
  }

  destroy(): void {
    this.legendObserver?.disconnect();
    this.legendObserver = null;
    this.plot?.destroy();
    this.plot = null;
  }

  private applySize(): void {
    if (!this.plot) return;
    const legendEl = this.host.querySelector<HTMLElement>(".u-legend");
    const legendHeight = legendEl?.offsetHeight ?? 0;
    const canvasHeight = Math.max(40, this.lastHeight - legendHeight);
    this.plot.setSize({ width: this.lastWidth, height: canvasHeight });
  }

  private rebuildPlot(): void {
    this.legendObserver?.disconnect();
    this.legendObserver = null;
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

    this.lastWidth = this.host.clientWidth || this.lastWidth;
    this.lastHeight = this.host.clientHeight || this.lastHeight;

    this.plot = new uPlot(
      {
        width: this.lastWidth,
        height: this.lastHeight,
        padding: [8, 8, 0, 0],
        scales,
        series: seriesOpts,
        axes: axesOpts,
        legend: { show: true },
      },
      [[], ...this.series.map(() => [])] as unknown as uPlot.AlignedData,
      this.host,
    );
    // The legend's height right after construction is a transient layout
    // value (it can measure several times its settled size), so a one-off
    // synchronous measurement here is unreliable. Observing the legend
    // itself re-fits the canvas whenever the legend's real height settles
    // or later changes (e.g. rows wrapping differently). No feedback loop:
    // applySize only changes the canvas height, never the legend's width.
    const legendEl = this.host.querySelector<HTMLElement>(".u-legend");
    if (legendEl) {
      this.legendObserver = new ResizeObserver(() => this.applySize());
      this.legendObserver.observe(legendEl);
    }
    this.applySize();
  }
}
