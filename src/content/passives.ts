export type PassiveId = 'damage' | 'attackSpeed' | 'moveSpeed' | 'maxHp' | 'pickup' | 'crit' | 'xpGain' | 'area';

export type PassiveStat = PassiveId;

export interface PassiveDef {
  id: PassiveId;
  name: string;
  icon: string;
  desc: string;
  maxStacks: number;
  stat: PassiveStat;
  perStack: number;
}

export const PASSIVES: Record<PassiveId, PassiveDef> = {
  damage: { id: 'damage', name: 'Усилитель привода', icon: '⚙️', desc: '+12% урона', maxStacks: 5, stat: 'damage', perStack: 0.12 },
  attackSpeed: { id: 'attackSpeed', name: 'Перегрузка охлаждения', icon: '⚡', desc: '+10% скорости атаки', maxStacks: 5, stat: 'attackSpeed', perStack: 0.1 },
  moveSpeed: { id: 'moveSpeed', name: 'Сервоприводы', icon: '👟', desc: '+7% скорости бега', maxStacks: 5, stat: 'moveSpeed', perStack: 0.07 },
  maxHp: { id: 'maxHp', name: 'Композитная броня', icon: '🛡️', desc: '+18 макс. HP и лечение', maxStacks: 5, stat: 'maxHp', perStack: 18 },
  pickup: { id: 'pickup', name: 'Магнит', icon: '🧲', desc: '+28% радиуса подбора', maxStacks: 5, stat: 'pickup', perStack: 0.28 },
  crit: { id: 'crit', name: 'Прицельный чип', icon: '💥', desc: '+6% шанса крита (x2)', maxStacks: 5, stat: 'crit', perStack: 0.06 },
  xpGain: { id: 'xpGain', name: 'Нейро-интерфейс', icon: '🧠', desc: '+12% получаемого опыта', maxStacks: 5, stat: 'xpGain', perStack: 0.12 },
  area: { id: 'area', name: 'Резонатор', icon: '🌀', desc: '+12% площади эффектов', maxStacks: 5, stat: 'area', perStack: 0.12 },
};

export const PASSIVE_IDS = Object.keys(PASSIVES) as PassiveId[];
