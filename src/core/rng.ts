import { TAU } from './math';

/** Детерминированный ГПСЧ (mulberry32) — забег воспроизводим по сиду. */
export class Rng {
  private s: number;

  constructor(seed?: number) {
    this.s = (seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Целое в [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  angle(): number {
    return this.next() * TAU;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}
