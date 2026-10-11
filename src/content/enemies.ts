export type EnemyId = 'chaser' | 'sprinter' | 'tank' | 'boss';
export type EnemyBehavior = 'chaser' | 'sprinter' | 'tank' | 'boss';

export interface EnemyDef {
  id: EnemyId;
  name: string;
  behavior: EnemyBehavior;
  hp: number;
  speed: number;
  radius: number;
  contactDamage: number;
  attackCooldown: number;
  xp: number;
  color: number;
  accent: number;
  scrapChance: number;
  scrapAmount: number;
}

export const ENEMIES: Record<EnemyId, EnemyDef> = {
  chaser: {
    id: 'chaser',
    name: 'Гончая',
    behavior: 'chaser',
    hp: 26,
    speed: 2.3,
    radius: 0.55,
    contactDamage: 6,
    attackCooldown: 0.9,
    xp: 1,
    color: 0x9c5656,
    accent: 0xff5a5a,
    scrapChance: 0.08,
    scrapAmount: 1,
  },
  sprinter: {
    id: 'sprinter',
    name: 'Спринтер',
    behavior: 'sprinter',
    hp: 13,
    speed: 3.1,
    radius: 0.45,
    contactDamage: 5,
    attackCooldown: 1.2,
    xp: 1,
    color: 0xa07a3f,
    accent: 0xffb03e,
    scrapChance: 0.08,
    scrapAmount: 1,
  },
  tank: {
    id: 'tank',
    name: 'Голем',
    behavior: 'tank',
    hp: 130,
    speed: 1.05,
    radius: 0.95,
    contactDamage: 12,
    attackCooldown: 1.1,
    xp: 5,
    color: 0x705894,
    accent: 0xb06bff,
    scrapChance: 1,
    scrapAmount: 4,
  },
  boss: {
    id: 'boss',
    name: 'Ядро-Титан',
    behavior: 'boss',
    hp: 2000,
    speed: 1.6,
    radius: 1.8,
    contactDamage: 25,
    attackCooldown: 1.0,
    xp: 100,
    color: 0x8a2c3c,
    accent: 0xff3b4e,
    scrapChance: 1,
    scrapAmount: 250,
  },
};
