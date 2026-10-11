/**
 * Игровой цикл с фиксированным шагом симуляции (по умолчанию 60 Гц)
 * и рендером на каждый кадр. Защита от «спирали смерти» и от прыжков
 * после переключения вкладок (dt зажимается).
 */
export class FixedLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;

  constructor(
    private readonly fixedStep: (dt: number) => void,
    private readonly frame: (frameDt: number, wallTime: number) => void,
    private readonly stepHz = 60,
    private readonly maxFrameDt = 0.25,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const step = 1 / this.stepHz;
    const tick = (now: number) => {
      if (!this.running) return;
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > this.maxFrameDt) dt = this.maxFrameDt;
      this.acc += dt;
      let guard = 0;
      while (this.acc >= step && guard < 8) {
        this.fixedStep(step);
        this.acc -= step;
        guard++;
      }
      if (guard >= 8) this.acc = 0; // симуляция не успевает — сбрасываем долг, а не копим
      this.frame(dt, now / 1000);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
