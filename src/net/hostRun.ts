import { rollCards, applyCard, type Card } from '../run/cards';
import { RunSim, type GameEvent, type InputSnapshot, type Player } from '../run/sim';
import { Rng } from '../core/rng';
import type { HostCtx, StartPayload } from './session';
import {
  asArrayBuffer,
  decodeInput,
  encodeSnapshot,
  isClientMsg,
  sameCard,
  type HostMsg,
  type PlayerResult,
} from './protocol';

const IDLE: InputSnapshot = { moveX: 0, moveY: 0, dash: false, shield: false };
const SNAPSHOT_INTERVAL = 1 / 20;

export interface HostRunHooks {
  /** Хосту самому предложили карточки (свой робот). */
  onCardOffer: (cards: Card[]) => void;
  /** Забег завершён: результаты всех игроков. */
  onEnd: (results: PlayerResult[]) => void;
}

/**
 * Сетевой забег хоста: авторитетная симуляция. main гоняет fixedTick/frame,
 * контроллер рассылает снапшоты 20 Гц, раздаёт карточки и завершает забег.
 */
export class HostRun {
  readonly sim: RunSim;
  private readonly rng = new Rng();
  private inputs = new Map<number, InputSnapshot>();
  private netEvents: GameEvent[] = [];
  private offers = new Map<number, Card[]>();
  private snapshotAcc = 0;
  private tickCount = 0;
  private ended = false;

  constructor(
    private readonly ctx: HostCtx,
    payload: StartPayload,
    private readonly hooks: HostRunHooks,
  ) {
    this.sim = new RunSim(
      payload.roster.map((e) => ({ id: e.pid, name: e.name, colorIdx: e.colorIdx, start: e.start })),
      payload.seed,
    );
    this.ctx.use(this);
  }

  /** Фиксированный тик: свой ввод + последний ввод каждого клиента. */
  fixedTick(dt: number, own: InputSnapshot): void {
    if (this.sim.state !== 'running') return;
    this.inputs.set(0, own);
    const inputs = this.sim.players.map((p) => this.inputs.get(p.id) ?? IDLE);
    this.sim.tick(dt, inputs);
    this.tickCount++;
  }

  /** Кадр рендера: события для локального рендера + рассылка снапшотов. */
  frame(dt: number): GameEvent[] {
    const events = this.sim.drainEvents();
    this.netEvents.push(...events);
    if (this.sim.state === 'running') {
      this.snapshotAcc += dt;
      if (this.snapshotAcc >= SNAPSHOT_INTERVAL) {
        this.snapshotAcc = 0;
        this.flushSnapshot();
      }
      this.pumpLevelUps();
    } else if (!this.ended) {
      this.finish();
    }
    return events;
  }

  /** Выбор карточки (свой робот или валидированный выбор клиента). */
  pickCard(pid: number, card: Card): void {
    const p = this.sim.playerById(pid);
    const offered = this.offers.get(pid);
    if (!p || !offered || !offered.some((c) => sameCard(c, card))) return;
    applyCard(this.sim, card, p);
    p.pendingLevelUps = Math.max(0, p.pendingLevelUps - 1);
    this.offers.delete(pid);
    this.pumpLevelUps();
  }

  onMessage(pid: number, data: unknown): void {
    if (this.ended) return;
    const buf = asArrayBuffer(data);
    if (buf) {
      const inp = decodeInput(buf);
      if (inp) this.inputs.set(pid, { moveX: inp.moveX, moveY: inp.moveY, dash: inp.dash, shield: inp.shield });
      return;
    }
    if (isClientMsg(data) && data.t === 'cardPick') this.pickCard(pid, data.card);
  }

  onJoin(pid: number): void {
    // в идущий забег подсоединиться нельзя
    this.ctx.net.send(pid, { t: 'roomFull' } as unknown as HostMsg);
    window.setTimeout(() => this.ctx.net.kick(pid), 400);
  }

  onLeave(pid: number): void {
    this.inputs.delete(pid);
    this.offers.delete(pid);
    this.sim.removePlayer(pid);
    if (this.sim.state !== 'running') this.finish();
  }

  private pumpLevelUps(): void {
    for (const p of this.sim.players) {
      if (p.dead || p.pendingLevelUps <= 0 || this.offers.has(p.id)) continue;
      const cards = rollCards(this.rng, this.sim, p);
      if (cards.length === 0) {
        // пул исчерпан — утешительное лечение
        p.hp = Math.min(p.maxHp, p.hp + 25);
        p.pendingLevelUps--;
        continue;
      }
      this.offers.set(p.id, cards);
      if (p.id === 0) this.hooks.onCardOffer(cards);
      else this.ctx.net.send(p.id, { t: 'cardOffer', pid: p.id, cards } satisfies HostMsg);
    }
  }

  private flushSnapshot(): void {
    const buf = encodeSnapshot(this.sim, this.tickCount);
    this.ctx.net.broadcast(buf);
    if (this.netEvents.length > 0) {
      const list = this.netEvents;
      this.netEvents = [];
      this.ctx.net.broadcast({ t: 'events', tick: this.tickCount, list } satisfies HostMsg);
    }
  }

  private finish(): void {
    this.ended = true;
    this.flushSnapshot();
    const won = this.sim.state === 'won';
    const results: PlayerResult[] = this.sim.players.map((p) => ({
      pid: p.id,
      name: p.name,
      won,
      timeSec: this.sim.time,
      level: this.sim.level,
      kills: this.sim.kills,
      scrap: p.scrapCollected,
      blueprints: p.foundBlueprints,
    }));
    this.ctx.net.broadcast({ t: 'end', results } satisfies HostMsg);
    this.hooks.onEnd(results);
  }

  playerByPid(pid: number): Player | undefined {
    return this.sim.playerById(pid);
  }

  destroy(): void {
    this.ctx.use({});
  }
}
