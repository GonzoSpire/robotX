import type { Card } from '../run/cards';
import { PART_BY_ID } from '../meta/parts';

export interface CardView {
  icon: string;
  title: string;
  desc: string;
  card: Card;
}

export interface ResultData {
  won: boolean;
  timeSec: number;
  level: number;
  kills: number;
  scrap: number;
  record: boolean;
  blueprints: string[];
}

export interface ScreensCallbacks {
  onRetry: () => void;
  onToHangar: () => void;
  onResume: () => void;
  onRestart: () => void;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Оверлейные экраны: карточки, пауза, результаты. */
export class Screens {
  private readonly levelup: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly results: HTMLElement;
  private keyListener: ((e: KeyboardEvent) => void) | null = null;

  constructor(uiRoot: HTMLElement, private readonly cb: ScreensCallbacks) {
    this.levelup = this.mk('levelup-screen', 'screen');
    this.pause = this.mk('pause-screen', 'screen');
    this.results = this.mk('results-screen', 'screen');
    uiRoot.append(this.levelup, this.pause, this.results);
  }

  private mk(id: string, cls: string): HTMLElement {
    const el = document.createElement('div');
    el.id = id;
    el.className = cls;
    return el;
  }

  hideAll(): void {
    for (const el of [this.levelup, this.pause, this.results]) el.classList.remove('show');
    this.clearKeyListener();
  }

  // ---------- карточки ----------

  showLevelUp(cards: CardView[], onPick: (c: Card) => void): void {
    this.levelup.innerHTML = `
      <div class="panel">
        <div class="game-title" style="font-size:28px;letter-spacing:3px">УРОВЕНЬ ПОВЫШЕН</div>
        <div class="subtitle">выбери улучшение</div>
        <div class="cards"></div>
      </div>
    `;
    const wrap = this.levelup.querySelector('.cards')!;
    cards.forEach((c, i) => {
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = `
        <div class="icon">${c.icon}</div>
        <div>
          <div class="name">${c.title}</div>
          <div class="desc">${c.desc}</div>
          <div class="num">[${i + 1}]</div>
        </div>
      `;
      el.addEventListener('click', () => onPick(c.card));
      wrap.appendChild(el);
    });
    this.levelup.classList.add('show');
    this.keyListener = (e) => {
      const idx = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (idx >= 0 && idx < cards.length) onPick(cards[idx].card);
    };
    window.addEventListener('keydown', this.keyListener);
  }

  hideLevelUp(): void {
    this.levelup.classList.remove('show');
    this.clearKeyListener();
  }

  private clearKeyListener(): void {
    if (this.keyListener) {
      window.removeEventListener('keydown', this.keyListener);
      this.keyListener = null;
    }
  }

  // ---------- пауза ----------

  showPause(): void {
    this.pause.innerHTML = `
      <div class="panel" style="max-width:320px">
        <div class="game-title" style="font-size:26px">ПАУЗА</div>
        <div class="btn-row" style="flex-direction:column;margin-top:14px">
          <button class="btn btn-primary" id="resume-btn">ПРОДОЛЖИТЬ</button>
          <button class="btn" id="restart-btn">ЗАНОВО</button>
          <button class="btn" id="hangar-btn">В АНГАР</button>
        </div>
      </div>
    `;
    this.pause.classList.add('show');
    this.pause.querySelector('#resume-btn')!.addEventListener('click', this.cb.onResume);
    this.pause.querySelector('#restart-btn')!.addEventListener('click', this.cb.onRestart);
    this.pause.querySelector('#hangar-btn')!.addEventListener('click', this.cb.onToHangar);
  }

  hidePause(): void {
    this.pause.classList.remove('show');
  }

  // ---------- результаты ----------

  showResults(d: ResultData): void {
    const bpNames = d.blueprints.map((id) => PART_BY_ID[id]?.name ?? id);
    this.results.innerHTML = `
      <div class="panel" style="max-width:420px">
        <div class="result-title ${d.won ? 'win' : 'lose'}">${d.won ? 'ПОБЕДА' : 'РОБОТ УНИЧТОЖЕН'}</div>
        ${d.record && !d.won ? '<div class="footnote" style="color:var(--gold)">★ НОВЫЙ РЕКОРД ВРЕМЕНИ</div>' : ''}
        <div class="result-rows">
          <div class="result-row"><span>Время</span><b>${fmtTime(d.timeSec)}</b></div>
          <div class="result-row"><span>Уровень</span><b>${d.level}</b></div>
          <div class="result-row"><span>Убийств</span><b>${d.kills}</b></div>
          <div class="result-row"><span>Скрап</span><b class="gain">+${d.scrap} ⚙</b></div>
          ${bpNames.length ? `<div class="result-row"><span>Чертежи</span><b class="gain">+${bpNames.length}</b></div><div class="footnote">${bpNames.join(' · ')}</div>` : ''}
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="retry-btn">ЕЩЁ ЗАБЕГ</button>
          <button class="btn" id="hangar-btn2">В АНГАР</button>
        </div>
      </div>
    `;
    this.results.classList.add('show');
    this.results.querySelector('#retry-btn')!.addEventListener('click', this.cb.onRetry);
    this.results.querySelector('#hangar-btn2')!.addEventListener('click', this.cb.onToHangar);
  }
}
