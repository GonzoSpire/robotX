import { Rng } from '../core/rng';
import { clamp, normalize, angleDelta } from '../core/math';
import { ENEMIES, type EnemyDef, type EnemyId } from '../content/enemies';
import { WEAPONS, type WeaponId, type WeaponStats } from '../content/weapons';
import type { PassiveId } from '../content/passives';
import type { ModuleStats } from '../meta/parts';
import { Spawner } from './spawner';
import { SpatialHash } from './spatial';
import { enemyHpMult, xpToNext } from './progression';

/** Стартовые параметры игрока — результат сборки в ангаре + прокачка пилота. */
export interface RunStartConfig {
  maxHp: number;
  speed: number;
  pickup: number;
  weaponSlots: number;
  weapons: Array<{ id: WeaponId; level: number }>;
  /** Фиксированные бонусы модулей/реактора/сетов/пилота (готовые прибавки). */
  fixed: ModuleStats;
  /** Пул id деталей, из которого падают чертежи. */
  blueprintPool: string[];
  /** Начать забег с N выборами карточек (бонус пилота). */
  startLevelBonus: number;
}

export function defaultStart(): RunStartConfig {
  return {
    maxHp: 100,
    speed: 6,
    pickup: 1.6,
    weaponSlots: 4,
    weapons: [{ id: 'autogun', level: 1 }],
    fixed: {},
    blueprintPool: [],
    startLevelBonus: 0,
  };
}

export interface InputSnapshot {
  moveX: number;
  moveY: number;
  dash: boolean;
  shield: boolean;
}

/** Один участник забега (соло или сетевой кооп). */
export interface PlayerEntry {
  id: number;
  name: string;
  colorIdx: number;
  start?: Partial<RunStartConfig>;
}

export interface Player {
  id: number;
  name: string;
  colorIdx: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  baseSpeed: number;
  radius: number;
  basePickup: number;
  facingX: number;
  facingY: number;
  moving: boolean;
  iframe: number;
  dashCd: number;
  dashT: number;
  shieldCd: number;
  shieldT: number;
  dead: boolean;
  /** Сборка и прогресс этого игрока. */
  weapons: WeaponRuntime[];
  passiveStacks: Partial<Record<PassiveId, number>>;
  fixed: ModuleStats;
  weaponSlots: number;
  blueprintPool: string[];
  scrapCollected: number;
  foundBlueprints: string[];
  pendingLevelUps: number;
}

export interface WeaponRuntime {
  id: WeaponId;
  level: number;
  cd: number;
  /** Угол орбиты [дронов]. */
  angle: number;
  /** Мировые позиции дронов для рендера. */
  drones: Array<{ x: number; y: number }>;
}

export interface Enemy {
  uid: number;
  def: EnemyDef;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attackCd: number;
  droneCd: number;
  spawnT: number;
  flashT: number;
  state: 'seek' | 'windup' | 'dash' | 'recover';
  stateT: number;
  dashX: number;
  dashY: number;
  bossShotCd: number;
  dead: boolean;
}

export interface Projectile {
  uid: number;
  kind: 'bullet' | 'missile';
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  life: number;
  pierce: number;
  hits: Set<number>;
  splash: number;
  dead: boolean;
}

export interface EnemyBolt {
  uid: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  dead: boolean;
}

export interface Mine {
  uid: number;
  owner: number;
  x: number;
  y: number;
  armT: number;
  damage: number;
  splash: number;
  trigger: number;
  dead: boolean;
}

export interface Shockwave {
  uid: number;
  owner: number;
  x: number;
  y: number;
  r: number;
  maxR: number;
  speed: number;
  damage: number;
  hit: Set<number>;
  dead: boolean;
}

export interface Gem {
  uid: number;
  x: number;
  y: number;
  value: number;
  kind: 'xp' | 'scrap' | 'blueprint';
  vx: number;
  vy: number;
  magnet: boolean;
  /** pid игрока, к которому примагнитился кристалл. */
  magnetTo: number;
  magnetV: number;
  dead: boolean;
}

export type GameEvent =
  | { t: 'hit'; x: number; y: number; dmg: number; crit: boolean }
  | { t: 'kill'; x: number; y: number; enemy: EnemyId }
  | { t: 'shoot'; x: number; y: number; dx: number; dy: number }
  | { t: 'beam'; x1: number; y1: number; x2: number; y2: number; w: number }
  | { t: 'flame'; x: number; y: number; dx: number; dy: number; range: number }
  | { t: 'nova'; x: number; y: number; r: number }
  | { t: 'boom'; x: number; y: number; r: number }
  | { t: 'mine'; x: number; y: number }
  | { t: 'gem'; x: number; y: number; kind: 'xp' | 'scrap' }
  | { t: 'scrap'; amount: number; pid: number; x: number; y: number }
  | { t: 'blueprint'; x: number; y: number; partId: string; pid: number }
  | { t: 'damaged'; amount: number; hp: number; pid: number; x: number; y: number }
  | { t: 'blocked'; x: number; y: number; pid: number }
  | { t: 'shield'; x: number; y: number; pid: number }
  | { t: 'levelup'; level: number; pid: number; x: number; y: number }
  | { t: 'bossWarn' }
  | { t: 'bossSpawn'; x: number; y: number }
  | { t: 'died'; timeSec: number; pid: number; x: number; y: number }
  | { t: 'won'; timeSec: number };

export interface AggregatedStats {
  speed: number;
  damageMult: number;
  attackSpeedMult: number;
  areaMult: number;
  pickupRadius: number;
  critChance: number;
  xpMult: number;
}

export const DASH_CD = 4;
export const SHIELD_CD = 12;
export const SHIELD_DURATION = 3;

/** Агрегированные статы игрока из пассивок + фиксированных бонусов сборки. */
export function computeStats(
  base: { baseSpeed: number; basePickup: number },
  stacks: Partial<Record<PassiveId, number>>,
  fixed: ModuleStats,
): AggregatedStats {
  const g = (id: PassiveId): number => stacks[id] ?? 0;
  return {
    speed: base.baseSpeed * (1 + 0.07 * g('moveSpeed')) * (1 + (fixed.moveSpeedPct ?? 0)),
    damageMult: (1 + 0.12 * g('damage')) * (1 + (fixed.damagePct ?? 0)),
    attackSpeedMult: (1 + 0.1 * g('attackSpeed')) * (1 + (fixed.attackSpeedPct ?? 0)),
    areaMult: (1 + 0.12 * g('area')) * (1 + (fixed.areaPct ?? 0)),
    pickupRadius: base.basePickup * (1 + 0.28 * g('pickup')) * (1 + (fixed.pickupPct ?? 0)),
    critChance: 0.03 + 0.06 * g('crit') + (fixed.critChance ?? 0),
    xpMult: (1 + 0.12 * g('xpGain')) * (1 + (fixed.xpPct ?? 0)),
  };
}

export class RunSim {
  readonly halfW = 28;
  readonly halfH = 18;
  time = 0;
  state: 'running' | 'dead' | 'won' = 'running';
  kills = 0;
  events: GameEvent[] = [];
  /** Общий уровень команды (в соло — уровень игрока). */
  level = 1;
  xp = 0;
  readonly players: Player[];

  boss: Enemy | null = null;
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  bolts: EnemyBolt[] = [];
  mines: Mine[] = [];
  shockwaves: Shockwave[] = [];
  gems: Gem[] = [];

  private readonly starts: RunStartConfig[];
  private readonly rng: Rng;
  private readonly spawner: Spawner;
  private readonly hash = new SpatialHash<Enemy>(2.5);
  private readonly scratch: Enemy[] = [];
  private uid = 1;
  private bossSpawned = false;
  bossWarned = false;
  /** Отладка: отключить спавн мобов (сетевые тесты). */
  noSpawns = false;

  /** Соло-совместимость: первый игрок, его оружие и пассивки. */
  get player(): Player {
    return this.players[0];
  }
  get weapons(): WeaponRuntime[] {
    return this.players[0].weapons;
  }
  get passiveStacks(): Partial<Record<PassiveId, number>> {
    return this.players[0].passiveStacks;
  }
  get scrapCollected(): number {
    return this.players.reduce((s, p) => s + p.scrapCollected, 0);
  }
  get foundBlueprints(): string[] {
    return this.players.flatMap((p) => p.foundBlueprints);
  }

  constructor(entries?: Partial<RunStartConfig> | PlayerEntry[], seed?: number) {
    this.rng = new Rng(seed);
    this.spawner = new Spawner(this.rng);
    const list: PlayerEntry[] = Array.isArray(entries)
      ? entries
      : [{ id: 0, name: 'Пилот', colorIdx: 0, start: entries }];
    this.starts = list.map((e) => ({ ...defaultStart(), ...e.start }));
    this.players = list.map((e, i) => this.makePlayer(e, this.starts[i]));
  }

  private makePlayer(entry: PlayerEntry, start: RunStartConfig): Player {
    const p: Player = {
      id: entry.id,
      name: entry.name,
      colorIdx: entry.colorIdx,
      x: 0,
      y: 0,
      hp: start.maxHp,
      maxHp: start.maxHp,
      baseSpeed: start.speed,
      radius: 0.6,
      basePickup: start.pickup,
      facingX: 0,
      facingY: 1,
      moving: false,
      iframe: 0,
      dashCd: 0,
      dashT: 0,
      shieldCd: 0,
      shieldT: 0,
      dead: false,
      weapons: [],
      passiveStacks: {},
      fixed: start.fixed,
      weaponSlots: start.weaponSlots,
      blueprintPool: start.blueprintPool,
      scrapCollected: 0,
      foundBlueprints: [],
      pendingLevelUps: start.startLevelBonus,
    };
    for (const w of start.weapons) {
      if (p.weapons.some((x) => x.id === w.id)) continue;
      p.weapons.push({ id: w.id, level: clamp(w.level, 1, WEAPONS[w.id]?.maxLevel ?? 8), cd: 0.3, angle: this.rng.angle(), drones: [] });
    }
    return p;
  }

  // ---------- публичный API для main/рендера/тестов ----------

  stats(): AggregatedStats {
    return this.statsFor(this.player);
  }

  statsFor(p: Player): AggregatedStats {
    return computeStats({ baseSpeed: p.baseSpeed, basePickup: p.basePickup }, p.passiveStacks, p.fixed);
  }

  playerById(id: number): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  alivePlayers(): Player[] {
    return this.players.filter((p) => !p.dead);
  }

  addWeapon(id: WeaponId, p: Player = this.player): void {
    if (p.weapons.some((w) => w.id === id)) return;
    p.weapons.push({ id, level: 1, cd: 0.3, angle: this.rng.angle(), drones: [] });
  }

  addPassiveStack(id: PassiveId, p: Player = this.player): void {
    p.passiveStacks[id] = (p.passiveStacks[id] ?? 0) + 1;
    if (id === 'maxHp') {
      p.maxHp += 18;
      p.hp = Math.min(p.maxHp, p.hp + 18);
    }
  }

  /** Отключение игрока в сетевом забеге: бот погибает, забег продолжается. */
  removePlayer(id: number): void {
    const p = this.playerById(id);
    if (!p || p.dead) return;
    this.killPlayer(p);
  }

  spawnEnemy(id: EnemyId, x: number, y: number): Enemy {
    const def = ENEMIES[id];
    const hp = Math.round(def.hp * enemyHpMult(this.time));
    const e: Enemy = {
      uid: this.uid++,
      def,
      x,
      y,
      hp,
      maxHp: hp,
      attackCd: 0.5,
      droneCd: 0,
      spawnT: 0.35,
      flashT: 0,
      state: 'seek',
      stateT: 0,
      dashX: 0,
      dashY: 0,
      bossShotCd: 3.5,
      dead: false,
    };
    this.enemies.push(e);
    if (id === 'boss') {
      this.boss = e;
      this.events.push({ t: 'bossSpawn', x, y });
    }
    return e;
  }

  drainEvents(): GameEvent[] {
    if (this.events.length === 0) return [];
    return this.events.splice(0, this.events.length);
  }

  nearestEnemy(x: number, y: number, maxDist: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD2 = maxDist * maxDist;
    for (const e of this.enemies) {
      if (e.dead || e.spawnT > 0.2) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }

  nearestAlivePlayer(x: number, y: number): Player | null {
    let best: Player | null = null;
    let bestD2 = Infinity;
    for (const p of this.players) {
      if (p.dead) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = p;
      }
    }
    return best;
  }

  // ---------- главный тик ----------

  tick(dt: number, input: InputSnapshot | InputSnapshot[]): void {
    if (this.state !== 'running') return;
    this.time += dt;
    const inputs = Array.isArray(input) ? input : [input];

    this.updatePlayers(dt, inputs);
    this.rebuildHash();
    this.updateWeapons(dt);
    this.updateProjectiles(dt);
    this.updateBolts(dt);
    this.updateMines(dt);
    this.updateShockwaves(dt);
    this.updateEnemies(dt);
    this.updateSpawner(dt);
    this.updateGems(dt);
    this.updateBossTimeline();
    this.compact();
  }

  // ---------- игроки ----------

  private updatePlayers(dt: number, inputs: InputSnapshot[]): void {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.dead) continue;
      this.updatePlayer(p, dt, inputs[i] ?? { moveX: 0, moveY: 0, dash: false, shield: false });
    }
  }

  private updatePlayer(p: Player, dt: number, input: InputSnapshot): void {
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.shieldCd = Math.max(0, p.shieldCd - dt);
    p.dashT = Math.max(0, p.dashT - dt);
    p.shieldT = Math.max(0, p.shieldT - dt);
    p.iframe = Math.max(0, p.iframe - dt);

    if (input.dash && p.dashCd <= 0) {
      p.dashCd = DASH_CD;
      p.dashT = 0.2;
      p.iframe = Math.max(p.iframe, 0.32);
    }
    if (input.shield && p.shieldCd <= 0) {
      p.shieldCd = SHIELD_CD;
      p.shieldT = SHIELD_DURATION;
      this.events.push({ t: 'shield', x: p.x, y: p.y, pid: p.id });
    }

    const dir = normalize(input.moveX, input.moveY);
    p.moving = dir.x !== 0 || dir.y !== 0;
    if (p.moving) {
      p.facingX = dir.x;
      p.facingY = dir.y;
    }
    const speed = this.statsFor(p).speed * (p.dashT > 0 ? 3.8 : 1);
    p.x = clamp(p.x + dir.x * speed * dt, -this.halfW + 0.9, this.halfW - 0.9);
    p.y = clamp(p.y + dir.y * speed * dt, -this.halfH + 0.9, this.halfH - 0.9);
  }

  damagePlayer(p: Player, amount: number): void {
    if (this.state !== 'running' || p.dead) return;
    if (p.shieldT > 0) {
      this.events.push({ t: 'blocked', x: p.x, y: p.y, pid: p.id });
      return;
    }
    if (p.iframe > 0 || p.dashT > 0) return;
    p.hp -= amount;
    p.iframe = 0.5;
    this.events.push({ t: 'damaged', amount, hp: Math.max(0, p.hp), pid: p.id, x: p.x, y: p.y });
    if (p.hp <= 0) this.killPlayer(p);
  }

  private killPlayer(p: Player): void {
    if (p.dead) return;
    p.dead = true;
    p.hp = 0;
    p.weapons.forEach((w) => (w.drones.length = 0));
    this.events.push({ t: 'died', timeSec: this.time, pid: p.id, x: p.x, y: p.y });
    if (this.players.every((x) => x.dead)) {
      this.state = 'dead';
    }
  }

  // ---------- оружие ----------

  private rebuildHash(): void {
    this.hash.clear();
    for (const e of this.enemies) if (!e.dead) this.hash.insert(e);
  }

  private updateWeapons(dt: number): void {
    for (const p of this.players) {
      if (p.dead) continue;
      const st = this.statsFor(p);
      for (const w of p.weapons) {
        const s = WEAPONS[w.id].stats(w.level);
        if (w.id === 'drones') {
          this.updateDrones(p, w, s, st, dt);
          continue;
        }
        w.cd -= dt;
        if (w.cd > 0) continue;
        this.fireWeapon(p, w, s, st);
      }
    }
  }

  private fireWeapon(p: Player, w: WeaponRuntime, s: WeaponStats, st: AggregatedStats): void {
    switch (w.id) {
      case 'autogun': {
        const target = this.nearestEnemy(p.x, p.y, s.range);
        if (!target) {
          w.cd = 0.12;
          return;
        }
        w.cd = s.cooldown / st.attackSpeedMult;
        const base = Math.atan2(target.y - p.y, target.x - p.x);
        for (let i = 0; i < s.count; i++) {
          const a = base + (i - (s.count - 1) / 2) * 0.12;
          this.projectiles.push({
            uid: this.uid++,
            kind: 'bullet',
            owner: p.id,
            x: p.x,
            y: p.y,
            vx: Math.cos(a) * s.speed,
            vy: Math.sin(a) * s.speed,
            damage: s.damage,
            radius: 0.2,
            life: s.range / s.speed + 0.3,
            pierce: s.pierce,
            hits: new Set(),
            splash: 0,
            dead: false,
          });
        }
        this.events.push({ t: 'shoot', x: p.x, y: p.y, dx: Math.cos(base), dy: Math.sin(base) });
        return;
      }
      case 'laser': {
        const target = this.nearestEnemy(p.x, p.y, s.range * 1.3);
        const dir = target ? normalize(target.x - p.x, target.y - p.y) : { x: p.facingX, y: p.facingY };
        w.cd = s.cooldown / st.attackSpeedMult;
        const range = s.range * st.areaMult;
        const halfW = (s.area * st.areaMult) / 2;
        const x2 = p.x + dir.x * range;
        const y2 = p.y + dir.y * range;
        for (const e of this.enemies) {
          if (e.dead || e.spawnT > 0.2) continue;
          const vx = e.x - p.x;
          const vy = e.y - p.y;
          const t = vx * dir.x + vy * dir.y;
          if (t < -e.def.radius || t > range + e.def.radius) continue;
          const perp = Math.abs(vx * dir.y - vy * dir.x);
          if (perp <= halfW + e.def.radius * 0.7) this.damageEnemy(e, s.damage, st);
        }
        this.events.push({ t: 'beam', x1: p.x, y1: p.y, x2, y2, w: s.area * st.areaMult });
        return;
      }
      case 'missiles': {
        w.cd = s.cooldown / st.attackSpeedMult;
        const alive = this.enemies.filter((e) => !e.dead && e.spawnT <= 0.2);
        if (alive.length === 0) return;
        alive.sort((a, b) => this.d2To(a, p.x, p.y) - this.d2To(b, p.x, p.y));
        for (let i = 0; i < s.count; i++) {
          const off = this.rng.angle();
          this.projectiles.push({
            uid: this.uid++,
            kind: 'missile',
            owner: p.id,
            x: p.x,
            y: p.y,
            vx: Math.cos(off) * 4,
            vy: Math.sin(off) * 4,
            damage: s.damage,
            radius: 0.3,
            life: 3.2,
            pierce: 0,
            hits: new Set(),
            splash: s.area * st.areaMult,
            dead: false,
          });
        }
        return;
      }
      case 'shockwave': {
        w.cd = s.cooldown / st.attackSpeedMult;
        this.shockwaves.push({
          uid: this.uid++,
          owner: p.id,
          x: p.x,
          y: p.y,
          r: 0.3,
          maxR: s.range * st.areaMult,
          speed: s.speed,
          damage: s.damage,
          hit: new Set(),
          dead: false,
        });
        this.events.push({ t: 'nova', x: p.x, y: p.y, r: s.range * st.areaMult });
        return;
      }
      case 'flame': {
        w.cd = s.cooldown / st.attackSpeedMult;
        const range = s.range * st.areaMult;
        const dir = { x: p.facingX, y: p.facingY };
        for (const e of this.enemies) {
          if (e.dead || e.spawnT > 0.2) continue;
          const vx = e.x - p.x;
          const vy = e.y - p.y;
          const d = Math.hypot(vx, vy);
          if (d > range + e.def.radius) continue;
          const ang = Math.abs(angleDelta(Math.atan2(dir.y, dir.x), Math.atan2(vy, vx)));
          if (ang < s.area + Math.atan2(e.def.radius, Math.max(d, 0.4))) {
            this.damageEnemy(e, s.damage, st);
          }
        }
        this.events.push({ t: 'flame', x: p.x, y: p.y, dx: dir.x, dy: dir.y, range });
        return;
      }
      case 'mines': {
        w.cd = s.cooldown / st.attackSpeedMult;
        for (let i = 0; i < s.count; i++) {
          const ox = this.rng.range(-0.8, 0.8);
          const oy = this.rng.range(-0.8, 0.8);
          this.mines.push({
            uid: this.uid++,
            owner: p.id,
            x: clamp(p.x + ox, -this.halfW + 0.5, this.halfW - 0.5),
            y: clamp(p.y + oy, -this.halfH + 0.5, this.halfH - 0.5),
            armT: 0.5,
            damage: s.damage,
            splash: s.area * st.areaMult,
            trigger: s.range,
            dead: false,
          });
        }
        this.events.push({ t: 'mine', x: p.x, y: p.y });
        return;
      }
    }
  }

  private updateDrones(p: Player, w: WeaponRuntime, s: WeaponStats, st: AggregatedStats, dt: number): void {
    w.angle += s.speed * dt;
    w.drones.length = 0;
    for (let i = 0; i < s.count; i++) {
      const a = w.angle + (i * Math.PI * 2) / s.count;
      const dx = p.x + Math.cos(a) * s.range;
      const dy = p.y + Math.sin(a) * s.range;
      w.drones.push({ x: dx, y: dy });
      const cand = this.hash.query(dx, dy, s.area + 1.2, this.scratch);
      for (const e of cand) {
        if (e.dead || e.spawnT > 0.2 || e.droneCd > 0) continue;
        const ddx = e.x - dx;
        const ddy = e.y - dy;
        const rr = s.area + e.def.radius;
        if (ddx * ddx + ddy * ddy <= rr * rr) {
          e.droneCd = s.cooldown;
          this.damageEnemy(e, s.damage, st, p.x, p.y);
        }
      }
    }
  }

  private d2To(e: Enemy, x: number, y: number): number {
    const dx = e.x - x;
    const dy = e.y - y;
    return dx * dx + dy * dy;
  }

  // ---------- снаряды / мины / волны ----------

  private updateProjectiles(dt: number): void {
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      const st = this.statsFor(this.playerById(pr.owner) ?? this.player);

      if (pr.kind === 'missile') {
        const target = this.nearestEnemy(pr.x, pr.y, 14);
        if (target) {
          const desired = Math.atan2(target.y - pr.y, target.x - pr.x);
          const cur = Math.atan2(pr.vy, pr.vx);
          const turn = clamp(angleDelta(cur, desired), -8 * dt, 8 * dt);
          const a = cur + turn;
          const sp = Math.hypot(pr.vx, pr.vy);
          pr.vx = Math.cos(a) * sp;
          pr.vy = Math.sin(a) * sp;
        }
      }

      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.life -= dt;
      if (pr.life <= 0) {
        if (pr.kind === 'missile' && pr.splash > 0) this.explode(pr.x, pr.y, pr.splash, pr.damage, st, pr.owner);
        pr.dead = true;
        continue;
      }

      const cand = this.hash.query(pr.x, pr.y, pr.radius + 1.2, this.scratch);
      for (const e of cand) {
        if (e.dead || pr.hits.has(e.uid)) continue;
        const dx = e.x - pr.x;
        const dy = e.y - pr.y;
        const rr = pr.radius + e.def.radius;
        if (dx * dx + dy * dy > rr * rr) continue;

        if (pr.kind === 'missile') {
          this.explode(pr.x, pr.y, pr.splash, pr.damage, st, pr.owner);
          pr.dead = true;
          break;
        }
        pr.hits.add(e.uid);
        const owner = this.playerById(pr.owner) ?? this.player;
        this.damageEnemy(e, pr.damage, st, owner.x, owner.y);
        pr.pierce--;
        if (pr.pierce < 0) {
          pr.dead = true;
          break;
        }
      }
    }
  }

  private explode(x: number, y: number, radius: number, damage: number, st: AggregatedStats, ownerId: number): void {
    const cand = this.hash.query(x, y, radius + 1.4, this.scratch);
    const owner = this.playerById(ownerId);
    for (const e of cand) {
      if (e.dead) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const rr = radius + e.def.radius;
      if (dx * dx + dy * dy <= rr * rr) this.damageEnemy(e, damage, st, owner?.x ?? x, owner?.y ?? y);
    }
    this.events.push({ t: 'boom', x, y, r: radius });
  }

  private updateBolts(dt: number): void {
    for (const b of this.bolts) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) {
        b.dead = true;
        continue;
      }
      for (const p of this.players) {
        if (p.dead) continue;
        const dx = p.x - b.x;
        const dy = p.y - b.y;
        const rr = 0.28 + p.radius;
        if (dx * dx + dy * dy <= rr * rr) {
          b.dead = true;
          this.damagePlayer(p, b.damage);
          break;
        }
      }
    }
  }

  private updateMines(dt: number): void {
    for (const m of this.mines) {
      if (m.dead) continue;
      if (m.armT > 0) {
        m.armT -= dt;
        continue;
      }
      const cand = this.hash.query(m.x, m.y, m.trigger + 1.2, this.scratch);
      for (const e of cand) {
        if (e.dead) continue;
        const dx = e.x - m.x;
        const dy = e.y - m.y;
        const rr = m.trigger + e.def.radius;
        if (dx * dx + dy * dy <= rr * rr) {
          const owner = this.playerById(m.owner) ?? this.player;
          this.explode(m.x, m.y, m.splash, m.damage, this.statsFor(owner), m.owner);
          m.dead = true;
          break;
        }
      }
    }
  }

  private updateShockwaves(dt: number): void {
    for (const sw of this.shockwaves) {
      if (sw.dead) continue;
      sw.r += sw.speed * dt;
      const owner = this.playerById(sw.owner) ?? this.player;
      const st = this.statsFor(owner);
      const cand = this.hash.query(sw.x, sw.y, sw.r + 1.4, this.scratch);
      for (const e of cand) {
        if (e.dead || sw.hit.has(e.uid)) continue;
        const d = Math.hypot(e.x - sw.x, e.y - sw.y);
        if (Math.abs(d - sw.r) < 0.9 + e.def.radius * 0.5) {
          sw.hit.add(e.uid);
          this.damageEnemy(e, sw.damage, st, sw.x, sw.y);
        }
      }
      if (sw.r >= sw.maxR) sw.dead = true;
    }
  }

  // ---------- мобы ----------

  private updateEnemies(dt: number): void {
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.attackCd = Math.max(0, e.attackCd - dt);
      e.droneCd = Math.max(0, e.droneCd - dt);
      e.flashT = Math.max(0, e.flashT - dt);
      e.spawnT = Math.max(0, e.spawnT - dt);

      const target = this.nearestAlivePlayer(e.x, e.y);
      if (!target) continue;
      const dx = target.x - e.x;
      const dy = target.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d;
      const ny = dy / d;

      switch (e.def.behavior) {
        case 'chaser':
        case 'tank':
          e.x += nx * e.def.speed * dt;
          e.y += ny * e.def.speed * dt;
          break;
        case 'sprinter':
          e.stateT -= dt;
          if (e.state === 'seek') {
            e.x += nx * e.def.speed * dt;
            e.y += ny * e.def.speed * dt;
            if (d < 6) {
              e.state = 'windup';
              e.stateT = 0.45;
            }
          } else if (e.state === 'windup') {
            if (e.stateT <= 0) {
              e.state = 'dash';
              e.stateT = 0.4;
              e.dashX = nx;
              e.dashY = ny;
            }
          } else if (e.state === 'dash') {
            e.x += e.dashX * 11 * dt;
            e.y += e.dashY * 11 * dt;
            if (e.stateT <= 0) {
              e.state = 'recover';
              e.stateT = 0.8;
            }
          } else {
            if (e.stateT <= 0) e.state = 'seek';
          }
          break;
        case 'boss': {
          e.x += nx * e.def.speed * dt;
          e.y += ny * e.def.speed * dt;
          e.bossShotCd -= dt;
          if (e.bossShotCd <= 0 && e.spawnT <= 0) {
            e.bossShotCd = 3.5;
            const base = Math.atan2(dy, dx);
            for (let i = 0; i < 18; i++) {
              const a = base + (i / 18) * Math.PI * 2;
              this.bolts.push({
                uid: this.uid++,
                x: e.x,
                y: e.y,
                vx: Math.cos(a) * 5,
                vy: Math.sin(a) * 5,
                life: 4,
                damage: 12,
                dead: false,
              });
            }
          }
          break;
        }
      }

      // контактный урон — любому игроку, которого коснулись
      if (e.spawnT <= 0 && e.attackCd <= 0) {
        for (const p of this.players) {
          if (p.dead) continue;
          const pdx = p.x - e.x;
          const pdy = p.y - e.y;
          const rr = e.def.radius + p.radius;
          if (pdx * pdx + pdy * pdy < rr * rr) {
            e.attackCd = e.def.attackCooldown;
            if (p.shieldT > 0) this.events.push({ t: 'blocked', x: p.x, y: p.y, pid: p.id });
            else this.damagePlayer(p, e.def.contactDamage);
            break;
          }
        }
      }
    }

    // мягкое расталкивание, чтобы мобы не слипались в точку
    for (const e of this.enemies) {
      if (e.dead) continue;
      const cand = this.hash.query(e.x, e.y, e.def.radius + 1.4, this.scratch);
      for (const o of cand) {
        if (o === e || o.dead) continue;
        const dx = o.x - e.x;
        const dy = o.y - e.y;
        const rr = e.def.radius + o.def.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = ((rr - d) / d) * (e.def.behavior === 'boss' ? 0 : 0.5);
        if (e.def.behavior === 'boss') {
          o.x += (dx / d) * (rr - d) * 0.5;
          o.y += (dy / d) * (rr - d) * 0.5;
        } else if (o.def.behavior !== 'boss') {
          e.x -= dx * push;
          e.y -= dy * push;
          o.x += dx * push;
          o.y += dy * push;
        }
      }
    }
  }

  damageEnemy(e: Enemy, baseDamage: number, st: AggregatedStats, knockX?: number, knockY?: number): void {
    if (e.dead) return;
    const crit = this.rng.chance(st.critChance);
    const dmg = baseDamage * st.damageMult * (crit ? 2 : 1);
    e.hp -= dmg;
    e.flashT = 0.12;
    this.events.push({ t: 'hit', x: e.x, y: e.y, dmg: Math.round(dmg), crit });
    if (knockX !== undefined && knockY !== undefined && e.def.behavior !== 'boss') {
      const dx = e.x - knockX;
      const dy = e.y - knockY;
      const d = Math.hypot(dx, dy) || 1;
      const k = e.def.behavior === 'tank' ? 0.03 : 0.09;
      e.x += (dx / d) * k;
      e.y += (dy / d) * k;
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy): void {
    e.dead = true;
    this.kills++;
    this.events.push({ t: 'kill', x: e.x, y: e.y, enemy: e.def.id });
    this.gems.push({
      uid: this.uid++,
      x: e.x + this.rng.range(-0.3, 0.3),
      y: e.y + this.rng.range(-0.3, 0.3),
      value: e.def.xp,
      kind: 'xp',
      vx: this.rng.range(-2, 2),
      vy: this.rng.range(-2, 2),
      magnet: false,
      magnetTo: -1,
      magnetV: 0,
      dead: false,
    });
    if (this.rng.chance(e.def.scrapChance)) {
      this.gems.push({
        uid: this.uid++,
        x: e.x + this.rng.range(-0.4, 0.4),
        y: e.y + this.rng.range(-0.4, 0.4),
        value: e.def.scrapAmount,
        kind: 'scrap',
        vx: this.rng.range(-2, 2),
        vy: this.rng.range(-2, 2),
        magnet: false,
        magnetTo: -1,
        magnetV: 0,
        dead: false,
      });
    }
    // чертежи: гарантированно с босса, 25% с голема (пул собирается на подборе)
    const wantBlueprint = e.def.id === 'boss' || (e.def.id === 'tank' && this.rng.chance(0.25));
    if (wantBlueprint) {
      this.gems.push({
        uid: this.uid++,
        x: e.x + this.rng.range(-0.3, 0.3),
        y: e.y + this.rng.range(-0.3, 0.3),
        value: 1,
        kind: 'blueprint',
        vx: this.rng.range(-1.5, 1.5),
        vy: this.rng.range(-1.5, 1.5),
        magnet: false,
        magnetTo: -1,
        magnetV: 0,
        dead: false,
      });
    }
    if (e.def.id === 'boss') {
      this.boss = null;
      this.state = 'won';
      this.events.push({ t: 'won', timeSec: this.time });
    }
  }

  // ---------- спавн / опыт / босс ----------

  private updateSpawner(dt: number): void {
    if (this.noSpawns) return;
    const alive = this.alivePlayers();
    if (alive.length === 0) return;
    const center = alive.length === 1 ? alive[0] : this.rng.pick(alive);
    const reqs = this.spawner.update(dt, this.time, this.enemies.length, center.x, center.y, this.halfW, this.halfH);
    for (const r of reqs) this.spawnEnemy(r.id, r.x, r.y);
  }

  private updateGems(dt: number): void {
    for (const g of this.gems) {
      if (g.dead) continue;
      let target = g.magnetTo >= 0 ? this.playerById(g.magnetTo) : undefined;
      if (target?.dead) {
        target = undefined;
        g.magnet = false;
        g.magnetTo = -1;
        g.magnetV = 0;
      }
      if (!g.magnet) {
        // магнитит ближайший игрок, в чей радиус подбора попал кристалл
        let best: Player | null = null;
        let bestD = Infinity;
        for (const p of this.players) {
          if (p.dead) continue;
          const d = Math.hypot(p.x - g.x, p.y - g.y);
          if (d < this.statsFor(p).pickupRadius && d < bestD) {
            bestD = d;
            best = p;
          }
        }
        if (best) {
          target = best;
          g.magnet = true;
          g.magnetTo = best.id;
        }
      }
      if (!target) {
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        const f = Math.max(0, 1 - 8 * dt);
        g.vx *= f;
        g.vy *= f;
        continue;
      }
      const dx = target.x - g.x;
      const dy = target.y - g.y;
      const d = Math.hypot(dx, dy) || 1;
      g.magnetV = Math.min(22, g.magnetV + 60 * dt);
      g.x += (dx / d) * g.magnetV * dt;
      g.y += (dy / d) * g.magnetV * dt;
      if (d < 0.5 + target.radius) {
        g.dead = true;
        this.pickupGem(g, target);
      }
    }
  }

  private pickupGem(g: Gem, p: Player): void {
    const st = this.statsFor(p);
    if (g.kind === 'xp') {
      this.events.push({ t: 'gem', x: g.x, y: g.y, kind: 'xp' });
      this.gainXp(g.value * st.xpMult);
    } else if (g.kind === 'scrap') {
      const v = Math.max(1, Math.round(g.value * (1 + (p.fixed.scrapPct ?? 0))));
      p.scrapCollected += v;
      this.events.push({ t: 'scrap', amount: v, pid: p.id, x: g.x, y: g.y });
    } else {
      let pool = p.blueprintPool;
      if (pool.length === 0) {
        pool = [...new Set(this.players.flatMap((x) => x.blueprintPool))];
      }
      if (pool.length === 0) return;
      const partId = pool[this.rng.int(pool.length)];
      p.foundBlueprints.push(partId);
      this.events.push({ t: 'blueprint', x: g.x, y: g.y, partId, pid: p.id });
    }
  }

  private gainXp(v: number): void {
    this.xp += v;
    while (this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level++;
      for (const p of this.players) {
        if (p.dead) continue;
        p.pendingLevelUps++;
        this.events.push({ t: 'levelup', level: this.level, pid: p.id, x: p.x, y: p.y });
      }
    }
  }

  private updateBossTimeline(): void {
    if (!this.bossWarned && this.time >= 570) {
      this.bossWarned = true;
      this.events.push({ t: 'bossWarn' });
    }
    if (!this.bossSpawned && this.time >= 600) {
      this.bossSpawned = true;
      const target = this.nearestAlivePlayer(0, 0) ?? this.player;
      const x = target.x > 0 ? -this.halfW + 4 : this.halfW - 4;
      const y = clamp(target.y, -this.halfH + 4, this.halfH - 4);
      this.spawnEnemy('boss', x, y);
    }
  }

  private compact(): void {
    this.enemies = this.enemies.filter((e) => !e.dead);
    this.projectiles = this.projectiles.filter((x) => !x.dead);
    this.bolts = this.bolts.filter((x) => !x.dead);
    this.mines = this.mines.filter((x) => !x.dead);
    this.shockwaves = this.shockwaves.filter((x) => !x.dead);
    this.gems = this.gems.filter((x) => !x.dead);
  }
}
