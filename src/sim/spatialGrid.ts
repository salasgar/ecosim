// Uniform spatial hash grid for O(1)-ish neighbor queries, rebuilt every
// tick from scratch. Avoids the O(n^2) neighbor search that would otherwise
// dominate cost as population grows. Bucket arrays are reused across
// rebuilds to keep this allocation-free in steady state.
export class SpatialGrid {
  private readonly cellSize: number;
  private readonly cols: number;
  private readonly rows: number;
  private buckets: number[][];

  constructor(worldWidth: number, worldHeight: number, cellSize: number) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(worldWidth / cellSize));
    this.rows = Math.max(1, Math.ceil(worldHeight / cellSize));
    this.buckets = new Array(this.cols * this.rows);
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i] = [];
  }

  clear(): void {
    for (const bucket of this.buckets) bucket.length = 0;
  }

  private cellIndex(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize)));
    return cy * this.cols + cx;
  }

  insert(entityIndex: number, x: number, y: number): void {
    this.buckets[this.cellIndex(x, y)].push(entityIndex);
  }

  // Calls `visit` for every entity whose cell overlaps the square of the
  // given radius around (x, y). Callers must still check exact distance.
  forEachNear(x: number, y: number, radius: number, visit: (entityIndex: number) => void): void {
    const minCx = Math.max(0, Math.floor((x - radius) / this.cellSize));
    const maxCx = Math.min(this.cols - 1, Math.floor((x + radius) / this.cellSize));
    const minCy = Math.max(0, Math.floor((y - radius) / this.cellSize));
    const maxCy = Math.min(this.rows - 1, Math.floor((y + radius) / this.cellSize));

    for (let cy = minCy; cy <= maxCy; cy++) {
      const rowOffset = cy * this.cols;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const bucket = this.buckets[rowOffset + cx];
        for (let i = 0; i < bucket.length; i++) visit(bucket[i]);
      }
    }
  }
}
