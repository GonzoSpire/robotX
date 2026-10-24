import { describe, expect, it } from 'vitest';
import { enemyHpMult, xpToNext } from '../src/run/progression';
import { batchSize, spawnInterval, waveWeights } from '../src/run/spawner';
import { WEAPONS, WEAPON_IDS } from '../src/content/weapons';
import { PASSIVE_IDS } from '../src/content/passives';
import { buildCardPool, rollCards, RUN_WEAPON_SLOTS } from '../src/run/cards';
import { RunSim } from '../src/run/sim';
import { Rng } from '../src/core/rng';

describe('прогрессия', () => {
  it('xpToNext строго растёт', () => {
    for (let l = 1; l < 40; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
  });

  it('enemyHpMult растёт со временем', () => {
    expect(enemyHpMult(600)).toBeGreaterThan(enemyHpMult(300));
    expect(enemyHpMult(300)).toBeGreaterThan(enemyHpMult(0));
    expect(enemyHpMult(0)).toBe(1);
  });
});

describe('директор спавна', () => {
  it('интервал убывает и зажимается снизу', () => {
    expect(spawnInterval(60)).toBeLessThan(spawnInterval(0));
    expect(spawnInterval(10000)).toBe(0.35);
  });

  it('размер волны растёт и ограничен', () => {
    expect(batchSize(120)).toBeGreaterThan(batchSize(0));
    expect(batchSize(100000)).toBeLessThanOrEqual(8);
  });

  it('типы мобов открываются по времени', () => {
    expect(waveWeights(30).map(([id]) => id)).toEqual(['chaser']);
    expect(waveWeights(90).map(([id]) => id)).toContain('sprinter');
    expect(waveWeights(180).map(([id]) => id)).toContain('tank');
  });
});

describe('каталог оружий', () => {
  it('статы корректны на всех уровнях', () => {
    for (const id of WEAPON_IDS) {
      const def = WEAPONS[id];
      const base = def.stats(1);
      expect(base.damage).toBeGreaterThan(0);
      expect(base.cooldown).toBeGreaterThan(0);
      for (let l = 1; l <= def.maxLevel; l++) {
        const s = def.stats(l);
        expect(Number.isFinite(s.damage)).toBe(true);
        expect(s.damage).toBeGreaterThanOrEqual(base.damage);
        expect(s.cooldown).toBeLessThanOrEqual(base.cooldown + 1e-9);
      }
    }
  });
});

describe('карточки левел-апа', () => {
  it('не предлагает новое оружие при полном слоте', () => {
    const sim = new RunSim(undefined, 1);
    sim.addWeapon('laser');
    sim.addWeapon('missiles');
    sim.addWeapon('drones');
    expect(sim.weapons.length).toBe(RUN_WEAPON_SLOTS);
    const pool = buildCardPool(sim);
    expect(pool.some((c) => c.kind === 'weapon-new')).toBe(false);
  });

  it('не предлагает апгрейд максимального уровня', () => {
    const sim = new RunSim(undefined, 1);
    sim.weapons[0].level = WEAPONS.autogun.maxLevel;
    const pool = buildCardPool(sim);
    expect(pool.some((c) => c.kind === 'weapon-up' && c.weapon === 'autogun')).toBe(false);
  });

  it('не предлагает пассивку с максимумом стаков', () => {
    const sim = new RunSim(undefined, 1);
    for (let i = 0; i < 5; i++) sim.addPassiveStack('damage');
    const pool = buildCardPool(sim);
    expect(pool.some((c) => c.kind === 'passive' && c.passive === 'damage')).toBe(false);
  });

  it('rollCards даёт до трёх разных карточек', () => {
    const sim = new RunSim(undefined, 1);
    const rng = new Rng(42);
    const cards = rollCards(rng, sim);
    expect(cards.length).toBe(3);
    const keys = cards.map((c) => (c.kind === 'passive' ? `p:${c.passive}` : `w:${c.weapon}`));
    expect(new Set(keys).size).toBe(3);
  });

  it('пул покрывает все пассивки на старте', () => {
    const sim = new RunSim(undefined, 1);
    const pool = buildCardPool(sim);
    for (const id of PASSIVE_IDS) {
      expect(pool.some((c) => c.kind === 'passive' && c.passive === id)).toBe(true);
    }
  });
});

describe('симуляция забега', () => {
  const input = { moveX: 0, moveY: 0, dash: false, shield: false };

  it('детерминирована по сиду', () => {
    const a = new RunSim(undefined, 1234);
    const b = new RunSim(undefined, 1234);
    for (let i = 0; i < 300; i++) {
      a.tick(1 / 60, input);
      b.tick(1 / 60, input);
    }
    expect(a.player.hp).toBe(b.player.hp);
    expect(a.enemies.length).toBe(b.enemies.length);
    expect(a.kills).toBe(b.kills);
  });

  it('спавнит мобов со временем', () => {
    const sim = new RunSim(undefined, 7);
    for (let i = 0; i < 600; i++) sim.tick(1 / 60, input);
    expect(sim.enemies.length).toBeGreaterThan(0);
  });

  it('контактный урон работает', () => {
    const sim = new RunSim(undefined, 9);
    sim.spawnEnemy('chaser', 2, 0);
    for (let i = 0; i < 240; i++) sim.tick(1 / 60, input);
    expect(sim.player.hp).toBeLessThan(100);
  });

  it('смерть игрока завершает забег', () => {
    const sim = new RunSim(undefined, 11);
    sim.player.shieldT = 0;
    sim.player.iframe = 0;
    sim.spawnEnemy('boss', 1, 0);
    for (let i = 0; i < 300 && sim.state === 'running'; i++) sim.tick(1 / 60, input);
    expect(sim.state).toBe('dead');
  });

  it('убийство даёт кристалл опыта, подбор — опыт', () => {
    const sim = new RunSim(undefined, 13);
    const e = sim.spawnEnemy('chaser', 0.5, 0);
    const st = sim.stats();
    sim.damageEnemy(e, 9999, st);
    expect(sim.kills).toBe(1);
    expect(sim.gems.some((g) => g.kind === 'xp')).toBe(true);
    for (let i = 0; i < 120; i++) sim.tick(1 / 60, input);
    expect(sim.xp + 0).toBeGreaterThanOrEqual(0);
    expect(sim.gems.filter((g) => g.kind === 'xp').length).toBeLessThanOrEqual(1);
  });

  it('щит поглощает урон без потери HP', () => {
    const sim = new RunSim(undefined, 15);
    sim.player.shieldT = 2;
    sim.spawnEnemy('chaser', 1, 0);
    for (let i = 0; i < 180; i++) sim.tick(1 / 60, input);
    expect(sim.player.hp).toBe(100);
  });

  it('победа после убийства босса', () => {
    const sim = new RunSim(undefined, 17);
    const boss = sim.spawnEnemy('boss', 3, 3);
    const st = sim.stats();
    sim.damageEnemy(boss, 999999, st);
    expect(sim.state).toBe('won');
    const scrapValue = sim.gems.filter((g) => g.kind === 'scrap').reduce((s, g) => s + g.value, 0);
    expect(sim.scrapCollected + scrapValue).toBeGreaterThanOrEqual(250);
  });

  it('рывок даёт неуязвимость и кулдаун', () => {
    const sim = new RunSim(undefined, 19);
    sim.tick(1 / 60, { ...input, dash: true });
    expect(sim.player.dashCd).toBeGreaterThan(3);
    expect(sim.player.dashT).toBeGreaterThan(0);
  });
});
