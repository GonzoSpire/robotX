import type { LobbyMember } from '../net/protocol';
import { PLAYER_ACCENTS } from '../run/view';

export interface LobbyCallbacks {
  onCreate: (nick: string) => void;
  onJoin: (nick: string, code: string) => void;
  onLeave: () => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onCopyLink: (link: string) => void;
}

export interface RoomView {
  code: string;
  members: LobbyMember[];
  yourPid: number;
  youReady: boolean;
  canStart: boolean;
}

export const PLAYER_COLORS: string[] = PLAYER_ACCENTS.map((c) => `#${c.toString(16).padStart(6, '0')}`);
const NICK_KEY = 'robotx.nick';

/** Экран сетевого лобби: вход → комната (код, ростер, готовность, старт). */
export class LobbyScreen {
  private readonly root: HTMLElement;
  private nick = '';

  constructor(uiRoot: HTMLElement, private readonly cb: LobbyCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'lobby-screen';
    this.root.className = 'screen';
    uiRoot.appendChild(this.root);
    try {
      this.nick = localStorage.getItem(NICK_KEY) ?? '';
    } catch {
      this.nick = '';
    }
    if (!this.nick) this.nick = `Пилот-${Math.floor(Math.random() * 900 + 100)}`;
  }

  show(): void {
    this.root.classList.add('show');
  }

  /** Текущий ник (для автоподключения по ссылке). */
  get nickValue(): string {
    return this.nick;
  }

  hide(): void {
    this.root.classList.remove('show');
  }

  showEntry(prefillCode = '', error = ''): void {
    this.root.innerHTML = `
      <div class="panel lobby-panel">
        <div class="game-title" style="font-size:26px">СЕТЕВОЙ ЗАБЕГ</div>
        <div class="subtitle">кооп до ${PLAYER_COLORS.length} роботов</div>
        <label class="lobby-label">Позывной</label>
        <input class="lobby-input" id="lobby-nick" maxlength="16" value="${escapeHtml(this.nick)}">
        <div class="btn-row" style="flex-direction:column;margin-top:14px">
          <button class="btn btn-primary" id="lobby-create">СОЗДАТЬ ЛОББИ</button>
        </div>
        <div class="lobby-sep"><span>или по коду</span></div>
        <div class="btn-row">
          <input class="lobby-input lobby-code" id="lobby-code" maxlength="5" placeholder="Код"
            value="${escapeHtml(prefillCode.toUpperCase())}" autocapitalize="characters">
          <button class="btn" id="lobby-join">ПОДКЛЮЧИТЬСЯ</button>
        </div>
        ${error ? `<div class="lobby-error">${escapeHtml(error)}</div>` : ''}
        <div class="btn-row" style="margin-top:14px">
          <button class="btn" id="lobby-back">НАЗАД</button>
        </div>
      </div>
    `;
    this.root.classList.add('show');
    const nickEl = this.root.querySelector<HTMLInputElement>('#lobby-nick')!;
    nickEl.addEventListener('change', () => this.saveNick(nickEl.value));
    this.root.querySelector('#lobby-create')!.addEventListener('click', () => {
      this.saveNick(nickEl.value);
      this.cb.onCreate(this.nick);
    });
    const codeEl = this.root.querySelector<HTMLInputElement>('#lobby-code')!;
    const join = () => {
      this.saveNick(nickEl.value);
      const code = codeEl.value.trim().toUpperCase();
      if (code.length < 4) return;
      this.cb.onJoin(this.nick, code);
    };
    this.root.querySelector('#lobby-join')!.addEventListener('click', join);
    codeEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join();
    });
    this.root.querySelector('#lobby-back')!.addEventListener('click', () => this.cb.onLeave());
  }

  showConnecting(text: string): void {
    this.root.innerHTML = `
      <div class="panel lobby-panel">
        <div class="game-title" style="font-size:22px">${escapeHtml(text)}</div>
        <div class="subtitle">p2p через публичные релеи, без сервера</div>
        <div class="btn-row" style="margin-top:14px">
          <button class="btn" id="lobby-cancel">ОТМЕНА</button>
        </div>
      </div>
    `;
    this.root.classList.add('show');
    this.root.querySelector('#lobby-cancel')!.addEventListener('click', () => this.cb.onLeave());
  }

  showError(msg: string, prefillCode = ''): void {
    this.showEntry(prefillCode, msg);
  }

  showRoom(room: RoomView): void {
    const isHost = room.yourPid === 0;
    const link = `${location.origin}${location.pathname}?room=${room.code}`;
    const slots = [];
    for (let i = 0; i < PLAYER_COLORS.length; i++) {
      const m = room.members[i];
      if (m) {
        const crown = m.pid === 0 ? '<span class="lobby-crown">♛</span>' : '';
        const readyMark = m.ready ? '<span class="lobby-ready">✓ готов</span>' : '<span class="lobby-notready">не готов</span>';
        slots.push(`
          <div class="lobby-slot filled" style="--pc:${PLAYER_COLORS[m.colorIdx] ?? '#888'}">
            <span class="lobby-name">${crown} ${escapeHtml(m.name)}</span>
            ${readyMark}
          </div>
        `);
      } else {
        slots.push('<div class="lobby-slot"><span class="lobby-empty">— свободно —</span></div>');
      }
    }
    this.root.innerHTML = `
      <div class="panel lobby-panel">
        <div class="game-title" style="font-size:22px">ЛОББИ</div>
        <div class="lobby-code-row">
          <span class="lobby-code-big">${escapeHtml(room.code)}</span>
          <button class="btn" id="lobby-copy">СКОПИРОВАТЬ ССЫЛКУ</button>
        </div>
        <div class="lobby-grid">${slots.join('')}</div>
        ${isHost ? '<div class="footnote">старт доступен, когда все готовы</div>' : ''}
        <div class="btn-row" style="margin-top:14px">
          ${
            isHost
              ? `<button class="btn btn-primary" id="lobby-start" ${room.canStart ? '' : 'disabled'}>СТАРТ (${room.members.length})</button>`
              : `<button class="btn ${room.youReady ? '' : 'btn-primary'}" id="lobby-ready">${room.youReady ? 'НЕ ГОТОВ' : 'ГОТОВ'}</button>`
          }
          <button class="btn" id="lobby-exit">ВЫЙТИ</button>
        </div>
      </div>
    `;
    this.root.classList.add('show');
    this.root.querySelector('#lobby-copy')!.addEventListener('click', () => this.cb.onCopyLink(link));
    const startBtn = this.root.querySelector('#lobby-start');
    startBtn?.addEventListener('click', () => this.cb.onStart());
    const readyBtn = this.root.querySelector('#lobby-ready');
    readyBtn?.addEventListener('click', () => this.cb.onReady(!room.youReady));
    this.root.querySelector('#lobby-exit')!.addEventListener('click', () => this.cb.onLeave());
  }

  private saveNick(v: string): void {
    this.nick = v.trim().slice(0, 16) || this.nick;
    try {
      localStorage.setItem(NICK_KEY, this.nick);
    } catch {
      /* приватный режим */
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
