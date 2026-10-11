import { PART_BY_ID, PARTS, dismantleValue, type PartDef } from './parts';
import type { Loadout } from './loadout';

/** Пул чертежей для дропа: не starter, ещё не во владении и не открыты чертежом. */
export function blueprintDropPool(owned: string[], blueprints: string[]): string[] {
  const have = new Set([...owned, ...blueprints]);
  return PARTS.filter((p) => !p.starter && !have.has(p.id)).map((p) => p.id);
}

export interface CraftResult {
  ok: boolean;
  reason?: string;
}

/** Крафт по чертежу за скрап. Возвращает изменённые поля сейва. */
export function craftPart(
  partId: string,
  scrap: number,
  owned: string[],
  blueprints: string[],
): { result: CraftResult; scrap: number; owned: string[]; blueprints: string[] } {
  const part = PART_BY_ID[partId];
  if (!part) return { result: { ok: false, reason: 'Неизвестная деталь' }, scrap, owned, blueprints };
  if (owned.includes(partId)) return { result: { ok: false, reason: 'Уже есть' }, scrap, owned, blueprints };
  if (part.starter) return { result: { ok: false, reason: 'Стартовая деталь' }, scrap, owned, blueprints };
  if (!blueprints.includes(partId)) return { result: { ok: false, reason: 'Нет чертежа' }, scrap, owned, blueprints };
  if (scrap < part.craftCost) return { result: { ok: false, reason: 'Не хватает скрапа' }, scrap, owned, blueprints };
  return {
    result: { ok: true },
    scrap: scrap - part.craftCost,
    owned: [...owned, partId],
    blueprints: blueprints.filter((id) => id !== partId),
  };
}

/** Разборка: скрап обратно, деталь исчезает. Запрещена для деталей в лоадауте. */
export function dismantlePart(
  partId: string,
  scrap: number,
  owned: string[],
  loadout: Loadout,
): { result: CraftResult; scrap: number; owned: string[] } {
  const part = PART_BY_ID[partId];
  if (!part || !owned.includes(partId)) return { result: { ok: false, reason: 'Детали нет' }, scrap, owned };
  const inLoadout =
    loadout.chassis === partId ||
    loadout.reactor === partId ||
    loadout.weapons.includes(partId) ||
    loadout.modules.includes(partId);
  if (inLoadout) return { result: { ok: false, reason: 'Сначала снимите с робота' }, scrap, owned };
  if (part.starter) return { result: { ok: false, reason: 'Стартовую нельзя' }, scrap, owned };
  return {
    result: { ok: true },
    scrap: scrap + dismantleValue(part),
    owned: owned.filter((id) => id !== partId),
  };
}

/** Авто-установка свежескрафченной детали в свободный слот. */
export function autoEquip(part: PartDef, loadout: Loadout, capacity: { weaponSlots: number; moduleSlots: number }): Loadout {
  if (part.kind === 'weapon' && loadout.weapons.length < capacity.weaponSlots && !loadout.weapons.includes(part.id)) {
    return { ...loadout, weapons: [...loadout.weapons, part.id] };
  }
  if (part.kind === 'module' && loadout.modules.length < capacity.moduleSlots && !loadout.modules.includes(part.id)) {
    return { ...loadout, modules: [...loadout.modules, part.id] };
  }
  return loadout;
}
