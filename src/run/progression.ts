/** Опыт до следующего уровня. Растёт мягко-квадратично, тестируется. */
export function xpToNext(level: number): number {
  return Math.round(5 + level * 2 + level * level * 0.2);
}

/** Множитель HP мобов от времени забега: 1x на старте, ~4.5x к 10-й минуте. */
export function enemyHpMult(timeSec: number): number {
  const t = timeSec / 60;
  return 1 + t / 5 + (t / 10) * (t / 10) * 1.5;
}
