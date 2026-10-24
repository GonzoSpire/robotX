import { ENEMIES, type EnemyId } from '../content/enemies';
import { WEAPON_IDS, type WeaponId } from '../content/weapons';
import { enemyHpMult } from '../run/progression';
import type { GameEvent, RunSim, RunStartConfig } from '../run/sim';
import type { Card } from '../run/cards';

/** Версия бинарного протокола: несовпадение = сообщение игнорируется. */
export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 4;

export const ENEMY_IDS = Object.keys(ENEMIES) as EnemyId[];

// ---------- управляющие сообщения (JSON) ----------

export interface LobbyMember {
  pid: number;
  name: string;
  colorIdx: number;
  ready: boolean;
}

export interface RosterEntry {
  pid: number;
  name: string;
  colorIdx: number;
  start: RunStartConfig;
}

export interface PlayerResult {
  pid: number;
  name: string;
  won: boolean;
  timeSec: number;
  level: number;
  kills: number;
  scrap: number;
  blueprints: string[];
}

export type ClientMsg =
  | { t: 'hello'; name: string; start: RunStartConfig }
  | { t: 'ready'; ready: boolean }
  | { t: 'cardPick'; pid: number; card: Card }
  | { t: 'leave' };

export type HostMsg =
  | { t: 'lobby'; hostPid: number; yourPid: number; members: LobbyMember[] }
  | { t: 'start'; seed: number; roster: RosterEntry[] }
  | { t: 'cardOffer'; pid: number; cards: Card[] }
  | { t: 'events'; tick: number; list: GameEvent[] }
  | { t: 'end'; results: PlayerResult[] }
  | { t: 'backToLobby' };

export function isClientMsg(m: unknown): m is ClientMsg {
  const t = (m as { t?: string })?.t;
  return t === 'hello' || t === 'ready' || t === 'cardPick' || t === 'leave';
}

/** PeerJS/BinaryPack может отдать буфер как ArrayBuffer или Uint8View — нормализуем. */
export function asArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView;
    return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer;
  }
  return null;
}

export function sameCard(a: Card, b: Card): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isHostMsg(m: unknown): m is HostMsg {
  const t = (m as { t?: string })?.t;
  return t === 'lobby' || t === 'start' || t === 'cardOffer' || t === 'events' || t === 'end' || t === 'backToLobby';
}

// ---------- код комнаты ----------

/** Алфавит без похожих символов (0/O, 1/I, ...) для кодов комнат. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function genRoomCode(rand: () => number = Math.random, len = 5): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}

export const ROOM_PREFIX = 'robotx-';

export function roomPeerId(code: string): string {
  return ROOM_PREFIX + code.toUpperCase();
}

// ---------- ввод (клиент → хост, 4 байта) ----------

export function encodeInput(mx: number, my: number, dash: boolean, shield: boolean): ArrayBuffer {
  const buf = new ArrayBuffer(5);
  const v = new DataView(buf);
  v.setUint8(0, PROTOCOL_VERSION);
  v.setInt8(1, Math.round(Math.max(-127, Math.min(127, mx * 100))));
  v.setInt8(2, Math.round(Math.max(-127, Math.min(127, my * 100))));
  v.setUint8(3, (dash ? 1 : 0) | (shield ? 2 : 0));
  v.setUint8(4, 0);
  return buf;
}

export interface DecodedInput {
  moveX: number;
  moveY: number;
  dash: boolean;
  shield: boolean;
}

export function decodeInput(data: ArrayBuffer): DecodedInput | null {
  if (data.byteLength < 4) return null;
  const v = new DataView(data);
  if (v.getUint8(0) !== PROTOCOL_VERSION) return null;
  return {
    moveX: v.getInt8(1) / 100,
    moveY: v.getInt8(2) / 100,
    dash: (v.getUint8(3) & 1) !== 0,
    shield: (v.getUint8(3) & 2) !== 0,
  };
}

// ---------- снапшот (хост → клиенты) ----------

export interface SnapWeapon {
  id: WeaponId;
  level: number;
  angle: number;
}

export interface SnapPlayer {
  pid: number;
  dead: boolean;
  moving: boolean;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dashCd: number;
  shieldCd: number;
  shieldT: number;
  dashT: number;
  iframe: number;
  scrap: number;
  facingX: number;
  facingY: number;
  weapons: SnapWeapon[];
}

export interface SnapEnemy {
  uid: number;
  id: EnemyId;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  state: 'seek' | 'windup' | 'dash' | 'recover';
  spawnT: number;
}

export interface SnapProj {
  uid: number;
  kind: 'bullet' | 'missile';
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SnapBolt {
  uid: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SnapMine {
  uid: number;
  x: number;
  y: number;
  armed: boolean;
}

export interface SnapWave {
  uid: number;
  x: number;
  y: number;
  r: number;
  maxR: number;
}

export interface SnapGem {
  uid: number;
  kind: 'xp' | 'scrap' | 'blueprint';
  x: number;
  y: number;
  magnet: boolean;
}

export interface Snapshot {
  tick: number;
  time: number;
  state: 'running' | 'dead' | 'won';
  level: number;
  xp: number;
  kills: number;
  boss: { uid: number; hpRatio: number } | null;
  players: SnapPlayer[];
  enemies: SnapEnemy[];
  projectiles: SnapProj[];
  bolts: SnapBolt[];
  mines: SnapMine[];
  waves: SnapWave[];
  gems: SnapGem[];
}

const ENEMY_STATES = ['seek', 'windup', 'dash', 'recover'] as const;
const TAU = Math.PI * 2;

function clampI16(v: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(v)));
}

class Writer {
  private view: DataView;
  private off = 0;
  readonly buf: ArrayBuffer;

  constructor(capacity: number) {
    this.buf = new ArrayBuffer(capacity);
    this.view = new DataView(this.buf);
  }

  u8(v: number): void {
    this.view.setUint8(this.off, v & 0xff);
    this.off += 1;
  }
  u16(v: number): void {
    this.view.setUint16(this.off, v, true);
    this.off += 2;
  }
  u32(v: number): void {
    this.view.setUint32(this.off, v >>> 0, true);
    this.off += 4;
  }
  i16(v: number): void {
    this.view.setInt16(this.off, clampI16(v), true);
    this.off += 2;
  }
  f32(v: number): void {
    this.view.setFloat32(this.off, v, true);
    this.off += 4;
  }
  get pos(): number {
    return this.off;
  }
  trimmed(): ArrayBuffer {
    return this.buf.slice(0, this.off);
  }
}

class Reader {
  private view: DataView;
  private off = 0;

  constructor(public readonly buf: ArrayBuffer) {
    this.view = new DataView(buf);
  }

  u8(): number {
    const v = this.view.getUint8(this.off);
    this.off += 1;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.off, true);
    this.off += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.off, true);
    this.off += 4;
    return v;
  }
  i16(): number {
    const v = this.view.getInt16(this.off, true);
    this.off += 2;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.off, true);
    this.off += 4;
    return v;
  }
}

function weaponIdx(id: WeaponId): number {
  return WEAPON_IDS.indexOf(id);
}

function enemyIdx(id: EnemyId): number {
  return ENEMY_IDS.indexOf(id);
}

/** Собирает бинарный снапшот состояния симуляции хоста. */
export function encodeSnapshot(sim: RunSim, tick: number): ArrayBuffer {
  const cap =
    40 +
    sim.players.length * 48 +
    sim.enemies.length * 14 +
    sim.projectiles.length * 13 +
    sim.bolts.length * 13 +
    sim.mines.length * 9 +
    sim.shockwaves.length * 13 +
    sim.gems.length * 10;
  const w = new Writer(cap);

  w.u8(PROTOCOL_VERSION);
  w.u32(tick);
  w.f32(sim.time);
  w.u8(sim.state === 'running' ? 0 : sim.state === 'dead' ? 1 : 2);
  w.u8(Math.min(255, sim.level));
  w.u16(Math.round(Math.min(65535, sim.xp * 10)));
  w.u32(sim.kills);

  if (sim.boss) {
    w.u8(1);
    w.u32(sim.boss.uid);
    w.u16(Math.round(Math.max(0, Math.min(65535, (sim.boss.hp / sim.boss.maxHp) * 65535))));
  } else {
    w.u8(0);
  }

  w.u8(sim.players.length);
  for (const p of sim.players) {
    w.u8(p.id);
    w.u8((p.dead ? 1 : 0) | (p.moving ? 2 : 0));
    w.i16(p.x * 100);
    w.i16(p.y * 100);
    w.u16(Math.round(Math.max(0, Math.min(65535, p.hp * 10))));
    w.u16(Math.round(Math.max(0, Math.min(65535, p.maxHp * 10))));
    w.u16(Math.round(p.dashCd * 100));
    w.u16(Math.round(p.shieldCd * 100));
    w.u16(Math.round(p.shieldT * 100));
    w.u8(Math.round(Math.min(255, p.dashT * 200)));
    w.u8(Math.round(Math.min(255, p.iframe * 200)));
    w.u16(Math.round(Math.min(65535, p.scrapCollected)));
    const yaw = Math.atan2(p.facingX, p.facingY);
    w.u16(Math.round(((yaw + Math.PI) / TAU) * 65535));
    w.u8(p.weapons.length);
    for (const wp of p.weapons) {
      w.u8(weaponIdx(wp.id));
      w.u8(wp.level);
      w.u16(Math.round(((wp.angle % TAU + TAU) % TAU / TAU) * 65535));
    }
  }

  w.u16(sim.enemies.length);
  for (const e of sim.enemies) {
    w.u32(e.uid);
    w.u8(enemyIdx(e.def.id));
    w.i16(e.x * 100);
    w.i16(e.y * 100);
    w.u16(Math.round(Math.max(0, Math.min(65535, (e.hp / e.maxHp) * 65535))));
    w.u8(ENEMY_STATES.indexOf(e.state));
    w.u8(Math.round(e.spawnT * 200));
  }

  w.u16(sim.projectiles.length);
  for (const pr of sim.projectiles) {
    w.u32(pr.uid);
    w.u8(pr.kind === 'missile' ? 1 : 0);
    w.i16(pr.x * 100);
    w.i16(pr.y * 100);
    w.i16(pr.vx * 100);
    w.i16(pr.vy * 100);
  }

  w.u16(sim.bolts.length);
  for (const b of sim.bolts) {
    w.u32(b.uid);
    w.i16(b.x * 100);
    w.i16(b.y * 100);
    w.i16(b.vx * 100);
    w.i16(b.vy * 100);
  }

  w.u16(sim.mines.length);
  for (const m of sim.mines) {
    w.u32(m.uid);
    w.i16(m.x * 100);
    w.i16(m.y * 100);
    w.u8(m.armT > 0 ? 0 : 1);
  }

  w.u16(sim.shockwaves.length);
  for (const s of sim.shockwaves) {
    w.u32(s.uid);
    w.i16(s.x * 100);
    w.i16(s.y * 100);
    w.u16(Math.round(Math.min(65535, s.r * 100)));
    w.u16(Math.round(Math.min(65535, s.maxR * 100)));
  }

  w.u16(sim.gems.length);
  for (const g of sim.gems) {
    w.u32(g.uid);
    w.u8(g.kind === 'xp' ? 0 : g.kind === 'scrap' ? 1 : 2);
    w.i16(g.x * 100);
    w.i16(g.y * 100);
    w.u8(g.magnet ? 1 : 0);
  }

  return w.trimmed();
}

/** Восстанавливает снапшот; null при несовпадении версии или битых данных. */
export function decodeSnapshot(data: ArrayBuffer): Snapshot | null {
  try {
    const r = new Reader(data);
    if (r.u8() !== PROTOCOL_VERSION) return null;

    const snap: Snapshot = {
      tick: r.u32(),
      time: r.f32(),
      state: 'running',
      level: 1,
      xp: 0,
      kills: 0,
      boss: null,
      players: [],
      enemies: [],
      projectiles: [],
      bolts: [],
      mines: [],
      waves: [],
      gems: [],
    };
    const stateCode = r.u8();
    snap.state = stateCode === 1 ? 'dead' : stateCode === 2 ? 'won' : 'running';
    snap.level = r.u8();
    snap.xp = r.u16() / 10;

    snap.kills = r.u32();

    if (r.u8() === 1) {
      snap.boss = { uid: r.u32(), hpRatio: r.u16() / 65535 };
    }

    const playerCount = r.u8();
    for (let i = 0; i < playerCount; i++) {
      const pid = r.u8();
      const flags = r.u8();
      const x = r.i16() / 100;
      const y = r.i16() / 100;
      const hp = r.u16() / 10;
      const maxHp = r.u16() / 10;
      const dashCd = r.u16() / 100;
      const shieldCd = r.u16() / 100;
      const shieldT = r.u16() / 100;
      const dashT = r.u8() / 200;
      const iframe = r.u8() / 200;
      const scrap = r.u16();
      const yaw = (r.u16() / 65535) * TAU - Math.PI;
      const weapons: SnapWeapon[] = [];
      const wCount = r.u8();
      for (let j = 0; j < wCount; j++) {
        const wIdx = r.u8();
        const level = r.u8();
        const angle = (r.u16() / 65535) * TAU;
        const id = WEAPON_IDS[wIdx];
        if (id) weapons.push({ id, level, angle });
      }
      snap.players.push({
        pid,
        dead: (flags & 1) !== 0,
        moving: (flags & 2) !== 0,
        x,
        y,
        hp,
        maxHp,
        dashCd,
        shieldCd,
        shieldT,
        dashT,
        iframe,
        scrap,
        facingX: Math.sin(yaw),
        facingY: Math.cos(yaw),
        weapons,
      });
    }

    const enemyCount = r.u16();
    for (let i = 0; i < enemyCount; i++) {
      const uid = r.u32();
      const id = ENEMY_IDS[r.u8()];
      const x = r.i16() / 100;
      const y = r.i16() / 100;
      const ratio = r.u16() / 65535;
      const state = ENEMY_STATES[r.u8()] ?? 'seek';
      const spawnT = r.u8() / 200;
      if (!id) continue;
      const maxHp = Math.round(ENEMIES[id].hp * enemyHpMult(snap.time));
      snap.enemies.push({ uid, id, x, y, hp: maxHp * ratio, maxHp, state, spawnT });
    }

    const projCount = r.u16();
    for (let i = 0; i < projCount; i++) {
      snap.projectiles.push({
        uid: r.u32(),
        kind: r.u8() === 1 ? 'missile' : 'bullet',
        x: r.i16() / 100,
        y: r.i16() / 100,
        vx: r.i16() / 100,
        vy: r.i16() / 100,
      });
    }

    const boltCount = r.u16();
    for (let i = 0; i < boltCount; i++) {
      snap.bolts.push({ uid: r.u32(), x: r.i16() / 100, y: r.i16() / 100, vx: r.i16() / 100, vy: r.i16() / 100 });
    }

    const mineCount = r.u16();
    for (let i = 0; i < mineCount; i++) {
      snap.mines.push({ uid: r.u32(), x: r.i16() / 100, y: r.i16() / 100, armed: r.u8() === 1 });
    }

    const waveCount = r.u16();
    for (let i = 0; i < waveCount; i++) {
      snap.waves.push({ uid: r.u32(), x: r.i16() / 100, y: r.i16() / 100, r: r.u16() / 100, maxR: r.u16() / 100 });
    }

    const gemCount = r.u16();
    for (let i = 0; i < gemCount; i++) {
      const k = r.u8();
      snap.gems.push({
        uid: r.u32(),
        kind: k === 1 ? 'scrap' : k === 2 ? 'blueprint' : 'xp',
        x: r.i16() / 100,
        y: r.i16() / 100,
        magnet: r.u8() === 1,
      });
    }

    return snap;
  } catch {
    return null;
  }
}
