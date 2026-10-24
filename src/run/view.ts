import type { Enemy, EnemyBolt, Gem, Mine, Player, Projectile, Shockwave } from './sim';

/** Цвета игроков по colorIdx: бирюза, оранж, фиолет, золото. */
export const PLAYER_ACCENTS = [0x3ef0d0, 0xff9e3d, 0xc06bff, 0xffe14d] as const;

/**
 * Минимальное состояние, которое читают рендер и HUD.
 * Ему удовлетворяют и RunSim (хост/соло), и ClientRunView (клиент).
 */
export interface RunView {
  time: number;
  state: 'running' | 'dead' | 'won';
  kills: number;
  /** Командный уровень/опыт. */
  level: number;
  xp: number;
  players: Player[];
  /** Локальный игрок (кто управляет камерой/HUD). */
  player: Player;
  enemies: Enemy[];
  projectiles: Projectile[];
  bolts: EnemyBolt[];
  mines: Mine[];
  shockwaves: Shockwave[];
  gems: Gem[];
  boss: Enemy | null;
}
