import type { GameEvent, InputSnapshot } from '../run/sim';
import type { Card } from '../run/cards';
import type { ClientCtx, StartPayload } from './session';
import { ClientRunView } from './clientView';
import {
  asArrayBuffer,
  decodeSnapshot,
  encodeInput,
  isHostMsg,
  type HostMsg,
  type PlayerResult,
} from './protocol';

export interface ClientRunHooks {
  onCardOffer: (cards: Card[]) => void;
  onEnd: (results: PlayerResult[]) => void;
  onBackToLobby: () => void;
  onConnectionLost: () => void;
}

/**
 * Сетевой забег клиента: отправка ввода 60 Гц, приём снапшотов в ClientRunView,
 * карточки по предложению хоста, завершение по сообщению end.
 */
export class ClientRun {
  readonly view: ClientRunView;
  private pendingEvents: GameEvent[] = [];
  private ended = false;
  private readonly myPid: number;

  constructor(
    private readonly ctx: ClientCtx,
    payload: StartPayload,
    private readonly hooks: ClientRunHooks,
  ) {
    this.myPid = payload.yourPid;
    this.view = new ClientRunView(payload.roster, payload.yourPid);
    this.ctx.use(this);
  }

  fixedTick(dt: number, input: InputSnapshot): void {
    this.view.predictTick(dt, input);
    if (!this.ended) this.ctx.net.send(encodeInput(input.moveX, input.moveY, input.dash, input.shield));
  }

  /** Кадр рендера: интерполяция состояния + накопленные события хоста. */
  frame(dt: number): GameEvent[] {
    this.view.frame(performance.now(), dt);
    if (this.pendingEvents.length === 0) return [];
    return this.pendingEvents.splice(0, this.pendingEvents.length);
  }

  /** Свой выбор карточки: хосту — применить, себе — в предикцию. */
  pickCard(card: Card): void {
    this.ctx.net.send({ t: 'cardPick', pid: this.myPid, card });
    this.view.applyPick(card);
  }

  onMessage(_pid: number, data: unknown): void {
    const buf = asArrayBuffer(data);
    if (buf) {
      const snap = decodeSnapshot(buf);
      if (snap) this.view.pushSnapshot(snap, performance.now());
      return;
    }
    if (!isHostMsg(data)) return;
    const msg = data as HostMsg;
    switch (msg.t) {
      case 'events':
        this.pendingEvents.push(...msg.list);
        break;
      case 'cardOffer':
        if (msg.pid === this.myPid) this.hooks.onCardOffer(msg.cards);
        break;
      case 'end':
        if (!this.ended) {
          this.ended = true;
          this.hooks.onEnd(msg.results);
        }
        break;
      case 'backToLobby':
        this.hooks.onBackToLobby();
        break;
      default:
        break;
    }
  }

  onLeave(): void {
    if (!this.ended) this.hooks.onConnectionLost();
  }

  destroy(): void {
    this.ctx.use({});
  }
}
