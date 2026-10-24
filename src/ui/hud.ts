import { PLAYER_ACCENTS, type RunView } from '../run/view';
import { xpToNext } from '../run/progression';

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface MateBar {
  pid: number;
  root: HTMLElement;
  fill: HTMLElement;
}

/** Боевой HUD: полосы, таймер, счётчики, союзники, полоса босса. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly xpText: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly bossCountdown: HTMLElement;
  private readonly kills: HTMLElement;
  private readonly scrap: HTMLElement;
  private readonly bossBar: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly floaters: HTMLElement;
  private readonly matesWrap: HTMLElement;
  private readonly mates: MateBar[] = [];

  constructor(uiRoot: HTMLElement, onPause: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-left">
        <div class="bar" id="hp-bar">
          <div class="bar-fill" id="hp-fill" style="width:100%"></div>
          <div class="bar-text" id="hp-text">100/100</div>
        </div>
        <div class="bar" id="xp-bar">
          <div class="bar-fill" id="xp-fill" style="width:0%"></div>
          <div class="bar-text" id="xp-text"></div>
        </div>
        <div id="mates"></div>
      </div>
      <div class="hud-mid">
        <div id="timer">00:00</div>
        <div id="boss-countdown"></div>
      </div>
      <div class="hud-right">
        <button id="pause-btn">⏸</button>
        <div id="kills">☠ 0</div>
        <div id="scrap-hud">⚙ 0</div>
      </div>
      <div id="boss-bar">
        <div id="boss-name">ЯДРО-ТИТАН</div>
        <div class="bar"><div class="bar-fill" id="boss-fill" style="width:100%"></div></div>
      </div>
    `;
    uiRoot.appendChild(this.root);

    this.floaters = document.createElement('div');
    this.floaters.id = 'floaters';
    uiRoot.appendChild(this.floaters);

    this.hpFill = this.must('hp-fill');
    this.hpText = this.must('hp-text');
    this.xpFill = this.must('xp-fill');
    this.xpText = this.must('xp-text');
    this.timer = this.must('timer');
    this.bossCountdown = this.must('boss-countdown');
    this.kills = this.must('kills');
    this.scrap = this.must('scrap-hud');
    this.bossBar = this.must('boss-bar');
    this.bossFill = this.must('boss-fill');
    this.matesWrap = this.must('mates');

    this.must('pause-btn').addEventListener('click', onPause);
  }

  private must(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`HUD element #${id} missing`);
    return el;
  }

  update(sim: RunView): void {
    const p = sim.player;
    this.hpFill.style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
    this.hpText.textContent = `${Math.max(0, Math.ceil(p.hp))}/${p.maxHp}`;
    this.xpFill.style.width = `${Math.min(100, (sim.xp / xpToNext(sim.level)) * 100)}%`;
    this.xpText.textContent = `LVL ${sim.level}`;
    this.timer.textContent = fmtTime(sim.time);
    this.kills.textContent = `☠ ${sim.kills}`;
    this.scrap.textContent = `⚙ ${p.scrapCollected}`;

    if (sim.boss) {
      this.bossBar.style.display = 'block';
      this.bossFill.style.width = `${Math.max(0, (sim.boss.hp / sim.boss.maxHp) * 100)}%`;
      this.bossCountdown.textContent = '';
    } else {
      this.bossBar.style.display = 'none';
      this.bossCountdown.textContent = sim.time > 480 && sim.time < 600 ? `ЯДРО-ТИТАН ЧЕРЕЗ ${fmtTime(600 - sim.time)}` : '';
    }

    this.updateMates(sim);
  }

  /** Мини-полоски союзников (кроме своего робота). */
  private updateMates(sim: RunView): void {
    const others = sim.players.filter((x) => x.id !== sim.player.id);
    const sameSet =
      this.mates.length === others.length && this.mates.every((m, i) => m.pid === others[i].id);
    if (!sameSet) {
      this.matesWrap.innerHTML = '';
      this.mates.length = 0;
      for (const o of others) {
        const root = document.createElement('div');
        root.className = 'mate';
        const color = `#${(PLAYER_ACCENTS[o.colorIdx] ?? PLAYER_ACCENTS[0]).toString(16).padStart(6, '0')}`;
        root.innerHTML = `
          <span class="mate-name" style="color:${color}">${escapeHtml(o.name)}</span>
          <div class="mate-bar"><div class="mate-fill" style="background:${color}"></div></div>
        `;
        this.matesWrap.appendChild(root);
        this.mates.push({ pid: o.id, root, fill: root.querySelector('.mate-fill') as HTMLElement });
      }
    }
    for (let i = 0; i < this.mates.length; i++) {
      const m = this.mates[i];
      const o = others[i];
      m.root.classList.toggle('dead', o.dead);
      (m.fill as HTMLElement).style.width = `${Math.max(0, (o.hp / o.maxHp) * 100)}%`;
    }
  }

  floater(x: number, y: number, text: string, cls: string): void {
    if (this.floaters.childElementCount > 34) {
      this.floaters.firstElementChild?.remove();
    }
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.textContent = text;
    this.floaters.appendChild(el);
    setTimeout(() => el.remove(), cls === 'boss' ? 1650 : 800);
  }

  show(): void {
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.floaters.innerHTML = '';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
