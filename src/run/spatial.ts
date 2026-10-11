/**
 * Простая spatial hash-сетка для коллизий на плоскости.
 * Пересоздаётся каждый тик симуляции (сотни сущностей — дёшево).
 */
export class SpatialHash<T extends { x: number; y: number }> {
  private map = new Map<number, T[]>();

  constructor(private readonly cell = 2.5) {}

  private key(cx: number, cy: number): number {
    // арена ~±30 клеток — безопасный диапазон после сдвига
    return (cx + 512) * 4096 + (cy + 512);
  }

  clear(): void {
    this.map.clear();
  }

  insert(item: T): void {
    const cx = Math.floor(item.x / this.cell);
    const cy = Math.floor(item.y / this.cell);
    const k = this.key(cx, cy);
    const bucket = this.map.get(k);
    if (bucket) bucket.push(item);
    else this.map.set(k, [item]);
  }

  /** Собирает в out кандидатов из клеток, накрываемых кругом (x,y,r). */
  query(x: number, y: number, r: number, out: T[]): T[] {
    out.length = 0;
    const min = this.cell * 1.5;
    const rr = Math.max(r, min);
    const cx0 = Math.floor((x - rr) / this.cell);
    const cx1 = Math.floor((x + rr) / this.cell);
    const cy0 = Math.floor((y - rr) / this.cell);
    const cy1 = Math.floor((y + rr) / this.cell);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = this.map.get(this.key(cx, cy));
        if (bucket) for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }
}
