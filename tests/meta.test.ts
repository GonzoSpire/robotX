import { describe, expect, it } from 'vitest';
import { computeLoadoutStats, defaultLoadout, DEFAULT_OWNED } from '../src/meta/loadout';
import { PART_BY_ID, PARTS } from '../src/meta/parts';
import { blueprintDropPool, craftPart, dismantlePart, autoEquip } from '../src/meta/crafting';
import { pilotBonuses, PILOT_NODES } from '../src/meta/pilot';
import { RunSim } from '../src/run/sim';
import { buildCardPool } from '../src/run/cards';

describe('лоадаут и энергобюджет', () => {
  it('дефолтная сборка валидна', () => {
    const stats = computeLoadoutStats(defaultLoadout(), {});
    expect(stats.valid).toBe(true);
    expect(stats.weapons).toEqual([{ id: 'autogun', level: 1 }]);
    expect(stats.hp).toBe(100);
    expect(stats.weaponSlots).toBe(3); // ржавый каркас
  });

  it('перегрузка реактора делает сборку невалидной', () => {
    // ржавый реактор: 10 энергии. 3 пушки (2+3+4=9) + модуль (2) = 11 — перегруз
    const l = defaultLoadout();
    l.weapons = ['wep_autogun', 'wep_laser', 'wep_missiles'];
    l.modules = ['mod_armor'];
    const stats = computeLoadoutStats(l, {});
    expect(stats.valid).toBe(false);
    expect(stats.errors.join(' ')).toContain('Перегрузка');
  });

  it('число оружейных слотов режет лишние пушки', () => {
    const l = defaultLoadout(); // ржавый: 3 слота
    l.weapons = ['wep_autogun', 'wep_laser', 'wep_drones', 'wep_mines'];
    const stats = computeLoadoutStats(l, {});
    expect(stats.valid).toBe(false);
    expect(stats.weapons.length).toBe(4);
  });

  it('модули и реактор дают фиксированные бонусы', () => {
    const l = defaultLoadout();
    l.reactor = 'reactor_fusion'; // +8% урона, 18 энергии, Вектор
    l.modules = ['mod_target', 'mod_amp']; // +6% и +12% урона, оба Вектор
    const stats = computeLoadoutStats(l, {});
    expect(stats.valid).toBe(true);
    // 8 + 6 + 12 = 26% + сет Вектор +8% = 34%
    expect(stats.fixed.damagePct).toBeCloseTo(0.34, 5);
    const vectorSet = stats.sets.find((s) => s.brand === 'vector');
    expect(vectorSet?.active).toBe(true); // реактор + 2 модуля
  });

  it('пилот добавляет бонусы поверх модулей', () => {
    const l = defaultLoadout();
    l.modules = ['mod_armor']; // +20 HP
    const stats = computeLoadoutStats(l, { p_hp: 2 }); // +12 HP за ранг ×2
    expect(stats.hp).toBe(100 + 20 + 24);
  });
});

describe('крафт и разборка', () => {
  it('крафт списывает скрап и убирает чертёж', () => {
    const res = craftPart('mod_amp', 150, [...DEFAULT_OWNED], ['mod_amp']);
    expect(res.result.ok).toBe(true);
    expect(res.scrap).toBe(50);
    expect(res.owned).toContain('mod_amp');
    expect(res.blueprints).not.toContain('mod_amp');
  });

  it('крафт без скрапа/чертежа отклоняется', () => {
    expect(craftPart('mod_amp', 10, [], ['mod_amp']).result.ok).toBe(false);
    expect(craftPart('mod_amp', 1000, [], []).result.ok).toBe(false);
  });

  it('разборка даёт 40% стоимости и запрещена для установленного', () => {
    const owned = [...DEFAULT_OWNED, 'mod_amp'];
    const loadout = defaultLoadout();
    const res = dismantlePart('mod_amp', 0, owned, loadout);
    expect(res.result.ok).toBe(true);
    expect(res.scrap).toBe(Math.round(PART_BY_ID['mod_amp'].craftCost * 0.4));

    loadout.modules = ['mod_amp'];
    expect(dismantlePart('mod_amp', 0, owned, loadout).result.ok).toBe(false);
    expect(dismantlePart('chassis_rust', 0, owned, loadout).result.ok).toBe(false); // starter
  });

  it('пул дропа чертежей исключает имеющееся и стартовое', () => {
    const pool = blueprintDropPool([...DEFAULT_OWNED, 'mod_amp'], ['mod_target']);
    expect(pool).not.toContain('chassis_rust');
    expect(pool).not.toContain('wep_autogun');
    expect(pool).not.toContain('mod_amp');
    expect(pool).not.toContain('mod_target');
    expect(pool.length).toBeGreaterThan(0);
  });

  it('авто-установка занимает свободный слот', () => {
    const l = defaultLoadout(); // 1 пушка из 3
    const withMod = autoEquip(PART_BY_ID['mod_servo'], l, { weaponSlots: 3, moduleSlots: 2 });
    expect(withMod.modules).toContain('mod_servo');
    const full = { ...l, weapons: ['wep_autogun', 'wep_laser', 'wep_drones'] };
    const noSpace = autoEquip(PART_BY_ID['wep_mines'], full, { weaponSlots: 3, moduleSlots: 2 });
    expect(noSpace.weapons.length).toBe(3);
  });
});

describe('пилот', () => {
  it('бонусы суммируются по рангам', () => {
    const b = pilotBonuses({ p_hp: 2, p_dmg: 1 });
    expect(b.hpFlat).toBe(24);
    expect(b.damagePct).toBeCloseTo(0.04, 5);
  });

  it('цены рангов согласованы с maxRank', () => {
    for (const n of PILOT_NODES) expect(n.costs.length).toBe(n.maxRank);
  });
});

describe('старт забега из сборки', () => {
  it('стартовые параметры переносятся в симуляцию', () => {
    const sim = new RunSim(
      { maxHp: 150, speed: 7, pickup: 2.5, weaponSlots: 2, weapons: [{ id: 'laser', level: 3 }], fixed: { damagePct: 0.3 }, blueprintPool: [] },
      42,
    );
    expect(sim.player.maxHp).toBe(150);
    expect(sim.player.hp).toBe(150);
    expect(sim.player.baseSpeed).toBe(7);
    expect(sim.weaponSlots).toBe(2);
    expect(sim.weapons).toEqual([expect.objectContaining({ id: 'laser', level: 3 })]);
    expect(sim.stats().damageMult).toBeCloseTo(1.3, 5);
  });

  it('карточки уважают оружейные слоты шасси', () => {
    const sim = new RunSim({ weaponSlots: 2, weapons: [{ id: 'autogun', level: 1 }, { id: 'laser', level: 1 }] }, 1);
    expect(buildCardPool(sim).some((c) => c.kind === 'weapon-new')).toBe(false);
    const sim3 = new RunSim({ weaponSlots: 3, weapons: [{ id: 'autogun', level: 1 }] }, 1);
    expect(buildCardPool(sim3).some((c) => c.kind === 'weapon-new')).toBe(true);
  });

  it('чертеж падает с босса и подбирается', () => {
    const sim = new RunSim({ blueprintPool: ['mod_armor', 'mod_servo'] }, 5);
    const boss = sim.spawnEnemy('boss', 0.5, 0);
    const st = sim.stats();
    sim.damageEnemy(boss, 9999999, st);
    expect(sim.gems.filter((g) => g.kind === 'blueprint').length).toBe(1);
    expect(sim.state).toBe('won'); // после победы тик заморожен — проверяем подбор вручную
    sim.gems.length = 0;
    sim.gems.push({ uid: 9999, x: 0.3, y: 0, value: 1, kind: 'blueprint', vx: 0, vy: 0, magnet: false, magnetV: 0, dead: false });
    sim.player.x = 0.3;
    sim.player.y = 0;
    sim.state = 'running';
    sim.tick(1 / 60, { moveX: 0, moveY: 0, dash: false, shield: false });
    expect(sim.foundBlueprints.length).toBe(1);
    expect(['mod_armor', 'mod_servo']).toContain(sim.foundBlueprints[0]);
  });
});

describe('каталог деталей', () => {
  it('все детали имеют корректную структуру', () => {
    for (const p of PARTS) {
      expect(p.craftCost).toBeGreaterThan(0);
      expect(p.energy).toBeGreaterThanOrEqual(0);
      if (p.kind === 'weapon') expect(p.weapon).toBeTruthy();
      if (p.kind === 'module') expect(p.module).toBeTruthy();
      if (p.kind === 'chassis') expect(p.chassis).toBeTruthy();
      if (p.kind === 'reactor') expect(p.reactor).toBeTruthy();
    }
  });
});
