import * as THREE from 'three';

/** Единственный WebGLRenderer на приложение — контексты браузер ограничивает. */
export class RenderCore {
  readonly renderer: THREE.WebGLRenderer;
  private resizeCallbacks: Array<(w: number, h: number) => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(0x0b0e13, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
  }

  onResize(cb: (w: number, h: number) => void): void {
    this.resizeCallbacks.push(cb);
    const c = this.renderer.domElement;
    cb(c.clientWidth, c.clientHeight);
  }

  private handleResize(): void {
    const c = this.renderer.domElement;
    const w = Math.max(1, c.clientWidth);
    const h = Math.max(1, c.clientHeight);
    this.renderer.setSize(w, h, false);
    for (const cb of this.resizeCallbacks) cb(w, h);
  }
}
