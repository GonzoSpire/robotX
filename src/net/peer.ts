import { joinRoom, type JsonValue, type Room } from 'trystero';
import { roomPeerId } from './protocol';

/**
 * Транспорт на Trystero: комната = публичный топик (nostr-релеи),
 * данные — прямые WebRTC DataChannel между пирами. Своего сервера не нужно.
 * Схема «звезда»: хост — единственный авторитет, клиенты общаются только с ним;
 * чужие сообщения (клиент-клиент в общем топике) отбрасываются.
 */

export interface NetEvents {
  onOpen?: () => void;
  onMessage?: (pid: number, data: unknown) => void;
  onJoin?: (pid: number) => void;
  onLeave?: (pid: number) => void;
  onError?: (msg: string) => void;
}

const APP_ID = 'robotx-coop-v1';
/** Клиент ждёт первого пира столько секунд, иначе «комната не найдена». */
const DISCOVER_TIMEOUT_MS = 12000;

interface ActionPair {
  send: (data: unknown, target?: string[]) => Promise<void>;
}

function makeActions(room: Room, onObj: (data: unknown, peerId: string) => void, onBin: (data: ArrayBuffer, peerId: string) => void): { obj: ActionPair; bin: ActionPair } {
  const obj = room.makeAction<JsonValue>('o', {
    onMessage: (data, ctx) => onObj(data, ctx.peerId),
  });
  const bin = room.makeAction<ArrayBuffer>('b', {
    onMessage: (data, ctx) => onBin(data as unknown as ArrayBuffer, ctx.peerId),
  });
  return {
    obj: { send: (d, target) => obj.send(d as never, target ? { target } : undefined) },
    bin: { send: (d, target) => bin.send(d as never, target ? { target } : undefined) },
  };
}

function sendData(actions: { obj: ActionPair; bin: ActionPair }, data: unknown, target?: string[]): Promise<void> {
  const pair = data instanceof ArrayBuffer ? actions.bin : actions.obj;
  return pair.send(data, target);
}

function isHostish(data: unknown): boolean {
  const t = (data as { t?: string })?.t;
  return (
    t === 'lobby' ||
    t === 'start' ||
    t === 'cardOffer' ||
    t === 'events' ||
    t === 'end' ||
    t === 'backToLobby' ||
    t === 'roomFull'
  );
}

/** Сторона хоста: одна комната, до 3 клиентов (pid 1..3). */
export class NetHost {
  private room: Room;
  private actions: ReturnType<typeof makeActions>;
  private pidByPeer = new Map<string, number>();
  private peerByPid = new Map<number, string>();
  private nextPid = 1;
  private closed = false;
  readonly roomCode: string;

  constructor(private readonly ev: NetEvents, code: string) {
    this.roomCode = code;
    this.room = joinRoom({ appId: APP_ID }, roomPeerId(code));
    this.actions = makeActions(
      this.room,
      (data, peerId) => this.dispatch(data, peerId),
      (data, peerId) => this.dispatch(data, peerId),
    );
    this.room.onPeerJoin = (peerId) => this.accept(peerId);
    this.room.onPeerLeave = (peerId) => {
      const pid = this.pidByPeer.get(peerId);
      if (pid === undefined) return;
      this.drop(pid);
      this.ev.onLeave?.(pid);
    };
    // даём вызывающему доинициализироваться (HostCtx присваивает net после ctor)
    window.setTimeout(() => {
      if (!this.closed) this.ev.onOpen?.();
    }, 0);
  }

  private accept(peerId: string): void {
    if (this.closed) return;
    if (this.pidByPeer.size >= 3) {
      void sendData(this.actions, { t: 'roomFull' }, [peerId]);
      return;
    }
    const pid = this.nextPid++;
    this.pidByPeer.set(peerId, pid);
    this.peerByPid.set(pid, peerId);
    this.ev.onJoin?.(pid);
  }

  private dispatch(data: unknown, peerId: string): void {
    if (this.closed) return;
    const pid = this.pidByPeer.get(peerId);
    if (pid === undefined) return; // отклонённые и посторонние пиры
    this.ev.onMessage?.(pid, data);
  }

  send(pid: number, data: unknown): void {
    if (this.closed) return;
    const peerId = this.peerByPid.get(pid);
    if (!peerId) return;
    void sendData(this.actions, data, [peerId]).catch(() => undefined);
  }

  broadcast(data: unknown): void {
    if (this.closed) return;
    const targets = [...this.pidByPeer.keys()];
    if (targets.length === 0) return;
    void sendData(this.actions, data, targets).catch(() => undefined);
  }

  /** Отключить клиента (лобби полное / забег идёт). */
  kick(pid: number): void {
    const peerId = this.peerByPid.get(pid);
    if (!peerId) return;
    this.drop(pid);
  }

  private drop(pid: number): void {
    const peerId = this.peerByPid.get(pid);
    this.peerByPid.delete(pid);
    if (peerId) this.pidByPeer.delete(peerId);
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.pidByPeer.clear();
    this.peerByPid.clear();
    void this.room.leave().catch(() => undefined);
  }
}

/** Сторона клиента: комната + единственный признанный хост. */
export class NetClient {
  private room: Room;
  private actions: ReturnType<typeof makeActions>;
  private hostPeer: string | null = null;
  private discoverTimer = 0;
  private closed = false;
  private connectCalled = false;
  private pendingOpen = false;

  constructor(
    private readonly ev: NetEvents & { onRoomNotFound?: () => void },
    code: string,
  ) {
    this.room = joinRoom({ appId: APP_ID }, roomPeerId(code));
    this.actions = makeActions(
      this.room,
      (data, peerId) => this.dispatch(data, peerId),
      (data, peerId) => this.dispatch(data, peerId),
    );
    this.room.onPeerJoin = () => {
      if (this.hostPeer !== null) return;
      // канал открылся — приветствие уйдёт всем, хост на него ответит
      window.clearTimeout(this.discoverTimer);
      if (this.connectCalled) this.ev.onOpen?.();
      else this.pendingOpen = true;
    };
    this.room.onPeerLeave = (peerId) => {
      if (peerId !== this.hostPeer) return;
      this.hostPeer = null;
      if (!this.closed) this.ev.onLeave?.(0);
    };
    this.discoverTimer = window.setTimeout(() => {
      if (!this.closed && this.hostPeer === null) this.ev.onRoomNotFound?.();
    }, DISCOVER_TIMEOUT_MS);
  }

  connect(): void {
    // trystero подключается в конструкторе; здесь только догоняем onOpen,
    // если пир успел появиться раньше создания лобби
    if (this.connectCalled) return;
    this.connectCalled = true;
    if (this.pendingOpen) {
      this.pendingOpen = false;
      this.ev.onOpen?.();
    }
  }

  /** Хостом становится тот пир, от кого пришло первое хостовое сообщение. */
  private dispatch(data: unknown, peerId: string): void {
    if (this.closed) return;
    if (!isHostish(data)) {
      // клиент-клиент сообщения в общем топике игнорируем
      if (this.hostPeer === null || peerId !== this.hostPeer) return;
    }
    if (this.hostPeer === null) {
      this.hostPeer = peerId;
      window.clearTimeout(this.discoverTimer);
    } else if (peerId !== this.hostPeer) {
      return; // чужой хост из другой сессии — мимо
    }
    this.ev.onMessage?.(0, data);
  }

  send(data: unknown): void {
    if (this.closed) return;
    // широковещательно: хост получит, остальные клиенты отбросят
    void sendData(this.actions, data).catch(() => undefined);
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    window.clearTimeout(this.discoverTimer);
    void this.room.leave().catch(() => undefined);
  }
}
