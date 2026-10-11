import { clamp } from '../core/math';

/**
 * Ввод: WASD/стрелки + Space (рывок) + E (щит) на клавиатуре;
 * плавающий виртуальный джойстик и две кнопки на тач-устройствах.
 */
export class InputManager {
  private keys = new Set<string>();
  private dashQueued = false;
  private shieldQueued = false;

  private joyActive = false;
  private joyId = -1;
  private joyOx = 0;
  private joyOy = 0;
  private joyX = 0;
  private joyY = 0;

  readonly joyBase: HTMLElement;
  readonly joyStick: HTMLElement;
  readonly dashBtn: HTMLElement;
  readonly shieldBtn: HTMLElement;
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;

    this.joyBase = document.createElement('div');
    this.joyBase.className = 'joy-base';
    this.joyStick = document.createElement('div');
    this.joyStick.className = 'joy-stick';
    this.joyBase.appendChild(this.joyStick);
    this.joyBase.style.display = 'none';

    this.dashBtn = document.createElement('button');
    this.dashBtn.className = 'ability-btn';
    this.dashBtn.id = 'btn-dash';
    this.dashBtn.innerHTML = '<span>⇢</span><i>РЫВОК</i>';
    this.shieldBtn = document.createElement('button');
    this.shieldBtn.className = 'ability-btn';
    this.shieldBtn.id = 'btn-shield';
    this.shieldBtn.innerHTML = '<span>⛨</span><i>ЩИТ</i>';

    const abilities = document.createElement('div');
    abilities.className = 'abilities';
    abilities.appendChild(this.dashBtn);
    abilities.appendChild(this.shieldBtn);

    root.appendChild(this.joyBase);
    root.appendChild(abilities);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.dashQueued = true;
      if (e.code === 'KeyE' || e.code === 'ShiftLeft') this.shieldQueued = true;
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    const canvas = document.getElementById('game');
    if (canvas) {
      canvas.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch' || this.joyActive) return;
        this.joyActive = true;
        this.joyId = e.pointerId;
        this.joyOx = e.clientX;
        this.joyOy = e.clientY;
        this.joyX = 0;
        this.joyY = 0;
        this.showJoystick(e.clientX, e.clientY);
      });
    }
    window.addEventListener('pointermove', (e) => {
      if (!this.joyActive || e.pointerId !== this.joyId) return;
      const dx = e.clientX - this.joyOx;
      const dy = e.clientY - this.joyOy;
      const r = Math.hypot(dx, dy);
      const max = 56;
      const k = r > max ? max / r : 1;
      this.joyX = dx * k / max;
      this.joyY = dy * k / max;
      this.joyStick.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    });
    const end = (e: PointerEvent) => {
      if (!this.joyActive || e.pointerId !== this.joyId) return;
      this.joyActive = false;
      this.joyX = 0;
      this.joyY = 0;
      this.joyBase.style.display = 'none';
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    this.dashBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.dashQueued = true;
    });
    this.shieldBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.shieldQueued = true;
    });

    this.setTouchUi(isTouchDevice());
  }

  move(): { x: number; y: number } {
    const k = this.keys;
    let x = 0;
    let y = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (x !== 0 && y !== 0) {
      const inv = 1 / Math.SQRT2;
      x *= inv;
      y *= inv;
    }
    if (x === 0 && y === 0 && this.joyActive) {
      x = clamp(this.joyX, -1, 1);
      y = clamp(this.joyY, -1, 1);
    }
    return { x, y };
  }

  consumeDash(): boolean {
    const v = this.dashQueued;
    this.dashQueued = false;
    return v;
  }

  consumeShield(): boolean {
    const v = this.shieldQueued;
    this.shieldQueued = false;
    return v;
  }

  /** Затемнение кнопок по кулдауну: frac 0..1 (1 — только что использован). */
  setAbilityState(dashFrac: number, shieldFrac: number, shieldActive: boolean): void {
    this.dashBtn.style.setProperty('--cd', `${clamp(dashFrac, 0, 1)}`);
    this.dashBtn.classList.toggle('ready', dashFrac <= 0);
    this.shieldBtn.style.setProperty('--cd', `${clamp(shieldFrac, 0, 1)}`);
    this.shieldBtn.classList.toggle('ready', shieldFrac <= 0);
    this.shieldBtn.classList.toggle('active', shieldActive);
  }

  setTouchUi(on: boolean): void {
    this.root.classList.toggle('touch', on);
  }

  setAbilitiesVisible(on: boolean): void {
    this.dashBtn.style.display = on ? '' : 'none';
    this.shieldBtn.style.display = on ? '' : 'none';
  }

  private showJoystick(x: number, y: number): void {
    this.joyBase.style.display = 'block';
    this.joyBase.style.left = `${x}px`;
    this.joyBase.style.top = `${y}px`;
    this.joyStick.style.transform = 'translate(0px, 0px)';
  }
}

function isTouchDevice(): boolean {
  return 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
}
