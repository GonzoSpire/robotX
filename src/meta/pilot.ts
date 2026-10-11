import type { ModuleStats } from './parts';

export interface PilotNodeDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  maxRank: number;
  /** Цена рангов по порядку (в скрапе). */
  costs: number[];
  statsPerRank: ModuleStats;
}

/** Дерево пилота: плоское, покупается за скрап, эффекты постоянные. */
export const PILOT_NODES: PilotNodeDef[] = [
  {
    id: 'p_hp',
    name: 'Стойкость рамы',
    icon: '🩹',
    desc: '+12 HP за ранг',
    maxRank: 3,
    costs: [30, 60, 120],
    statsPerRank: { hpFlat: 12 },
  },
  {
    id: 'p_dmg',
    name: 'Боевые протоколы',
    icon: '⚔️',
    desc: '+4% урона за ранг',
    maxRank: 3,
    costs: [35, 70, 140],
    statsPerRank: { damagePct: 0.04 },
  },
  {
    id: 'p_spd',
    name: 'Рефлексы',
    icon: '👟',
    desc: '+3% скорости за ранг',
    maxRank: 3,
    costs: [30, 60, 120],
    statsPerRank: { moveSpeedPct: 0.03 },
  },
  {
    id: 'p_pickup',
    name: 'Тягач',
    icon: '🧲',
    desc: '+12% подбора за ранг',
    maxRank: 2,
    costs: [25, 50],
    statsPerRank: { pickupPct: 0.12 },
  },
  {
    id: 'p_xp',
    name: 'Обучаемость',
    icon: '📚',
    desc: '+5% опыта за ранг',
    maxRank: 2,
    costs: [40, 80],
    statsPerRank: { xpPct: 0.05 },
  },
  {
    id: 'p_scrap',
    name: 'Мародёр',
    icon: '⚙️',
    desc: '+10% скрапа за ранг',
    maxRank: 2,
    costs: [40, 80],
    statsPerRank: { scrapPct: 0.1 },
  },
];

export const PILOT_BY_ID: Record<string, PilotNodeDef> = Object.fromEntries(PILOT_NODES.map((n) => [n.id, n]));

/** Суммарные бонусы пилота по купленным рангам. */
export function pilotBonuses(ranks: Record<string, number>): ModuleStats {
  const total: ModuleStats = {};
  for (const node of PILOT_NODES) {
    const rank = ranks[node.id] ?? 0;
    for (let i = 0; i < rank; i++) {
      addStats(total, node.statsPerRank);
    }
  }
  return total;
}

export function addStats(target: ModuleStats, add: ModuleStats): void {
  target.hpFlat = (target.hpFlat ?? 0) + (add.hpFlat ?? 0);
  target.damagePct = (target.damagePct ?? 0) + (add.damagePct ?? 0);
  target.attackSpeedPct = (target.attackSpeedPct ?? 0) + (add.attackSpeedPct ?? 0);
  target.moveSpeedPct = (target.moveSpeedPct ?? 0) + (add.moveSpeedPct ?? 0);
  target.pickupPct = (target.pickupPct ?? 0) + (add.pickupPct ?? 0);
  target.xpPct = (target.xpPct ?? 0) + (add.xpPct ?? 0);
  target.critChance = (target.critChance ?? 0) + (add.critChance ?? 0);
  target.areaPct = (target.areaPct ?? 0) + (add.areaPct ?? 0);
  target.scrapPct = (target.scrapPct ?? 0) + (add.scrapPct ?? 0);
}
