import type { WeaponId } from '../content/weapons';
import { BRAND_LABEL, PART_BY_ID, SET_BONUS, type Brand, type ModuleStats, type PartDef } from './parts';
import { addStats, pilotBonuses } from './pilot';

export interface Loadout {
  chassis: string;
  reactor: string;
  weapons: string[];
  modules: string[];
}

export interface SetInfo {
  brand: Brand;
  count: number;
  active: boolean;
}

/** Развёрнутая сборка: статы забега + диагностика валидности. */
export interface LoadoutStats {
  valid: boolean;
  errors: string[];
  hp: number;
  speed: number;
  pickup: number;
  weaponSlots: number;
  moduleSlots: number;
  weapons: Array<{ id: WeaponId; level: number }>;
  energyUsed: number;
  energyCapacity: number;
  fixed: ModuleStats;
  sets: SetInfo[];
}

export const DEFAULT_OWNED = ['chassis_rust', 'reactor_old', 'wep_autogun'];
export const DEFAULT_BLUEPRINTS = ['mod_target', 'mod_servo'];

export function defaultLoadout(): Loadout {
  return { chassis: 'chassis_rust', reactor: 'reactor_old', weapons: ['wep_autogun'], modules: [] };
}

function def(id: string): PartDef {
  const d = PART_BY_ID[id];
  if (!d) throw new Error(`unknown part: ${id}`);
  return d;
}

export function computeLoadoutStats(loadout: Loadout, pilotRanks: Record<string, number>): LoadoutStats {
  const errors: string[] = [];
  const chassis = def(loadout.chassis);
  const reactor = def(loadout.reactor);
  if (chassis.kind !== 'chassis') errors.push('Шасси не выбрано');
  if (reactor.kind !== 'reactor') errors.push('Реактор не выбран');

  const chassisStats = chassis.chassis ?? { hp: 100, speed: 6, pickup: 1.6, weaponSlots: 3, moduleSlots: 2 };

  // оружие
  const weapons: Array<{ id: WeaponId; level: number }> = [];
  for (const id of loadout.weapons) {
    const p = def(id);
    if (p.kind !== 'weapon' || !p.weapon) {
      errors.push(`${p.name} — не оружейная деталь`);
      continue;
    }
    if (weapons.some((w) => w.id === p.weapon)) errors.push(`${p.name}: дубликат`);
    else weapons.push({ id: p.weapon, level: 1 });
  }
  if (weapons.length === 0) errors.push('Нужно хотя бы одно оружие');
  if (weapons.length > chassisStats.weaponSlots) errors.push(`Шасси вмещает только ${chassisStats.weaponSlots} пушек`);

  // модули
  const moduleDefs: PartDef[] = [];
  for (const id of loadout.modules) {
    const p = def(id);
    if (p.kind !== 'module') {
      errors.push(`${p.name} — не модуль`);
      continue;
    }
    if (moduleDefs.some((m) => m.id === p.id)) errors.push(`${p.name}: дубликат`);
    else moduleDefs.push(p);
  }
  if (moduleDefs.length > chassisStats.moduleSlots) errors.push(`Шасси вмещает только ${chassisStats.moduleSlots} модулей`);

  // энергобюджет: оружие + модули против мощности реактора
  const energyUsed =
    loadout.weapons.reduce((s, id) => s + def(id).energy, 0) + moduleDefs.reduce((s, m) => s + m.energy, 0);
  const energyCapacity = reactor.reactor?.capacity ?? 10;
  const overEnergy = energyUsed > energyCapacity;
  if (overEnergy) errors.push(`Перегрузка реактора: ${energyUsed}/${energyCapacity} энергии`);

  // сет-бонусы: реактор с брендом + модули с брендом
  const brandCounts = new Map<Brand, number>();
  if (reactor.brand) brandCounts.set(reactor.brand, 1);
  for (const m of moduleDefs) if (m.brand) brandCounts.set(m.brand, (brandCounts.get(m.brand) ?? 0) + 1);
  const sets: SetInfo[] = (Object.keys(SET_BONUS) as Brand[]).map((brand) => {
    const count = brandCounts.get(brand) ?? 0;
    return { brand, count, active: count >= 2 };
  });

  // суммарные фиксированные бонусы
  const fixed: ModuleStats = {};
  if (reactor.reactor) {
    addStats(fixed, {
      damagePct: reactor.reactor.damagePct,
      attackSpeedPct: reactor.reactor.attackSpeedPct,
    });
  }
  for (const m of moduleDefs) addStats(fixed, m.module ?? {});
  for (const s of sets) if (s.active) addStats(fixed, SET_BONUS[s.brand].stats);
  addStats(fixed, pilotBonuses(pilotRanks));

  return {
    valid: errors.length === 0,
    errors,
    hp: Math.round((chassisStats.hp + (fixed.hpFlat ?? 0)) * 100) / 100,
    speed: Math.round(chassisStats.speed * (1 + (fixed.moveSpeedPct ?? 0)) * 100) / 100,
    pickup: Math.round(chassisStats.pickup * (1 + (fixed.pickupPct ?? 0)) * 100) / 100,
    weaponSlots: chassisStats.weaponSlots,
    moduleSlots: chassisStats.moduleSlots,
    weapons,
    energyUsed,
    energyCapacity,
    fixed,
    sets,
  };
}

export function setBonusLabel(brand: Brand): string {
  return `${BRAND_LABEL[brand]}: ${SET_BONUS[brand].desc}`;
}

/** Убирает из лоадаута детали, которых больше нет во владении. */
export function sanitizeLoadout(loadout: Loadout, owned: string[]): LoadoutStats {
  const own = new Set(owned);
  const l: Loadout = {
    chassis: own.has(loadout.chassis) ? loadout.chassis : 'chassis_rust',
    reactor: own.has(loadout.reactor) ? loadout.reactor : 'reactor_old',
    weapons: loadout.weapons.filter((id) => own.has(id)),
    modules: loadout.modules.filter((id) => own.has(id)),
  };
  if (l.weapons.length === 0 && own.has('wep_autogun')) l.weapons = ['wep_autogun'];
  return computeLoadoutStats(l, {});
}
