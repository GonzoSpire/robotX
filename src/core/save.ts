const KEY = 'robotx.save.v1';

export interface GameSave {
  version: 1;
  scrap: number;
  totalKills: number;
  totalRuns: number;
  bestTimeSec: number;
  bestKills: number;
  bestLevel: number;
}

export function defaultSave(): GameSave {
  return { version: 1, scrap: 0, totalKills: 0, totalRuns: 0, bestTimeSec: 0, bestKills: 0, bestLevel: 0 };
}

export function loadSave(): GameSave {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw) as Partial<GameSave>;
    return { ...defaultSave(), ...data, version: 1 };
  } catch {
    return defaultSave();
  }
}

export function persistSave(save: GameSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // приватный режим браузера и т.п. — молча играем без сейва
  }
}
