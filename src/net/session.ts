import { NetClient, NetHost } from './peer';
import {
  genRoomCode,
  isClientMsg,
  isHostMsg,
  MAX_PLAYERS,
  type ClientMsg,
  type HostMsg,
  type LobbyMember,
  type RosterEntry,
} from './protocol';
import type { RunStartConfig } from '../run/sim';

/**
 * Логика лобби поверх транспорта. Транспорт в HostCtx/ClientCtx переживает
 * переход лобби → забег: текущая фаза-обработчик переключается методом use(),
 * поэтому соединения не рвутся при старте забега.
 */

export interface NetPhase {
  onMessage?: (pid: number, data: unknown) => void;
  onJoin?: (pid: number) => void;
  onLeave?: (pid: number) => void;
  onError?: (msg: string) => void;
}

export interface StartPayload {
  seed: number;
  roster: RosterEntry[];
  yourPid: number;
}

export interface HostLobbyHooks {
  onRoster: (members: LobbyMember[]) => void;
}

export interface ClientLobbyHooks {
  onRoster: (members: LobbyMember[], yourPid: number) => void;
  onStart: (payload: StartPayload) => void;
  onRoomFull: () => void;
  onConnectionLost: () => void;
}

/** Роутер сообщений хоста: лобби или run-контроллер — текущая фаза. */
export class HostCtx {
  readonly net: NetHost;
  phase: NetPhase = {};

  constructor(onRoomOpen: (code: string) => void, onError: (msg: string) => void) {
    this.net = new NetHost(
      {
        onOpen: () => onRoomOpen(this.net.roomCode),
        onMessage: (pid, data) => this.phase.onMessage?.(pid, data),
        onJoin: (pid) => this.phase.onJoin?.(pid),
        onLeave: (pid) => this.phase.onLeave?.(pid),
        onError: (msg) => onError(msg),
      },
      genRoomCode(),
    );
  }

  use(p: NetPhase): void {
    this.phase = p;
  }

  destroy(): void {
    this.net.destroy();
  }
}

/** Роутер клиента. */
export class ClientCtx {
  readonly net: NetClient;
  phase: NetPhase = {};

  constructor(
    code: string,
    hooks: {
      onOpen: () => void;
      onRoomNotFound: () => void;
      onError: (msg: string) => void;
    },
  ) {
    this.net = new NetClient(
      {
        onOpen: () => hooks.onOpen(),
        onMessage: (pid, data) => this.phase.onMessage?.(pid, data),
        onLeave: () => this.phase.onLeave?.(0),
        onError: (msg) => hooks.onError(msg),
        onRoomNotFound: hooks.onRoomNotFound,
      },
      code,
    );
  }

  connect(): void {
    this.net.connect();
  }

  use(p: NetPhase): void {
    this.phase = p;
  }

  destroy(): void {
    this.net.destroy();
  }
}

function freeColorIdx(members: LobbyMember[]): number {
  const used = new Set(members.map((m) => m.colorIdx));
  for (let c = 0; c < MAX_PLAYERS; c++) if (!used.has(c)) return c;
  return members.length % MAX_PLAYERS;
}

/** Лобби хоста: ростер, готовность, старт забега. */
export class HostLobby {
  private members = new Map<number, LobbyMember>();
  private builds = new Map<number, RunStartConfig>();
  private started = false;

  constructor(
    private readonly ctx: HostCtx,
    private readonly hooks: HostLobbyHooks,
    myName: string,
    myStart: RunStartConfig,
  ) {
    this.members.set(0, { pid: 0, name: myName.slice(0, 16) || 'Хост', colorIdx: 0, ready: true });
    this.builds.set(0, myStart);
    ctx.use(this);
    this.notify();
  }

  roster(): LobbyMember[] {
    return [...this.members.values()].sort((a, b) => a.pid - b.pid);
  }

  canStart(): boolean {
    const list = this.roster();
    return list.length >= 1 && list.every((m) => m.ready);
  }

  start(): StartPayload {
    const seed = Math.floor(Math.random() * 2 ** 31);
    const roster: RosterEntry[] = this.roster().map((m) => ({
      pid: m.pid,
      name: m.name,
      colorIdx: m.colorIdx,
      start: this.builds.get(m.pid)!,
    }));
    this.ctx.net.broadcast({ t: 'start', seed, roster } satisfies HostMsg);
    this.started = true;
    return { seed, roster, yourPid: 0 };
  }

  /** Забег закончился — вернуть всех в лобби. */
  reopen(): void {
    this.started = false;
    for (const [pid, m] of this.members) m.ready = pid === 0;
    this.ctx.net.broadcast({ t: 'backToLobby' } satisfies HostMsg);
    this.pushLobby();
  }

  onMessage(pid: number, data: unknown): void {
    if (!isClientMsg(data)) return;
    const msg = data as ClientMsg;
    switch (msg.t) {
      case 'hello': {
        if (this.started || this.members.size >= MAX_PLAYERS) {
          this.ctx.net.send(pid, { t: 'roomFull' } as unknown as HostMsg);
          return;
        }
        this.members.set(pid, { pid, name: msg.name.slice(0, 16) || 'Пилот', colorIdx: freeColorIdx(this.roster()), ready: false });
        this.builds.set(pid, msg.start);
        this.pushLobby();
        this.notify();
        break;
      }
      case 'ready': {
        const m = this.members.get(pid);
        if (m) {
          m.ready = msg.ready;
          this.pushLobby();
          this.notify();
        }
        break;
      }
      case 'leave':
        this.removeMember(pid);
        break;
      default:
        break;
    }
  }

  onLeave(pid: number): void {
    if (this.started) return; // во время забега отключение обрабатывает run-контроллер
    this.removeMember(pid);
  }

  /** Вернуть обработку сообщений лобби после завершённого забега. */
  reactivate(): void {
    this.ctx.use(this);
  }

  private removeMember(pid: number): void {
    if (!this.members.has(pid)) return;
    this.members.delete(pid);
    this.builds.delete(pid);
    this.pushLobby();
    this.notify();
  }

  private pushLobby(): void {
    const members = this.roster();
    for (const pid of this.members.keys()) {
      if (pid === 0) continue;
      this.ctx.net.send(pid, { t: 'lobby', hostPid: 0, yourPid: pid, members } satisfies HostMsg);
    }
  }

  private notify(): void {
    this.hooks.onRoster(this.roster());
  }

  destroy(): void {
    this.ctx.destroy();
  }
}

/** Лобби клиента: подключение, ростер, старт по команде хоста. */
export class ClientLobby {
  members: LobbyMember[] = [];
  yourPid = -1;

  constructor(
    private readonly ctx: ClientCtx,
    private readonly hooks: ClientLobbyHooks,
    private readonly myName: string,
    private readonly myStart: RunStartConfig,
  ) {
    ctx.use(this);
  }

  /** Зовётся после onOpen транспорта (hello до open не доставится). */
  hello(): void {
    this.ctx.net.send({ t: 'hello', name: this.myName.slice(0, 16) || 'Пилот', start: this.myStart } satisfies ClientMsg);
  }

  setReady(ready: boolean): void {
    this.ctx.net.send({ t: 'ready', ready } satisfies ClientMsg);
  }

  leave(): void {
    this.ctx.net.send({ t: 'leave' } satisfies ClientMsg);
    this.ctx.destroy();
  }

  onMessage(_pid: number, data: unknown): void {
    if (!isHostMsg(data)) {
      if ((data as { t?: string })?.t === 'roomFull') this.hooks.onRoomFull();
      return;
    }
    const msg = data as HostMsg;
    switch (msg.t) {
      case 'lobby':
        this.members = msg.members;
        this.yourPid = msg.yourPid;
        this.hooks.onRoster(this.members, this.yourPid);
        break;
      case 'start':
        this.hooks.onStart({ seed: msg.seed, roster: msg.roster, yourPid: this.yourPid });
        break;
      default:
        break;
    }
  }

  onLeave(): void {
    this.hooks.onConnectionLost();
  }

  /** Вернуть обработку сообщений лобби после завершённого забега. */
  reactivate(): void {
    this.ctx.use(this);
  }

  destroy(): void {
    this.ctx.destroy();
  }
}
