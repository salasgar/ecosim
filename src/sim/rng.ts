// Mulberry32: small, fast, seedable PRNG. Deterministic runs are required
// for reproducible experiments (same seed -> same evolutionary trajectory).
export class Rng {
  private state: number;
  private cachedGaussian: number | null = null;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  // Box-Muller, one value cached per pair generated.
  gaussian(mean = 0, stdDev = 1): number {
    if (this.cachedGaussian !== null) {
      const v = this.cachedGaussian;
      this.cachedGaussian = null;
      return mean + v * stdDev;
    }
    let u1 = 0;
    let u2 = 0;
    while (u1 === 0) u1 = this.next();
    u2 = this.next();
    const mag = Math.sqrt(-2 * Math.log(u1));
    const z0 = mag * Math.cos(2 * Math.PI * u2);
    const z1 = mag * Math.sin(2 * Math.PI * u2);
    this.cachedGaussian = z1;
    return mean + z0 * stdDev;
  }
}
