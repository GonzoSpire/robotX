import { describe, expect, it } from 'vitest';
import { RunSim, type InputSnapshot, type PlayerEntry } from '../src/run/sim';
import { buildCardPool } from '../src/run/cards';
import { xpToNext } from '../src/run/progression';
import {
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
  genRoomCode,
  roomPeerId,
} from '../src/net/protocol';

const idle: InputSnapshot = { moveX: 0, moveY: 0, dash: false, shield: false };

function mpEntries(n: number): PlayerEntry[] {
  const names = ['Альфа', 'Бета', 'Гамма', 'Дельта'];
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: names[i],
    colorIdx: i,
    start: { maxHp: 100, speed: 6, pickup: 1.6, weaponSlots: 4, blueprintPool: [] },
  }));
}

describe('мультиплеерная симуляция', () => {
  it('мобы выбирают ближайшего живого игрока', () => {
    const sim = new RunSim(mpEntries(2), 42);
    const b = sim.players[1];
    b.x = 10;
    b.y = 0;
    const e = sim.spawnEnemy('chaser', 8, 0);
    for (let i = 0; i < 60; i++) sim.tick(1 / 60, [idle, idle]);
    expect(e.x).toBeGreaterThan(8); // пошёл к B, а не к A в нуле
    expect(e.x).toBeLessThan(10 + 1);
  });

  it('гибель одного игрока не заканчивает забег', () => {
    const sim = new RunSim(mpEntries(2), 7);
    sim.damagePlayer(sim.players[1], 9999);
    expect(sim.players[1].dead).toBe(true);
    expect(sim.state).toBe('running');
    for (let i = 0; i < 120; i++) sim.tick(1 / 60, [idle, idle]);
    expect(sim.state).toBe('running');
  });

  it('гибель всех завершает забег поражением', () => {
    const sim = new RunSim(mpEntries(3), 7);
    for (const p of sim.players) sim.damagePlayer(p, 9999);
    expect(sim.state).toBe('dead');
  });

  it('removePlayer убирает отключившегося, забег продолжается', () => {
    const sim = new RunSim(mpEntries(2), 7);
    sim.removePlayer(1);
    expect(sim.players[1].dead).toBe(true);
    expect(sim.state).toBe('running');
  });

  it('общий опыт даёт выбор карточки каждому живому', () => {
    const sim = new RunSim(mpEntries(2), 13);
    const [a, b] = sim.players;
    b.x = -10;
    let need = xpToNext(1);
    while (need > 0) {
      const e = sim.spawnEnemy('chaser', a.x + 0.3, a.y);
      sim.damageEnemy(e, 9999, sim.statsFor(a));
      need -= 1;
    }
    for (let i = 0; i < 200; i++) sim.tick(1 / 60, [idle, idle]);
    expect(sim.level).toBe(2);
    expect(a.pendingLevelUps).toBeGreaterThan(0);
    expect(b.pendingLevelUps).toBeGreaterThan(0);
  });

  it('скрап достается подобравшему игроку', () => {
    const sim = new RunSim(mpEntries(2), 17);
    const [a, b] = sim.players;
    a.x = 10;
    b.x = 0;
    sim.gems.push({
      uid: 9000,
      x: 0.1,
      y: 0,
      value: 5,
      kind: 'scrap',
      vx: 0,
      vy: 0,
      magnet: false,
      magnetTo: -1,
      magnetV: 0,
      dead: false,
    });
    for (let i = 0; i < 240; i++) sim.tick(1 / 60, [idle, idle]);
    expect(b.scrapCollected).toBe(5);
    expect(a.scrapCollected).toBe(0);
  });

  it('карточки считаются по слотам конкретного игрока', () => {
    const sim = new RunSim(
      [
        { id: 0, name: 'A', colorIdx: 0, start: { weaponSlots: 2, weapons: [{ id: 'autogun', level: 1 }, { id: 'laser', level: 1 }] } },
        { id: 1, name: 'B', colorIdx: 1, start: { weaponSlots: 4, weapons: [{ id: 'autogun', level: 1 }] } },
      ],
      1,
    );
    const poolA = buildCardPool(sim, sim.players[0]);
    const poolB = buildCardPool(sim, sim.players[1]);
    expect(poolA.some((c) => c.kind === 'weapon-new')).toBe(false);
    expect(poolB.some((c) => c.kind === 'weapon-new')).toBe(true);
  });

  it('детерминирована по сиду с несколькими игроками', () => {
    const tick = (s: RunSim) => {
      for (let i = 0; i < 300; i++) s.tick(1 / 60, [idle, idle]);
    };
    const a = new RunSim(mpEntries(2), 1234);
    const b = new RunSim(mpEntries(2), 1234);
    tick(a);
    tick(b);
    expect(a.enemies.length).toBe(b.enemies.length);
    expect(a.kills).toBe(b.kills);
    expect(a.players[1].x).toBeCloseTo(b.players[1].x, 5);
  });

  it('болты босса бьют любого игрока', () => {
    const sim = new RunSim(mpEntries(2), 23);
    const [a, b] = sim.players;
    a.x = -5;
    b.x = 5;
    const boss = sim.spawnEnemy('boss', 0, 3);
    boss.bossShotCd = 0.01;
    for (let i = 0; i < 240 && sim.state === 'running'; i++) sim.tick(1 / 60, [idle, idle]);
    const hurt = a.hp < a.maxHp || b.hp < b.maxHp;
    expect(hurt).toBe(true);
  });
});

describe('бинарный протокол', () => {
  it('кодек ввода проходит roundtrip', () => {
    const buf = encodeInput(0.42, -0.75, true, false);
    const inp = decodeInput(buf)!;
    expect(inp.moveX).toBeCloseTo(0.42, 2);
    expect(inp.moveY).toBeCloseTo(-0.75, 2);
    expect(inp.dash).toBe(true);
    expect(inp.shield).toBe(false);
    expect(decodeInput(new ArrayBuffer(3))).toBeNull();
  });

  it('снапшот проходит roundtrip', () => {
    const sim = new RunSim(mpEntries(2), 99);
    sim.players[1].x = 5;
    for (let i = 0; i < 120; i++) sim.tick(1 / 60, [idle, { ...idle, moveX: 1 }]);
    const buf = encodeSnapshot(sim, 777);
    const snap = decodeSnapshot(buf)!;
    expect(snap).not.toBeNull();
    expect(snap.tick).toBe(777);
    expect(snap.kills).toBe(sim.kills);
    expect(snap.players.length).toBe(2);
    expect(snap.players.map((p) => p.pid)).toEqual([0, 1]);
    const p0 = snap.players[0];
    expect(p0.x).toBeCloseTo(sim.players[0].x, 2);
    expect(p0.hp).toBeCloseTo(sim.players[0].hp, 1);
    expect(p0.weapons.length).toBe(sim.players[0].weapons.length);
    expect(snap.enemies.length).toBe(sim.enemies.length);
    if (sim.enemies.length > 0) {
      const e0 = snap.enemies[0];
      expect(e0.x).toBeCloseTo(sim.enemies[0].x, 2);
      expect(e0.hp).toBeCloseTo(sim.enemies[0].hp, 1);
    }
    expect(snap.gems.length).toBe(sim.gems.length);
  });

  it('код комнаты: алфавит без неоднозначных символов', () => {
    expect(genRoomCode(() => 0, 5)).toBe('22222');
    expect(genRoomCode(() => 0.999, 5)).toBe('ZZZZZ');
    for (let i = 0; i < 200; i++) {
      const c = genRoomCode(undefined, 6);
      expect(c).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    }
    expect(roomPeerId('ab12')).toBe('robotx-AB12');
  });
});
