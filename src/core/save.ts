import { DEFAULT_BLUEPRINTS, DEFAULT_OWNED, defaultLoadout, sanitizeLoadout, type Loadout } from '../meta/loadout';

const KEY_V2 = 'robotx.save.v2';
const KEY_V1 = 'robotx.save.v1';

export interface GameSave {
  version: 2;
  scrap: number;
  totalKills: number;
  totalRuns: number;
  bestTimeSec: number;
  bestKills: number;
  bestLevel: number;
  /** id деталей во владении (у каждой — один экземпляр). */
  owned: string[];
  /** id деталей, доступных к крафту. */
  blueprints: string[];
  loadout: Loadout;
  /** ранги узлов дерева пилота. */
  pilot: Record<string, number>;
}

export function defaultSave(): GameSave {
  return {
    version: 2,
    scrap: 0,
    totalKills: 0,
    totalRuns: 0,
    bestTimeSec: 0,
    bestKills: 0,
    bestLevel: 0,
    owned: [...DEFAULT_OWNED],
    blueprints: [...DEFAULT_BLUEPRINTS],
    loadout: defaultLoadout(),
    pilot: {},
  };
}

function migrateV1(rawV1: Record<string, unknown>): GameSave {
  const base = defaultSave();
  return {
    ...base,
    scrap: typeof rawV1.scrap === 'number' ? rawV1.scrap : 0,
    totalKills: typeof rawV1.totalKills === 'number' ? rawV1.totalKills : 0,
    totalRuns: typeof rawV1.totalRuns === 'number' ? rawV1.totalRuns : 0,
    bestTimeSec: typeof rawV1.bestTimeSec === 'number' ? rawV1.bestTimeSec : 0,
    bestKills: typeof rawV1.bestKills === 'number' ? rawV1.bestKills : 0,
    bestLevel: typeof rawV1.bestLevel === 'number' ? rawV1.bestLevel : 0,
  };
}

export function loadSave(): GameSave {
  try {
    const raw = localStorage.getItem(KEY_V2);
    if (!raw) {
      const old = localStorage.getItem(KEY_V1);
      if (old) return migrateV1(JSON.parse(old) as Record<string, unknown>);
      return defaultSave();
    }
    const data = JSON.parse(raw) as Partial<GameSave>;
    const save: GameSave = { ...defaultSave(), ...data, version: 2 };
    // защита от битых состояний
    save.owned = save.owned.filter((id, i) => save.owned.indexOf(id) === i);
    save.blueprints = save.blueprints.filter((id, i) => save.blueprints.indexOf(id) === i);
    sanitizeLoadout(save.loadout, save.owned);
    return save;
  } catch {
    return defaultSave();
  }
}

export function persistSave(save: GameSave): void {
  try {
    localStorage.setItem(KEY_V2, JSON.stringify(save));
  } catch {
    // приватный режим браузера и т.п. — играем без сейва
  }
}
