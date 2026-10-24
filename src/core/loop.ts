/**
 * Игровой цикл с фиксированным шагом симуляции (по умолчанию 60 Гц) и рендером
 * на каждый кадр. Фиксированные тики гоняет Web Worker: его таймеры не
 * троттлятся в фоновой вкладке, поэтому хост сетевого забега продолжает
 * симулировать и рассылать снапшоты, даже когда его вкладка не активна.
 * Рендер остаётся на requestAnimationFrame (в фоне просто замирает).
 */
export class FixedLoop {
  private raf = 0;
  private acc = 0;
  private running = false;
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private lastPump = 0;
  private lastRender = 0;

  constructor(
    private readonly fixedStep: (dt: number) => void,
    private readonly frame: (frameDt: number, wallTime: number) => void,
    private readonly stepHz = 60,
    private readonly maxFrameDt = 0.25,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastPump = performance.now();
    this.lastRender = this.lastPump;

    // рендер — на rAF
    const render = (now: number) => {
      if (!this.running) return;
      let dt = (now - this.lastRender) / 1000;
      this.lastRender = now;
      if (dt > this.maxFrameDt) dt = this.maxFrameDt;
      this.frame(dt, now / 1000);
      this.raf = requestAnimationFrame(render);
    };
    this.raf = requestAnimationFrame(render);

    // симуляция — на heartbeat из воркера
    const src = 'setInterval(()=>postMessage(0),16)';
    this.workerUrl = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    this.worker = new Worker(this.workerUrl);
    this.worker.onmessage = () => this.pump();
  }

  private pump(): void {
    if (!this.running) return;
    const now = performance.now();
    let dt = (now - this.lastPump) / 1000;
    this.lastPump = now;
    if (dt > this.maxFrameDt) dt = this.maxFrameDt;
    this.acc += dt;
    const step = 1 / this.stepHz;
    let guard = 0;
    while (this.acc >= step && guard < 8) {
      this.fixedStep(step);
      this.acc -= step;
      guard++;
    }
    if (guard >= 8) this.acc = 0; // симуляция не успевает — сбрасываем долг, а не копим
  }

  /** Принудительный шаг (для тестов и ручной прокрутки). */
  tickManually(dt: number): void {
    this.fixedStep(dt);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.worker?.terminate();
    this.worker = null;
    if (this.workerUrl) {
      URL.revokeObjectURL(this.workerUrl);
      this.workerUrl = null;
    }
  }
}
