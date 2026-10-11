import { Rng } from '../core/rng';
import { PASSIVES, PASSIVE_IDS, type PassiveId } from '../content/passives';
import { WEAPONS, WEAPON_IDS, type WeaponId } from '../content/weapons';
import type { RunSim } from './sim';

export type Card =
  | { kind: 'weapon-new'; weapon: WeaponId }
  | { kind: 'weapon-up'; weapon: WeaponId }
  | { kind: 'passive'; passive: PassiveId };

/** Лимит оружий в забеге по умолчанию; реальный лимит задаёт шасси (sim.weaponSlots). */
export const RUN_WEAPON_SLOTS = 4;

export function buildCardPool(sim: RunSim): Card[] {
  const pool: Card[] = [];
  const owned = new Map(sim.weapons.map((w) => [w.id, w.level]));

  if (sim.weapons.length < sim.weaponSlots) {
    for (const id of WEAPON_IDS) if (!owned.has(id)) pool.push({ kind: 'weapon-new', weapon: id });
  }
  for (const [id, level] of owned) {
    if (level < WEAPONS[id].maxLevel) pool.push({ kind: 'weapon-up', weapon: id });
  }
  for (const id of PASSIVE_IDS) {
    if ((sim.passiveStacks[id] ?? 0) < PASSIVES[id].maxStacks) pool.push({ kind: 'passive', passive: id });
  }
  return pool;
}

/** До трёх разных карточек. */
export function rollCards(rng: Rng, sim: RunSim): Card[] {
  const pool = buildCardPool(sim);
  const picked: Card[] = [];
  while (picked.length < 3 && pool.length > 0) {
    const i = rng.int(pool.length);
    picked.push(pool[i]);
    pool.splice(i, 1);
  }
  return picked;
}

export function applyCard(sim: RunSim, card: Card): void {
  switch (card.kind) {
    case 'weapon-new':
      sim.addWeapon(card.weapon);
      break;
    case 'weapon-up': {
      const w = sim.weapons.find((x) => x.id === card.weapon);
      if (w) w.level = Math.min(WEAPONS[card.weapon].maxLevel, w.level + 1);
      break;
    }
    case 'passive':
      sim.addPassiveStack(card.passive);
      break;
  }
}

export function cardTitle(card: Card, sim: RunSim): string {
  switch (card.kind) {
    case 'weapon-new':
      return `НОВОЕ · ${WEAPONS[card.weapon].name}`;
    case 'weapon-up': {
      const lvl = sim.weapons.find((x) => x.id === card.weapon)?.level ?? 1;
      return `${WEAPONS[card.weapon].name} · ур. ${lvl} → ${lvl + 1}`;
    }
    case 'passive': {
      const stacks = (sim.passiveStacks[card.passive] ?? 0) + 1;
      return `${PASSIVES[card.passive].name} · ${stacks}/5`;
    }
  }
}

export function cardDesc(card: Card): string {
  switch (card.kind) {
    case 'weapon-new':
    case 'weapon-up': {
      const def = WEAPONS[card.weapon];
      return def.desc;
    }
    case 'passive':
      return PASSIVES[card.passive].desc;
  }
}

export function cardIcon(card: Card): string {
  switch (card.kind) {
    case 'weapon-new':
    case 'weapon-up':
      return WEAPONS[card.weapon].icon;
    case 'passive':
      return PASSIVES[card.passive].icon;
  }
}
