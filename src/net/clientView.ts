import { ENEMIES } from '../content/enemies';
import { WEAPONS } from '../content/weapons';
import type { PassiveId } from '../content/passives';
import { clamp, normalize } from '../core/math';
import { computeStats, DASH_CD, SHIELD_CD, SHIELD_DURATION, type InputSnapshot, type Player } from '../run/sim';
import type { RunView } from '../run/view';
import type { Card } from '../run/cards';
import type { RosterEntry, Snapshot, SnapPlayer } from './protocol';

/** Задержка интерполяции чужих сущностей: буфер против джиттера сети. */
const INTERP_MS = 120;
const KEEP_SNAPSHOTS = 8;

function makePlayer(e: RosterEntry): Player {
  const p: Player = {
    id: e.pid,
    name: e.name,
    colorIdx: e.colorIdx,
    x: 0,
    y: 0,
    hp: e.start.maxHp,
    maxHp: e.start.maxHp,
    baseSpeed: e.start.speed,
    radius: 0.6,
    basePickup: e.start.pickup,
    facingX: 0,
    facingY: 1,
    moving: false,
    iframe: 0,
    dashCd: 0,
    dashT: 0,
    shieldCd: 0,
    shieldT: 0,
    dead: false,
    weapons: e.start.weapons.map((w) => ({ id: w.id, level: w.level, cd: 0, angle: 0, drones: [] })),
    passiveStacks: {},
    fixed: e.start.fixed,
    weaponSlots: e.start.weaponSlots,
    blueprintPool: e.start.blueprintPool,
    scrapCollected: 0,
    foundBlueprints: [],
    pendingLevelUps: 0,
  };
  return p;
}

/** Кинематическая копия локального игрока: движение/рывок/щит предсказываются сами. */
class LocalPredictor {
  x = 0;
  y = 0;
  facingX = 0;
  facingY = 1;
  moving = false;
  dashCd = 0;
  dashT = 0;
  shieldCd = 0;
  shieldT = 0;
  iframe = 0;

  constructor(
    private readonly base: { baseSpeed: number; basePickup: number },
    private readonly fixed: Player['fixed'],
    private stacks: Partial<Record<PassiveId, number>>,
    private readonly halfW: number,
    private readonly halfH: number,
  ) {}

  get speed(): number {
    return computeStats(this.base, this.stacks, this.fixed).speed;
  }

  tick(dt: number, input: InputSnapshot): void {
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.shieldCd = Math.max(0, this.shieldCd - dt);
    this.dashT = Math.max(0, this.dashT - dt);
    this.shieldT = Math.max(0, this.shieldT - dt);
    this.iframe = Math.max(0, this.iframe - dt);

    if (input.dash && this.dashCd <= 0) {
      this.dashCd = DASH_CD;
      this.dashT = 0.2;
      this.iframe = Math.max(this.iframe, 0.32);
    }
    if (input.shield && this.shieldCd <= 0) {
      this.shieldCd = SHIELD_CD;
      this.shieldT = SHIELD_DURATION;
    }

    const dir = normalize(input.moveX, input.moveY);
    this.moving = dir.x !== 0 || dir.y !== 0;
    if (this.moving) {
      this.facingX = dir.x;
      this.facingY = dir.y;
    }
    const speed = this.speed * (this.dashT > 0 ? 3.8 : 1);
    this.x = clamp(this.x + dir.x * speed * dt, -this.halfW + 0.9, this.halfW - 0.9);
    this.y = clamp(this.y + dir.y * speed * dt, -this.halfH + 0.9, this.halfH - 0.9);
  }

  /** Мягкая коррекция к авторитетному состоянию из снапшота. */
  correct(sp: SnapPlayer | undefined): void {
    if (!sp) return;
    const dx = sp.x - this.x;
    const dy = sp.y - this.y;
    if (Math.hypot(dx, dy) > 1.5) {
      this.x = sp.x;
      this.y = sp.y;
    } else {
      this.x += dx * 0.2;
      this.y += dy * 0.2;
    }
    // кулдауны синхронизируем только при сильном расхождении, чтобы не дёргать HUD
    if (Math.abs(this.dashCd - sp.dashCd) > 0.35) this.dashCd = sp.dashCd;
    if (Math.abs(this.shieldCd - sp.shieldCd) > 0.35) this.shieldCd = sp.shieldCd;
    if (Math.abs(this.shieldT - sp.shieldT) > 0.35) this.shieldT = sp.shieldT;
  }

  applyPick(card: Card): void {
    if (card.kind === 'passive' && card.passive === 'moveSpeed') {
      this.stacks = { ...this.stacks, moveSpeed: (this.stacks.moveSpeed ?? 0) + 1 };
    }
  }
}

interface TimedSnapshot {
  recvAt: number;
  snap: Snapshot;
}

/** Состояние забега на клиенте: снапшоты хоста + предикция своего робота. */
export class ClientRunView implements RunView {
  time = 0;
  state: 'running' | 'dead' | 'won' = 'running';
  kills = 0;
  level = 1;
  xp = 0;
  players: Player[] = [];
  enemies: RunView['enemies'] = [];
  projectiles: RunView['projectiles'] = [];
  bolts: RunView['bolts'] = [];
  mines: RunView['mines'] = [];
  shockwaves: RunView['shockwaves'] = [];
  gems: RunView['gems'] = [];
  boss: RunView['boss'] = null;

  private buffer: TimedSnapshot[] = [];
  private readonly enemyMap = new Map<number, RunView['enemies'][number]>();
  private readonly projMap = new Map<number, RunView['projectiles'][number]>();
  private readonly boltMap = new Map<number, RunView['bolts'][number]>();
  private readonly mineMap = new Map<number, RunView['mines'][number]>();
  private readonly waveMap = new Map<number, RunView['shockwaves'][number]>();
  private readonly gemMap = new Map<number, RunView['gems'][number]>();
  private readonly pred: LocalPredictor;
  private readonly myPid: number;

  constructor(roster: RosterEntry[], myPid: number) {
    this.myPid = myPid;
    this.players = roster.map(makePlayer);
    const mine = roster.find((e) => e.pid === myPid) ?? roster[0];
    this.pred = new LocalPredictor(
      { baseSpeed: mine.start.speed, basePickup: mine.start.pickup },
      mine.start.fixed,
      {},
      28,
      18,
    );
  }

  get player(): Player {
    return this.players.find((p) => p.id === this.myPid) ?? this.players[0];
  }

  /** Тик предикции своего робота — тем же фиксированным шагом, что и отправка ввода. */
  predictTick(dt: number, input: InputSnapshot): void {
    if (this.state !== 'running' || this.player.dead) return;
    this.pred.tick(dt, input);
  }

  /** Локально применяем свой выбор карточки, чтобы предикция скорости не разъезжалась. */
  applyPick(card: Card): void {
    this.pred.applyPick(card);
  }

  pushSnapshot(snap: Snapshot, nowMs: number): void {
    this.buffer.push({ recvAt: nowMs, snap: snap });
    if (this.buffer.length > KEEP_SNAPSHOTS) this.buffer.shift();
    this.pred.correct(snap.players.find((p) => p.pid === this.myPid));
    this.syncRosterBasics(snap);
  }

  /** Обновление до текущего момента: интерполяция чужих, предикция своего. */
  frame(nowMs: number, dt: number): void {
    const pair = this.pickPair(nowMs - INTERP_MS);
    if (!pair) return;
    const { a, b, alpha } = pair;
    // скалярное состояние — из старого кадра, чтобы счётчики не дёргались
    this.time = a.snap.time;
    this.kills = a.snap.kills;
    this.level = a.snap.level;
    this.xp = a.snap.xp;
    this.state = b.snap.state;

    this.interpEnemies(a.snap, b.snap, alpha, dt);
    this.interpProjectiles(a.snap, b.snap, alpha);
    this.interpBolts(a.snap, b.snap, alpha);
    this.interpMines(a.snap, b.snap);
    this.interpWaves(a.snap, b.snap, alpha);
    this.interpGems(a.snap, b.snap, alpha);
    this.interpPlayers(a.snap, b.snap, alpha, dt);
    this.syncBoss(b.snap);
  }

  private pickPair(renderAt: number): { a: TimedSnapshot; b: TimedSnapshot; alpha: number } | null {
    if (this.buffer.length === 0) return null;
    if (this.buffer.length === 1) {
      const only = this.buffer[0];
      return { a: only, b: only, alpha: 0 };
    }
    let i = 0;
    while (i < this.buffer.length - 2 && this.buffer[i + 1].recvAt <= renderAt) i++;
    const a = this.buffer[i];
    const b = this.buffer[i + 1];
    const span = b.recvAt - a.recvAt;
    const alpha = span <= 0 ? 1 : clamp((renderAt - a.recvAt) / span, 0, 1);
    return { a, b, alpha };
  }

  private interpEnemies(a: Snapshot, b: Snapshot, alpha: number, dt: number): void {
    const aPos = new Map(a.enemies.map((e) => [e.uid, e]));
    const seen = new Set<number>();
    for (const be of b.enemies) {
      seen.add(be.uid);
      let e = this.enemyMap.get(be.uid);
      if (!e) {
        e = {
          uid: be.uid,
          def: ENEMIES[be.id],
          x: be.x,
          y: be.y,
          hp: be.hp,
          maxHp: be.maxHp,
          attackCd: 0,
          droneCd: 0,
          spawnT: be.spawnT,
          flashT: 0,
          state: be.state,
          stateT: 0,
          dashX: 0,
          dashY: 0,
          bossShotCd: 0,
          dead: false,
        };
        this.enemyMap.set(be.uid, e);
        this.enemies.push(e);
      }
      const ae = aPos.get(be.uid);
      e.x = ae ? ae.x + (be.x - ae.x) * alpha : be.x;
      e.y = ae ? ae.y + (be.y - ae.y) * alpha : be.y;
      // hp упал между снапшотами — короткая вспышка попадания
      if (be.hp < e.hp - 0.5) e.flashT = 0.15;
      e.hp = be.hp;
      e.maxHp = be.maxHp;
      e.state = be.state;
      e.spawnT = be.spawnT;
      e.flashT = Math.max(0, e.flashT - dt);
    }
    for (const [uid, e] of this.enemyMap) {
      if (seen.has(uid)) continue;
      this.enemyMap.delete(uid);
      this.enemies = this.enemies.filter((x) => x !== e);
    }
  }

  private interpProjectiles(a: Snapshot, b: Snapshot, alpha: number): void {
    const aPos = new Map(a.projectiles.map((p) => [p.uid, p]));
    const seen = new Set<number>();
    for (const bp of b.projectiles) {
      seen.add(bp.uid);
      let pr = this.projMap.get(bp.uid);
      if (!pr) {
        pr = {
          uid: bp.uid,
          kind: bp.kind,
          owner: -1,
          x: bp.x,
          y: bp.y,
          vx: bp.vx,
          vy: bp.vy,
          damage: 0,
          radius: bp.kind === 'missile' ? 0.3 : 0.2,
          life: 1,
          pierce: 0,
          hits: new Set(),
          splash: 0,
          dead: false,
        };
        this.projMap.set(bp.uid, pr);
        this.projectiles.push(pr);
      }
      const ap = aPos.get(bp.uid);
      pr.x = ap ? ap.x + (bp.x - ap.x) * alpha : bp.x;
      pr.y = ap ? ap.y + (bp.y - ap.y) * alpha : bp.y;
      pr.vx = bp.vx;
      pr.vy = bp.vy;
    }
    this.compact(seen, this.projMap, (x) => (this.projectiles = this.projectiles.filter((p) => p !== x)));
  }

  private interpBolts(a: Snapshot, b: Snapshot, alpha: number): void {
    const aPos = new Map(a.bolts.map((p) => [p.uid, p]));
    const seen = new Set<number>();
    for (const bb of b.bolts) {
      seen.add(bb.uid);
      let bolt = this.boltMap.get(bb.uid);
      if (!bolt) {
        bolt = { uid: bb.uid, x: bb.x, y: bb.y, vx: bb.vx, vy: bb.vy, life: 1, damage: 0, dead: false };
        this.boltMap.set(bb.uid, bolt);
        this.bolts.push(bolt);
      }
      const ab = aPos.get(bb.uid);
      bolt.x = ab ? ab.x + (bb.x - ab.x) * alpha : bb.x;
      bolt.y = ab ? ab.y + (bb.y - ab.y) * alpha : bb.y;
      bolt.vx = bb.vx;
      bolt.vy = bb.vy;
    }
    this.compact(seen, this.boltMap, (x) => (this.bolts = this.bolts.filter((p) => p !== x)));
  }

  private interpMines(a: Snapshot, b: Snapshot): void {
    const seen = new Set<number>();
    for (const bm of b.mines) {
      seen.add(bm.uid);
      let m = this.mineMap.get(bm.uid);
      if (!m) {
        m = { uid: bm.uid, owner: -1, x: bm.x, y: bm.y, armT: bm.armed ? 0 : 0.4, damage: 0, splash: 0, trigger: 0, dead: false };
        this.mineMap.set(bm.uid, m);
        this.mines.push(m);
      }
      m.x = bm.x;
      m.y = bm.y;
      m.armT = bm.armed ? 0 : Math.max(m.armT, 0.1);
    }
    this.compact(seen, this.mineMap, (x) => (this.mines = this.mines.filter((p) => p !== x)));
    void a;
  }

  private interpWaves(a: Snapshot, b: Snapshot, alpha: number): void {
    const aPos = new Map(a.waves.map((w) => [w.uid, w]));
    const seen = new Set<number>();
    for (const bw of b.waves) {
      seen.add(bw.uid);
      let w = this.waveMap.get(bw.uid);
      if (!w) {
        w = { uid: bw.uid, owner: -1, x: bw.x, y: bw.y, r: bw.r, maxR: bw.maxR, speed: 14, damage: 0, hit: new Set(), dead: false };
        this.waveMap.set(bw.uid, w);
        this.shockwaves.push(w);
      }
      const aw = aPos.get(bw.uid);
      w.x = aw ? aw.x + (bw.x - aw.x) * alpha : bw.x;
      w.y = aw ? aw.y + (bw.y - aw.y) * alpha : bw.y;
      w.r = aw ? aw.r + (bw.r - aw.r) * alpha : bw.r;
      w.maxR = bw.maxR;
    }
    this.compact(seen, this.waveMap, (x) => (this.shockwaves = this.shockwaves.filter((p) => p !== x)));
  }

  private interpGems(a: Snapshot, b: Snapshot, alpha: number): void {
    const aPos = new Map(a.gems.map((g) => [g.uid, g]));
    const seen = new Set<number>();
    for (const bg of b.gems) {
      seen.add(bg.uid);
      let g = this.gemMap.get(bg.uid);
      if (!g) {
        g = {
          uid: bg.uid,
          x: bg.x,
          y: bg.y,
          value: 1,
          kind: bg.kind,
          vx: 0,
          vy: 0,
          magnet: bg.magnet,
          magnetTo: -1,
          magnetV: 0,
          dead: false,
        };
        this.gemMap.set(bg.uid, g);
        this.gems.push(g);
      }
      const ag = aPos.get(bg.uid);
      g.x = ag ? ag.x + (bg.x - ag.x) * alpha : bg.x;
      g.y = ag ? ag.y + (bg.y - ag.y) * alpha : bg.y;
      g.magnet = bg.magnet;
    }
    this.compact(seen, this.gemMap, (x) => (this.gems = this.gems.filter((p) => p !== x)));
  }

  private interpPlayers(a: Snapshot, b: Snapshot, alpha: number, dt: number): void {
    const aPos = new Map(a.players.map((p) => [p.pid, p]));
    for (const sp of b.players) {
      const p = this.players.find((x) => x.id === sp.pid);
      if (!p) continue;
      p.dead = sp.dead;
      p.hp = sp.hp;
      p.maxHp = sp.maxHp;
      p.scrapCollected = sp.scrap;
      p.iframe = sp.iframe;
      if (sp.pid === this.myPid && !p.dead) {
        // свой робот — предикция
        p.x = this.pred.x;
        p.y = this.pred.y;
        p.facingX = this.pred.facingX;
        p.facingY = this.pred.facingY;
        p.moving = this.pred.moving;
        p.dashCd = this.pred.dashCd;
        p.dashT = this.pred.dashT;
        p.shieldCd = this.pred.shieldCd;
        p.shieldT = this.pred.shieldT;
        p.iframe = Math.max(sp.iframe, this.pred.iframe);
      } else {
        const ap = aPos.get(sp.pid);
        p.x = ap ? ap.x + (sp.x - ap.x) * alpha : sp.x;
        p.y = ap ? ap.y + (sp.y - ap.y) * alpha : sp.y;
        p.facingX = sp.facingX;
        p.facingY = sp.facingY;
        p.moving = sp.moving;
        p.dashCd = sp.dashCd;
        p.dashT = sp.dashT;
        p.shieldCd = sp.shieldCd;
        p.shieldT = sp.shieldT;
      }
      this.syncWeapons(p, sp, dt);
    }
  }

  /** Дроны вращаются локально между снапшотами — гладко и дёшево. */
  private syncWeapons(p: Player, sp: SnapPlayer, dt: number): void {
    for (let i = 0; i < sp.weapons.length; i++) {
      const sw = sp.weapons[i];
      let w = p.weapons.find((x) => x.id === sw.id);
      if (!w) {
        w = { id: sw.id, level: sw.level, cd: 0, angle: sw.angle, drones: [] };
        p.weapons.push(w);
      }
      w.level = sw.level;
      if (sw.id !== 'drones') {
        w.drones.length = 0;
        continue;
      }
      // снапшот авторитетен для уровня; угол крутим сами
      if (Math.abs(((w.angle - sw.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > 0.7) w.angle = sw.angle;
      const s = WEAPONS[sw.id].stats(sw.level);
      w.angle += s.speed * dt;
      w.drones.length = 0;
      for (let d = 0; d < s.count; d++) {
        const ang = w.angle + (d * Math.PI * 2) / s.count;
        w.drones.push({ x: p.x + Math.cos(ang) * s.range, y: p.y + Math.sin(ang) * s.range });
      }
    }
    // убираем оружие, которого больше нет (не бывает, но безопасно)
    p.weapons = p.weapons.filter((w) => sp.weapons.some((sw) => sw.id === w.id));
  }

  private syncBoss(b: Snapshot): void {
    if (!b.boss) {
      this.boss = null;
      return;
    }
    const e = this.enemyMap.get(b.boss.uid);
    if (e) {
      e.hp = e.maxHp * b.boss.hpRatio;
      this.boss = e;
    } else {
      this.boss = null;
    }
  }

  /** Постоянные данные игроков (имена уже есть) — обновляем hp на старте. */
  private syncRosterBasics(snap: Snapshot): void {
    for (const sp of snap.players) {
      const p = this.players.find((x) => x.id === sp.pid);
      if (!p) continue;
      p.hp = sp.hp;
      p.maxHp = sp.maxHp;
      p.dead = sp.dead;
      p.scrapCollected = sp.scrap;
    }
  }

  private compact<T extends { uid: number }>(seen: Set<number>, map: Map<number, T>, drop: (item: T) => void): void {
    for (const [uid, item] of map) {
      if (seen.has(uid)) continue;
      map.delete(uid);
      drop(item);
    }
  }
}
