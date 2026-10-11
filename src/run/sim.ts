import { Rng } from '../core/rng';
import { clamp, normalize, angleDelta } from '../core/math';
import { ENEMIES, type EnemyDef, type EnemyId } from '../content/enemies';
import { WEAPONS, type WeaponId, type WeaponStats } from '../content/weapons';
import type { PassiveId } from '../content/passives';
import type { ModuleStats } from '../meta/parts';
import { Spawner } from './spawner';
import { SpatialHash } from './spatial';
import { enemyHpMult, xpToNext } from './progression';

/** Стартовые параметры забега — результат сборки в ангаре + прокачка пилота. */
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

export interface Player {
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
  level: number;
  xp: number;
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
  | { t: 'scrap'; amount: number }
  | { t: 'blueprint'; x: number; y: number; partId: string }
  | { t: 'damaged'; amount: number; hp: number }
  | { t: 'blocked'; x: number; y: number }
  | { t: 'shield'; x: number; y: number }
  | { t: 'levelup'; level: number }
  | { t: 'bossWarn' }
  | { t: 'bossSpawn'; x: number; y: number }
  | { t: 'died'; timeSec: number }
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

export class RunSim {
  readonly halfW = 28;
  readonly halfH = 18;
  time = 0;
  state: 'running' | 'dead' | 'won' = 'running';
  kills = 0;
  scrapCollected = 0;
  events: GameEvent[] = [];
  pendingLevelUps = 0;
  /** Чертежи, найденные за забег. */
  foundBlueprints: string[] = [];
  readonly weaponSlots: number;

  readonly player: Player;
  private readonly start: RunStartConfig;
  weapons: WeaponRuntime[] = [];
  passiveStacks: Partial<Record<PassiveId, number>> = {};
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  bolts: EnemyBolt[] = [];
  mines: Mine[] = [];
  shockwaves: Shockwave[] = [];
  gems: Gem[] = [];
  boss: Enemy | null = null;

  private readonly rng: Rng;
  private readonly spawner: Spawner;
  private readonly hash = new SpatialHash<Enemy>(2.5);
  private readonly scratch: Enemy[] = [];
  private uid = 1;
  private bossSpawned = false;
  bossWarned = false;

  constructor(start?: Partial<RunStartConfig>, seed?: number) {
    this.start = { ...defaultStart(), ...start };
    this.weaponSlots = this.start.weaponSlots;
    this.rng = new Rng(seed);
    this.spawner = new Spawner(this.rng);
    this.player = {
      x: 0,
      y: 0,
      hp: this.start.maxHp,
      maxHp: this.start.maxHp,
      baseSpeed: this.start.speed,
      radius: 0.6,
      basePickup: this.start.pickup,
      facingX: 0,
      facingY: 1,
      moving: false,
      iframe: 0,
      dashCd: 0,
      dashT: 0,
      shieldCd: 0,
      shieldT: 0,
      level: 1,
      xp: 0,
    };
    for (const w of this.start.weapons) {
      if (this.weapons.some((x) => x.id === w.id)) continue;
      this.weapons.push({ id: w.id, level: clamp(w.level, 1, WEAPONS[w.id]?.maxLevel ?? 8), cd: 0.3, angle: this.rng.angle(), drones: [] });
    }
    this.pendingLevelUps = this.start.startLevelBonus;
  }

  // ---------- публичный API для main/рендера/тестов ----------

  stats(): AggregatedStats {
    const s = this.passiveStacks;
    const g = (id: PassiveId): number => s[id] ?? 0;
    const f = this.start.fixed;
    return {
      speed: this.player.baseSpeed * (1 + 0.07 * g('moveSpeed')) * (1 + (f.moveSpeedPct ?? 0)),
      damageMult: (1 + 0.12 * g('damage')) * (1 + (f.damagePct ?? 0)),
      attackSpeedMult: (1 + 0.1 * g('attackSpeed')) * (1 + (f.attackSpeedPct ?? 0)),
      areaMult: (1 + 0.12 * g('area')) * (1 + (f.areaPct ?? 0)),
      pickupRadius: this.player.basePickup * (1 + 0.28 * g('pickup')) * (1 + (f.pickupPct ?? 0)),
      critChance: 0.03 + 0.06 * g('crit') + (f.critChance ?? 0),
      xpMult: (1 + 0.12 * g('xpGain')) * (1 + (f.xpPct ?? 0)),
    };
  }

  addWeapon(id: WeaponId): void {
    if (this.weapons.some((w) => w.id === id)) return;
    this.weapons.push({ id, level: 1, cd: 0.3, angle: this.rng.angle(), drones: [] });
  }

  addPassiveStack(id: PassiveId): void {
    this.passiveStacks[id] = (this.passiveStacks[id] ?? 0) + 1;
    if (id === 'maxHp') {
      this.player.maxHp += 18;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 18);
    }
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

  // ---------- главный тик ----------

  tick(dt: number, input: InputSnapshot): void {
    if (this.state !== 'running') return;
    this.time += dt;

    this.updatePlayer(dt, input);
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

  // ---------- игрок ----------

  private updatePlayer(dt: number, input: InputSnapshot): void {
    const p = this.player;
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
      this.events.push({ t: 'shield', x: p.x, y: p.y });
    }

    const dir = normalize(input.moveX, input.moveY);
    p.moving = dir.x !== 0 || dir.y !== 0;
    if (p.moving) {
      p.facingX = dir.x;
      p.facingY = dir.y;
    }
    const speed = this.stats().speed * (p.dashT > 0 ? 3.8 : 1);
    p.x = clamp(p.x + dir.x * speed * dt, -this.halfW + 0.9, this.halfW - 0.9);
    p.y = clamp(p.y + dir.y * speed * dt, -this.halfH + 0.9, this.halfH - 0.9);
  }

  private damagePlayer(amount: number): void {
    const p = this.player;
    if (this.state !== 'running') return;
    if (p.shieldT > 0) {
      this.events.push({ t: 'blocked', x: p.x, y: p.y });
      return;
    }
    if (p.iframe > 0 || p.dashT > 0) return;
    p.hp -= amount;
    p.iframe = 0.5;
    this.events.push({ t: 'damaged', amount, hp: Math.max(0, p.hp) });
    if (p.hp <= 0) {
      this.state = 'dead';
      this.events.push({ t: 'died', timeSec: this.time });
    }
  }

  // ---------- оружие ----------

  private rebuildHash(): void {
    this.hash.clear();
    for (const e of this.enemies) if (!e.dead) this.hash.insert(e);
  }

  private updateWeapons(dt: number): void {
    const st = this.stats();
    for (const w of this.weapons) {
      const s = WEAPONS[w.id].stats(w.level);
      if (w.id === 'drones') {
        this.updateDrones(w, s, st, dt);
        continue;
      }
      w.cd -= dt;
      if (w.cd > 0) continue;
      this.fireWeapon(w, s, st);
    }
  }

  private fireWeapon(w: WeaponRuntime, s: WeaponStats, st: AggregatedStats): void {
    const p = this.player;
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
        alive.sort((a, b) => this.d2ToPlayer(a) - this.d2ToPlayer(b));
        for (let i = 0; i < s.count; i++) {
          const off = this.rng.angle();
          this.projectiles.push({
            uid: this.uid++,
            kind: 'missile',
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

  private updateDrones(w: WeaponRuntime, s: WeaponStats, st: AggregatedStats, dt: number): void {
    const p = this.player;
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

  private d2ToPlayer(e: Enemy): number {
    const dx = e.x - this.player.x;
    const dy = e.y - this.player.y;
    return dx * dx + dy * dy;
  }

  // ---------- снаряды / мины / волны ----------

  private updateProjectiles(dt: number): void {
    const st = this.stats();
    for (const pr of this.projectiles) {
      if (pr.dead) continue;

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
        if (pr.kind === 'missile' && pr.splash > 0) this.explode(pr.x, pr.y, pr.splash, pr.damage, st);
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
          this.explode(pr.x, pr.y, pr.splash, pr.damage, st);
          pr.dead = true;
          break;
        }
        pr.hits.add(e.uid);
        this.damageEnemy(e, pr.damage, st, this.player.x, this.player.y);
        pr.pierce--;
        if (pr.pierce < 0) {
          pr.dead = true;
          break;
        }
      }
    }
  }

  private explode(x: number, y: number, radius: number, damage: number, st: AggregatedStats): void {
    const cand = this.hash.query(x, y, radius + 1.4, this.scratch);
    for (const e of cand) {
      if (e.dead) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const rr = radius + e.def.radius;
      if (dx * dx + dy * dy <= rr * rr) this.damageEnemy(e, damage, st, x, y);
    }
    this.events.push({ t: 'boom', x, y, r: radius });
  }

  private updateBolts(dt: number): void {
    const p = this.player;
    for (const b of this.bolts) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) {
        b.dead = true;
        continue;
      }
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      const rr = 0.28 + p.radius;
      if (dx * dx + dy * dy <= rr * rr) {
        b.dead = true;
        this.damagePlayer(b.damage);
      }
    }
  }

  private updateMines(dt: number): void {
    const st = this.stats();
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
          this.explode(m.x, m.y, m.splash, m.damage, st);
          m.dead = true;
          break;
        }
      }
    }
  }

  private updateShockwaves(dt: number): void {
    const st = this.stats();
    for (const sw of this.shockwaves) {
      if (sw.dead) continue;
      sw.r += sw.speed * dt;
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
    const p = this.player;
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.attackCd = Math.max(0, e.attackCd - dt);
      e.droneCd = Math.max(0, e.droneCd - dt);
      e.flashT = Math.max(0, e.flashT - dt);
      e.spawnT = Math.max(0, e.spawnT - dt);

      const dx = p.x - e.x;
      const dy = p.y - e.y;
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

      // контактный урон
      if (e.spawnT <= 0 && e.attackCd <= 0) {
        const rr = e.def.radius + p.radius;
        if (d < rr) {
          e.attackCd = e.def.attackCooldown;
          if (p.shieldT > 0) this.events.push({ t: 'blocked', x: p.x, y: p.y });
          else this.damagePlayer(e.def.contactDamage);
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
        magnetV: 0,
        dead: false,
      });
    }
    // чертежи: гарантированно с босса, 25% с голема
    const wantBlueprint =
      this.start.blueprintPool.length > 0 && (e.def.id === 'boss' || (e.def.id === 'tank' && this.rng.chance(0.25)));
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
    const reqs = this.spawner.update(dt, this.time, this.enemies.length, this.player.x, this.player.y, this.halfW, this.halfH);
    for (const r of reqs) this.spawnEnemy(r.id, r.x, r.y);
  }

  private updateGems(dt: number): void {
    const p = this.player;
    const st = this.stats();
    const pickup = st.pickupRadius;
    for (const g of this.gems) {
      if (g.dead) continue;
      const dx = p.x - g.x;
      const dy = p.y - g.y;
      const d = Math.hypot(dx, dy) || 1;
      if (!g.magnet && d < pickup) g.magnet = true;
      if (g.magnet) {
        g.magnetV = Math.min(22, g.magnetV + 60 * dt);
        g.x += (dx / d) * g.magnetV * dt;
        g.y += (dy / d) * g.magnetV * dt;
      } else {
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        const f = Math.max(0, 1 - 8 * dt);
        g.vx *= f;
        g.vy *= f;
      }
      if (d < 0.5 + p.radius) {
        g.dead = true;
        if (g.kind === 'xp') {
          this.events.push({ t: 'gem', x: g.x, y: g.y, kind: 'xp' });
          this.gainXp(g.value * st.xpMult);
        } else if (g.kind === 'scrap') {
          const v = Math.max(1, Math.round(g.value * (1 + (this.start.fixed.scrapPct ?? 0))));
          this.scrapCollected += v;
          this.events.push({ t: 'scrap', amount: v });
        } else {
          const pool = this.start.blueprintPool;
          const partId = pool[this.rng.int(pool.length)];
          this.foundBlueprints.push(partId);
          this.events.push({ t: 'blueprint', x: g.x, y: g.y, partId });
        }
      }
    }
  }

  private gainXp(v: number): void {
    const p = this.player;
    p.xp += v;
    while (p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level++;
      this.pendingLevelUps++;
      this.events.push({ t: 'levelup', level: p.level });
    }
  }

  private updateBossTimeline(): void {
    if (!this.bossWarned && this.time >= 570) {
      this.bossWarned = true;
      this.events.push({ t: 'bossWarn' });
    }
    if (!this.bossSpawned && this.time >= 600) {
      this.bossSpawned = true;
      const p = this.player;
      const x = p.x > 0 ? -this.halfW + 4 : this.halfW - 4;
      const y = clamp(p.y, -this.halfH + 4, this.halfH - 4);
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
