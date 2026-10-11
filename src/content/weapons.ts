export type WeaponId = 'autogun' | 'laser' | 'missiles' | 'drones' | 'shockwave' | 'flame' | 'mines';

/** Статы оружия на данном уровне (1..maxLevel). */
export interface WeaponStats {
  damage: number;
  cooldown: number;
  /** Снаряды/залп/дроны/мины за выстрел. */
  count: number;
  /** Уникальных целей на пробой (пули) или дальность действия. */
  pierce: number;
  range: number;
  /** Радиус области (взрыв/кольцо/конус). */
  area: number;
  /** Скорость снаряда. */
  speed: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  icon: string;
  desc: string;
  maxLevel: number;
  stats: (level: number) => WeaponStats;
}

const st = (o: Partial<WeaponStats>): WeaponStats => ({
  damage: 0,
  cooldown: 0,
  count: 1,
  pierce: 0,
  range: 0,
  area: 0,
  speed: 0,
  ...o,
});

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  autogun: {
    id: 'autogun',
    name: 'Автопушка',
    icon: '🔫',
    desc: 'Стреляет очередями по ближайшей цели.',
    maxLevel: 8,
    stats: (l) =>
      st({
        damage: 9 + 3 * (l - 1),
        cooldown: 0.44 * (1 - 0.04 * (l - 1)),
        count: 1 + Math.floor(l / 3),
        pierce: Math.floor(l / 4),
        range: 13,
        speed: 20,
      }),
  },
  laser: {
    id: 'laser',
    name: 'Лазерный резак',
    icon: '🔆',
    desc: 'Луч бьёт всех врагов в линии.',
    maxLevel: 8,
    stats: (l) =>
      st({
        damage: 6 + 2 * l,
        cooldown: 0.5 * (1 - 0.05 * (l - 1)),
        range: 9 + 0.6 * l,
        area: 0.5 + 0.07 * l,
      }),
  },
  missiles: {
    id: 'missiles',
    name: 'Ракеты',
    icon: '🚀',
    desc: 'Самонаводящиеся ракеты со взрывом по площади.',
    maxLevel: 8,
    stats: (l) =>
      st({
        damage: 16 + 6 * l,
        cooldown: 2.4 - 0.12 * l,
        count: 1 + Math.floor(l / 2),
        area: 1.6 + 0.12 * l,
        speed: 9.5,
      }),
  },
  drones: {
    id: 'drones',
    name: 'Дроны',
    icon: '🛸',
    desc: 'Орбитальные дроны рассекают всё вокруг.',
    maxLevel: 8,
    stats: (l) =>
      st({
        damage: 8 + 3 * l,
        cooldown: 0.55, // кулдаун удара дрона по одной цели
        count: 1 + Math.floor(l / 2),
        range: 2.3 + 0.1 * l, // радиус орбиты
        area: 0.45, // радиус тела дрона
        speed: 2.4, // угловая скорость
      }),
  },
  shockwave: {
    id: 'shockwave',
    name: 'Шокволна',
    icon: '💫',
    desc: 'Кольцевой разряд вокруг робота.',
    maxLevel: 8,
    stats: (l) =>
      st({
        damage: 13 + 5 * l,
        cooldown: 3.2 - 0.15 * l,
        range: 4.6 + 0.5 * l,
        speed: 11, // скорость расширения кольца
      }),
  },
  flame: {
    id: 'flame',
    name: 'Огнемёт',
    icon: '🔥',
    desc: 'Конус огня перед роботом.',
    maxLevel: 8,
    stats: (l) =>
      st({
        damage: 3 + 1.2 * l,
        cooldown: 0.22,
        range: 3.6 + 0.3 * l,
        area: 0.5, // полуугол конуса, рад
      }),
  },
  mines: {
    id: 'mines',
    name: 'Мины',
    icon: '💣',
    desc: 'Сбрасывает мины под собой.',
    maxLevel: 8,
    stats: (l) =>
      st({
        damage: 24 + 9 * l,
        cooldown: 2.6 - 0.13 * l,
        count: 1 + Math.floor(l / 3),
        area: 1.9, // радиус взрыва
        range: 1.15, // радиус срабатывания
      }),
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
