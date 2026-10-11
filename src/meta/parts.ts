import type { WeaponId } from '../content/weapons';
import { WEAPONS } from '../content/weapons';

export type PartKind = 'chassis' | 'reactor' | 'weapon' | 'module';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type Brand = 'vector' | 'cryogen' | 'helios';

export interface ChassisStats {
  hp: number;
  speed: number;
  pickup: number;
  weaponSlots: number;
  moduleSlots: number;
}

export interface ReactorStats {
  capacity: number;
  damagePct?: number;
  attackSpeedPct?: number;
}

/** Готовые аддитивные прибавки от модулей/реактора/сетов/пилота (не карточек). */
export interface ModuleStats {
  hpFlat?: number;
  damagePct?: number;
  attackSpeedPct?: number;
  moveSpeedPct?: number;
  pickupPct?: number;
  xpPct?: number;
  critChance?: number;
  areaPct?: number;
  scrapPct?: number;
}

export interface PartDef {
  id: string;
  kind: PartKind;
  name: string;
  icon: string;
  desc: string;
  rarity: Rarity;
  brand?: Brand;
  /** Потребление энергии (для оружия и модулей). */
  energy: number;
  craftCost: number;
  starter?: boolean;
  chassis?: ChassisStats;
  reactor?: ReactorStats;
  module?: ModuleStats;
  weapon?: WeaponId;
}

export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Обычная',
  uncommon: 'Необычная',
  rare: 'Редкая',
  epic: 'Эпическая',
  legendary: 'Легендарная',
};

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#9aa7b5',
  uncommon: '#4caf7d',
  rare: '#4da3ff',
  epic: '#b06bff',
  legendary: '#ffb03e',
};

export const BRAND_LABEL: Record<Brand, string> = {
  vector: 'Вектор',
  cryogen: 'Криоген',
  helios: 'Гелиос',
};

/** Сет-бонусы: 2+ детали одного бренда среди реактора и модулей. */
export const SET_BONUS: Record<Brand, { name: string; desc: string; stats: ModuleStats }> = {
  vector: { name: 'Протокол «Вектор»', desc: '+8% урона', stats: { damagePct: 0.08 } },
  cryogen: { name: 'Контур «Криоген»', desc: '+7% скорости', stats: { moveSpeedPct: 0.07 } },
  helios: { name: 'Синдикат «Гелиос»', desc: '+8% опыта', stats: { xpPct: 0.08 } },
};

function weaponPart(id: string, weapon: WeaponId, energy: number): PartDef {
  const def = WEAPONS[weapon];
  return {
    id,
    kind: 'weapon',
    name: def.name,
    icon: def.icon,
    desc: def.desc,
    rarity: 'common',
    energy,
    craftCost: 60,
    weapon,
  };
}

export const PARTS: PartDef[] = [
  // ---------- шасси ----------
  {
    id: 'chassis_rust',
    kind: 'chassis',
    name: 'Ржавый каркас',
    icon: '🦴',
    desc: 'Верная рухляшь с свалки. 3 пушки, 2 модуля.',
    rarity: 'common',
    energy: 0,
    craftCost: 40,
    starter: true,
    chassis: { hp: 100, speed: 6.0, pickup: 1.6, weaponSlots: 3, moduleSlots: 2 },
  },
  {
    id: 'chassis_scout',
    kind: 'chassis',
    name: 'Разведчик',
    icon: '🛴',
    desc: 'Быстрый и цепкий: 2 пушки, 3 модуля.',
    rarity: 'uncommon',
    energy: 0,
    craftCost: 90,
    chassis: { hp: 80, speed: 7.2, pickup: 2.0, weaponSlots: 2, moduleSlots: 3 },
  },
  {
    id: 'chassis_vanguard',
    kind: 'chassis',
    name: 'Авангард',
    icon: '🛡️',
    desc: 'Универсальная рама: 3 пушки, 3 модуля.',
    rarity: 'rare',
    energy: 0,
    craftCost: 200,
    chassis: { hp: 130, speed: 6.2, pickup: 1.7, weaponSlots: 3, moduleSlots: 3 },
  },
  {
    id: 'chassis_fortress',
    kind: 'chassis',
    name: 'Крепость',
    icon: '🏰',
    desc: 'Тяжёлая платформа: 4 пушки, 2 модуля.',
    rarity: 'epic',
    energy: 0,
    craftCost: 400,
    chassis: { hp: 170, speed: 5.2, pickup: 1.6, weaponSlots: 4, moduleSlots: 2 },
  },
  {
    id: 'chassis_titan',
    kind: 'chassis',
    name: 'Титан',
    icon: '🗿',
    desc: 'Легендарная рама: 4 пушки, 4 модуля.',
    rarity: 'legendary',
    energy: 0,
    craftCost: 800,
    chassis: { hp: 200, speed: 5.6, pickup: 1.8, weaponSlots: 4, moduleSlots: 4 },
  },

  // ---------- реакторы ----------
  {
    id: 'reactor_old',
    kind: 'reactor',
    name: 'Старый реактор',
    icon: '🔋',
    desc: '10 энергии. Работает. Иногда.',
    rarity: 'common',
    energy: 0,
    craftCost: 40,
    starter: true,
    reactor: { capacity: 10 },
  },
  {
    id: 'reactor_fission',
    kind: 'reactor',
    name: 'Деление',
    icon: '⚛️',
    desc: '14 энергии, +5% скорости атаки.',
    rarity: 'uncommon',
    brand: 'helios',
    energy: 0,
    craftCost: 90,
    reactor: { capacity: 14, attackSpeedPct: 0.05 },
  },
  {
    id: 'reactor_fusion',
    kind: 'reactor',
    name: 'Синтез',
    icon: '☀️',
    desc: '18 энергии, +8% урона.',
    rarity: 'rare',
    brand: 'vector',
    energy: 0,
    craftCost: 200,
    reactor: { capacity: 18, damagePct: 0.08 },
  },
  {
    id: 'reactor_antimatter',
    kind: 'reactor',
    name: 'Антивещество',
    icon: '💠',
    desc: '24 энергии, +8% урона и атаки.',
    rarity: 'epic',
    brand: 'vector',
    energy: 0,
    craftCost: 400,
    reactor: { capacity: 24, damagePct: 0.08, attackSpeedPct: 0.08 },
  },

  // ---------- оружейные детали ----------
  { ...weaponPart('wep_autogun', 'autogun', 2), starter: true, craftCost: 40 },
  weaponPart('wep_laser', 'laser', 3),
  weaponPart('wep_missiles', 'missiles', 4),
  weaponPart('wep_drones', 'drones', 3),
  weaponPart('wep_shockwave', 'shockwave', 3),
  weaponPart('wep_flame', 'flame', 2),
  weaponPart('wep_mines', 'mines', 2),

  // ---------- модули ----------
  {
    id: 'mod_armor',
    kind: 'module',
    name: 'Бронеплита',
    icon: '🔧',
    desc: '+20 HP',
    rarity: 'common',
    brand: 'cryogen',
    energy: 2,
    craftCost: 50,
    module: { hpFlat: 20 },
  },
  {
    id: 'mod_servo',
    kind: 'module',
    name: 'Сервопривод',
    icon: '⚡',
    desc: '+5% скорости',
    rarity: 'common',
    brand: 'cryogen',
    energy: 2,
    craftCost: 50,
    module: { moveSpeedPct: 0.05 },
  },
  {
    id: 'mod_target',
    kind: 'module',
    name: 'Матрица наведения',
    icon: '🎯',
    desc: '+6% урона',
    rarity: 'common',
    brand: 'vector',
    energy: 2,
    craftCost: 50,
    module: { damagePct: 0.06 },
  },
  {
    id: 'mod_lens',
    kind: 'module',
    name: 'Линза сбора',
    icon: '🔍',
    desc: '+25% подбора',
    rarity: 'common',
    brand: 'helios',
    energy: 2,
    craftCost: 50,
    module: { pickupPct: 0.25 },
  },
  {
    id: 'mod_plate',
    kind: 'module',
    name: 'Композитная броня',
    icon: '🛠️',
    desc: '+40 HP',
    rarity: 'uncommon',
    brand: 'cryogen',
    energy: 3,
    craftCost: 100,
    module: { hpFlat: 40 },
  },
  {
    id: 'mod_cooler',
    kind: 'module',
    name: 'Криокулер',
    icon: '❄️',
    desc: '+10% скорости атаки',
    rarity: 'uncommon',
    brand: 'cryogen',
    energy: 3,
    craftCost: 100,
    module: { attackSpeedPct: 0.1 },
  },
  {
    id: 'mod_amp',
    kind: 'module',
    name: 'Усилитель сигнала',
    icon: '📡',
    desc: '+12% урона',
    rarity: 'uncommon',
    brand: 'vector',
    energy: 3,
    craftCost: 100,
    module: { damagePct: 0.12 },
  },
  {
    id: 'mod_neuro',
    kind: 'module',
    name: 'Нейролинк',
    icon: '🧠',
    desc: '+10% опыта',
    rarity: 'uncommon',
    brand: 'helios',
    energy: 3,
    craftCost: 100,
    module: { xpPct: 0.1 },
  },
  {
    id: 'mod_reson',
    kind: 'module',
    name: 'Резонатор поля',
    icon: '🌀',
    desc: '+15% площади эффектов',
    rarity: 'rare',
    brand: 'helios',
    energy: 4,
    craftCost: 220,
    module: { areaPct: 0.15 },
  },
  {
    id: 'mod_aim',
    kind: 'module',
    name: 'Прицел «Око»',
    icon: '👁️',
    desc: '+6% шанса крита',
    rarity: 'rare',
    brand: 'vector',
    energy: 4,
    craftCost: 220,
    module: { critChance: 0.06 },
  },
  {
    id: 'mod_overdrive',
    kind: 'module',
    name: 'Овердрайв',
    icon: '💥',
    desc: '+18% урона',
    rarity: 'epic',
    brand: 'vector',
    energy: 5,
    craftCost: 420,
    module: { damagePct: 0.18 },
  },
  {
    id: 'mod_nexus',
    kind: 'module',
    name: 'Нексус-ядро',
    icon: '🔷',
    desc: '+15% опыта, +10% подбора',
    rarity: 'epic',
    brand: 'helios',
    energy: 5,
    craftCost: 420,
    module: { xpPct: 0.15, pickupPct: 0.1 },
  },
];

export const PART_BY_ID: Record<string, PartDef> = Object.fromEntries(PARTS.map((p) => [p.id, p]));

export function partsOfKind(kind: PartKind): PartDef[] {
  return PARTS.filter((p) => p.kind === kind);
}

/** Крафт даёт 40% стоимости скрапом. */
export function dismantleValue(part: PartDef): number {
  return Math.round(part.craftCost * 0.4);
}
