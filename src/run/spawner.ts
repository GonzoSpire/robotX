import { Rng } from '../core/rng';
import type { EnemyId } from '../content/enemies';

/** Интервал между волнами: 1.6с на старте → 0.35с к ~5-й минуте. */
export function spawnInterval(timeSec: number): number {
  return Math.max(0.35, 1.6 - timeSec * 0.004);
}

/** Размер волны: 2 → 7 со временем. */
export function batchSize(timeSec: number): number {
  return Math.min(7, 2 + Math.floor(timeSec / 75));
}

/** Состав волн по времени: спринтеры после 60с, големы после 120с. */
export function waveWeights(timeSec: number): Array<[EnemyId, number]> {
  const w: Array<[EnemyId, number]> = [['chaser', 10]];
  if (timeSec > 60) w.push(['sprinter', 6]);
  if (timeSec > 120) w.push(['tank', 2.5]);
  return w;
}

export interface SpawnRequest {
  id: EnemyId;
  x: number;
  y: number;
}

export class Spawner {
  private nextAt = 0.6;
  private lastSurge = -45;

  constructor(
    private readonly rng: Rng,
    private readonly cap = 140,
  ) {}

  /**
   * Возвращает запросы на спавн за этот тик. Позиции — кольцо вокруг игрока,
   * подрезанное границами арены.
   */
  update(dt: number, timeSec: number, enemyCount: number, px: number, py: number, halfW: number, halfH: number): SpawnRequest[] {
    this.nextAt -= dt;
    const out: SpawnRequest[] = [];
    if (this.nextAt > 0) return out;

    const interval = spawnInterval(timeSec);
    this.nextAt = interval;

    const budget = enemyCount >= this.cap ? 0 : Math.min(this.cap - enemyCount, batchSize(timeSec));
    for (let i = 0; i < budget; i++) {
      const id = this.pickId(timeSec);
      const p = this.ringPos(px, py, halfW, halfH);
      out.push({ id, x: p.x, y: p.y });
    }

    // «Волна-скачок» каждые 45 секунд
    if (timeSec - this.lastSurge >= 45) {
      this.lastSurge = timeSec;
      const surge = Math.min(this.cap - enemyCount - budget, 10 + Math.floor(timeSec / 60) * 2);
      for (let i = 0; i < surge; i++) {
        const id = this.pickId(timeSec);
        const a = this.rng.angle();
        const r = this.rng.range(15, 19);
        out.push({ id, x: clamp(px + Math.cos(a) * r, -halfW + 1, halfW - 1), y: clamp(py + Math.sin(a) * r, -halfH + 1, halfH - 1) });
      }
    }
    return out;
  }

  private pickId(timeSec: number): EnemyId {
    const weights = waveWeights(timeSec);
    let total = 0;
    for (const [, w] of weights) total += w;
    let roll = this.rng.next() * total;
    for (const [id, w] of weights) {
      roll -= w;
      if (roll <= 0) return id;
    }
    return weights[weights.length - 1][0];
  }

  private ringPos(px: number, py: number, halfW: number, halfH: number): { x: number; y: number } {
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = this.rng.angle();
      const r = this.rng.range(14, 20);
      const x = clamp(px + Math.cos(a) * r, -halfW + 1, halfW - 1);
      const y = clamp(py + Math.sin(a) * r, -halfH + 1, halfH - 1);
      const dx = x - px;
      const dy = y - py;
      if (dx * dx + dy * dy > 11 * 11) return { x, y };
    }
    return { x: clamp(px + 16, -halfW + 1, halfW - 1), y: clamp(py + 16, -halfH + 1, halfH - 1) };
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
