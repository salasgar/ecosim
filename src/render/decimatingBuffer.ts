// Keeps parallel numeric series bounded to maxPoints using power-of-two
// stride decimation, shared by all live charts.
//
// The naive approach — buffer every incoming point and, whenever the array
// overflows, filter it down to every 2nd element — looks uniform at each
// individual step but isn't: new points keep arriving at full density
// between overflow events, so only the *oldest* stretch of the buffer ever
// gets thinned again next time, while whatever was pushed most recently
// stays at full resolution. Repeated over a long run this produces a
// lopsided staircase (ancient history crushed to a handful of points,
// recent history always sharp) instead of an even loss of detail.
//
// This buffer instead tracks a single active `stride` and only ever admits
// an incoming point when it aligns with that stride, so at any moment the
// entire stored history — start to end — is spaced evenly. The stride only
// doubles (and the existing buffer is thinned to match) when it's actually
// needed to stay under maxPoints.
export class DecimatingSeriesBuffer {
  private readonly maxPoints: number;
  private stride = 1;
  private sampleCounter = 0;
  private readonly series: number[][];

  constructor(maxPoints: number, seriesCount: number) {
    this.maxPoints = maxPoints;
    this.series = Array.from({ length: seriesCount }, () => []);
  }

  push(values: readonly number[]): void {
    this.sampleCounter++;
    if (this.sampleCounter % this.stride !== 0) return;

    for (let s = 0; s < this.series.length; s++) this.series[s].push(values[s]);

    if (this.series[0].length > this.maxPoints) {
      // Invariant: stored element j (0-indexed) was admitted at
      // sampleCounter == stride * (j + 1). Doubling the stride keeps only
      // elements whose sampleCounter is divisible by the new stride, i.e.
      // where (j + 1) is even — odd 0-indexed positions. Keeping the *even*
      // positions instead (the obvious-looking choice) would silently shift
      // phase and reintroduce a one-sample seam right at the doubling point.
      this.stride *= 2;
      for (let s = 0; s < this.series.length; s++) {
        this.series[s] = this.series[s].filter((_, i) => i % 2 === 1);
      }
    }
  }

  data(): number[][] {
    return this.series;
  }
}
