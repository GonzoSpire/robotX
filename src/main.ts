import './style.css';
import { FixedLoop } from './core/loop';
import { Rng } from './core/rng';
import { loadSave, persistSave } from './core/save';
import { InputManager } from './input/input';
import { RenderCore } from './render/core';
import { HangarScene } from './render/hangarScene';
import { RunScene, type RosterView } from './render/runScene';
import { applyCard, cardDesc, cardIcon, cardTitle, rollCards, type Card } from './run/cards';
import { RunSim, defaultStart, type GameEvent, type InputSnapshot, type RunStartConfig } from './run/sim';
import type { RunView } from './run/view';
import { computeLoadoutStats } from './meta/loadout';
import { blueprintDropPool } from './meta/crafting';
import { HangarScreen } from './ui/hangar';
import { Hud } from './ui/hud';
import { Screens, type CardView } from './ui/screens';
import { LobbyScreen } from './ui/lobby';
import { ClientCtx, ClientLobby, HostCtx, HostLobby, type StartPayload } from './net/session';
import { HostRun } from './net/hostRun';
import { ClientRun } from './net/clientRun';
import type { PlayerResult } from './net/protocol';

type Mode = 'hangar' | 'lobby' | 'run';
type NetRole = 'none' | 'host' | 'client';

class GameApp {
  mode: Mode = 'hangar';
  netRole: NetRole = 'none';
  private paused = false;
  private netMenuOpen = false;
  private levelUpOpen = false;
  private resultsShown = false;
  private joinCode = '';

  // соло-забег
  private sim: RunSim | null = null;

  // сеть: хост
  private hostCtx: HostCtx | null = null;
  private hostLobby: HostLobby | null = null;
  private hostRun: HostRun | null = null;

  // сеть: клиент
  private clientCtx: ClientCtx | null = null;
  private clientLobby: ClientLobby | null = null;
  private clientRun: ClientRun | null = null;

  private runScene: RunScene | null = null;
  private readonly rng = new Rng();
  private readonly save = loadSave();

  private readonly core: RenderCore;
  private readonly hangarScene: HangarScene;
  private readonly hangar: HangarScreen;
  private readonly input: InputManager;
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly lobby: LobbyScreen;
  private readonly loop = new FixedLoop(
    (dt) => this.fixedUpdate(dt),
    (dt, wall) => this.frame(dt, wall),
  );

  constructor() {
    const ui = document.getElementById('ui')!;
    const canvas = document.getElementById('game') as HTMLCanvasElement;

    this.core = new RenderCore(canvas);
    this.hangarScene = new HangarScene(this.core);
    this.input = new InputManager(ui);
    this.hud = new Hud(ui, () => this.togglePauseOrMenu());
    this.hud.hide();
    this.input.setAbilitiesVisible(false);
    this.hangar = new HangarScreen(ui, this.save, {
      onStartRun: () => this.startRun(),
      onOpenLobby: () => this.openLobby(),
    });
    this.screens = new Screens(ui, {
      onRetry: () => this.startRun(),
      onToHangar: () => this.toHangar(),
      onResume: () => this.togglePauseOrMenu(false),
      onRestart: () => this.startRun(),
      onToLobby: () => this.hostReturnToLobby(),
    });
    this.lobby = new LobbyScreen(ui, {
      onCreate: (nick) => this.createRoom(nick),
      onJoin: (nick, code) => this.joinRoom(nick, code),
      onLeave: () => this.closeLobby(),
      onReady: (v) => this.clientLobby?.setReady(v),
      onStart: () => this.startHostRun(),
      onCopyLink: (link) => {
        navigator.clipboard?.writeText(link).catch(() => {});
      },
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.mode === 'run' && !this.levelUpOpen && !this.resultsShown) {
        this.togglePauseOrMenu();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'run' && this.netRole === 'none' && this.sim?.state === 'running' && !this.levelUpOpen) {
        this.togglePause(true);
      }
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    this.hangar.show();
    this.loop.start();

    // автоподключение по ссылке ?room=CODE
    const room = new URLSearchParams(location.search).get('room');
    if (room && room.trim().length >= 4) {
      this.openLobby();
      this.joinRoom(this.lobby.nickValue, room.trim().toUpperCase());
    }

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__robotx = this;
    }
  }

  /** Конфиг старта забега из сборки ангара + пилота. */
  private buildStart(): RunStartConfig {
    const stats = computeLoadoutStats(this.save.loadout, this.save.pilot);
    if (!stats.valid) return defaultStart();
    return {
      maxHp: stats.hp,
      speed: stats.speed,
      pickup: stats.pickup,
      weaponSlots: stats.weaponSlots,
      weapons: stats.weapons,
      fixed: stats.fixed,
      blueprintPool: blueprintDropPool(this.save.owned, this.save.blueprints),
      startLevelBonus: 0,
    };
  }

  // ---------- лобби ----------

  private openLobby(prefillCode = ''): void {
    this.mode = 'lobby';
    this.hangar.hide();
    this.lobby.showEntry(prefillCode);
  }

  private createRoom(nick: string): void {
    this.netRole = 'host';
    this.lobby.showConnecting('Создание комнаты');
    this.hostCtx = new HostCtx(
      () => {
        this.hostLobby = new HostLobby(
          this.hostCtx!,
          { onRoster: () => this.showHostRoom() },
          nick,
          this.buildStart(),
        );
        this.showHostRoom();
      },
      (msg) => this.lobby.showError(`Ошибка сети: ${msg}`),
    );
  }

  private joinRoom(nick: string, code: string): void {
    this.netRole = 'client';
    this.joinCode = code;
    this.lobby.showConnecting('Подключение');
    this.clientCtx = new ClientCtx(code, {
      onOpen: () => this.clientLobby?.hello(),
      onRoomNotFound: () => this.lobby.showError('Комната не найдена. Проверьте код.', code),
      onError: (msg) => {
        if (this.mode === 'lobby') this.lobby.showError(`Ошибка: ${msg}`, code);
      },
    });
    this.clientLobby = new ClientLobby(
      this.clientCtx,
      {
        onRoster: () => {
          if (this.mode === 'lobby') this.showClientRoom();
        },
        onStart: (payload) => this.startClientRun(payload),
        onRoomFull: () => this.lobby.showError('Лобби заполнено (максимум 4 робота).', code),
        onConnectionLost: () => {
          if (this.mode === 'run') this.netRunLost('Соединение с хостом потеряно.');
          else this.lobby.showError('Соединение потеряно.', code);
        },
      },
      nick,
      this.buildStart(),
    );
    this.clientCtx.connect();
  }

  private showHostRoom(): void {
    if (!this.hostCtx || !this.hostLobby || this.mode !== 'lobby') return;
    this.lobby.showRoom({
      code: this.hostCtx.net.roomCode,
      members: this.hostLobby.roster(),
      yourPid: 0,
      youReady: true,
      canStart: this.hostLobby.canStart(),
    });
  }

  private showClientRoom(): void {
    if (!this.clientLobby || this.mode !== 'lobby') return;
    const me = this.clientLobby.members.find((m) => m.pid === this.clientLobby!.yourPid);
    this.lobby.showRoom({
      code: this.joinCode,
      members: this.clientLobby.members,
      yourPid: this.clientLobby.yourPid,
      youReady: me?.ready ?? false,
      canStart: this.clientLobby.members.every((m) => m.ready),
    });
  }

  private closeLobby(): void {
    this.cleanupNet();
    this.mode = 'hangar';
    this.lobby.hide();
    this.hangar.show();
  }

  private cleanupNet(): void {
    this.hostRun?.destroy();
    this.hostRun = null;
    this.clientRun?.destroy();
    this.clientRun = null;
    this.hostLobby?.destroy();
    this.hostLobby = null;
    this.clientLobby?.destroy();
    this.clientLobby = null;
    this.hostCtx?.destroy();
    this.hostCtx = null;
    this.clientCtx?.destroy();
    this.clientCtx = null;
    this.netRole = 'none';
  }

  // ---------- забег ----------

  private enterRunScene(roster: RosterView[], localPid: number): void {
    this.runScene?.dispose();
    this.runScene = new RunScene(this.core, roster, localPid, document.getElementById('ui')!, (x, y, text, cls) => {
      const scene = this.runScene;
      if (!scene) return;
      const s = scene.worldToScreen(x, y);
      this.hud.floater(s.x, s.y, text, cls);
    });
    this.paused = false;
    this.netMenuOpen = false;
    this.levelUpOpen = false;
    this.resultsShown = false;
    this.screens.hideAll();
    this.hangar.hide();
    this.lobby.hide();
    this.hud.show();
    this.input.setAbilitiesVisible(true);
    this.mode = 'run';
  }

  private startRun(): void {
    this.cleanupNet();
    this.sim = new RunSim(this.buildStart(), this.rng.int(2 ** 31));
    this.enterRunScene([{ pid: 0, name: 'Пилот', colorIdx: 0 }], 0);
  }

  private startHostRun(): void {
    if (!this.hostCtx || !this.hostLobby) return;
    const payload = this.hostLobby.start();
    this.hostRun = new HostRun(this.hostCtx, payload, {
      onCardOffer: (cards) => this.openNetLevelUp(cards),
      onEnd: (results) => this.finishNetRun(results),
    });
    this.enterRunScene(payload.roster, 0);
  }

  private startClientRun(payload: StartPayload): void {
    if (!this.clientCtx) return;
    this.clientRun = new ClientRun(this.clientCtx, payload, {
      onCardOffer: (cards) => this.openNetLevelUp(cards),
      onEnd: (results) => this.finishNetRun(results),
      onBackToLobby: () => this.backToLobbyFromRun(),
      onConnectionLost: () => this.netRunLost('Соединение с хостом потеряно.'),
    });
    this.enterRunScene(payload.roster, payload.yourPid);
  }

  private runView(): { view: RunView; events: GameEvent[] } | null {
    if (this.netRole === 'host' && this.hostRun) return { view: this.hostRun.sim, events: this.hostRun.frame() };
    if (this.netRole === 'client' && this.clientRun) return { view: this.clientRun.view, events: this.clientRun.frame(this.lastFrameDt) };
    if (this.netRole === 'none' && this.sim) return { view: this.sim, events: this.sim.drainEvents() };
    return null;
  }

  private lastFrameDt = 0;

  private toHangar(): void {
    this.mode = 'hangar';
    this.sim = null;
    this.cleanupNet();
    this.runScene?.dispose();
    this.runScene = null;
    this.hud.hide();
    this.screens.hideAll();
    this.lobby.hide();
    this.input.setAbilitiesVisible(false);
    this.hangar.show();
  }

  private togglePauseOrMenu(force?: boolean): void {
    if (this.mode !== 'run' || this.resultsShown) return;
    if (this.netRole === 'none') this.togglePause(force);
    else this.toggleNetMenu(force);
  }

  private togglePause(force?: boolean): void {
    if (!this.sim || this.sim.state !== 'running') return;
    const target = force ?? !this.paused;
    if (target === this.paused) return;
    this.paused = target;
    if (target) this.screens.showPause();
    else this.screens.hidePause();
  }

  /** В сетевом забеге меню не останавливает симуляцию. */
  private toggleNetMenu(force?: boolean): void {
    const target = force ?? !this.netMenuOpen;
    if (target === this.netMenuOpen) return;
    this.netMenuOpen = target;
    if (target) this.screens.showPauseNet(() => this.quitNetRun());
    else this.screens.hidePause();
  }

  private quitNetRun(): void {
    this.screens.hidePause();
    this.netMenuOpen = false;
    if (this.netRole === 'host') {
      // хост ушёл — забег и лобби заканчиваются для всех
      this.toHangar();
    } else {
      // клиент возвращается в лобби, его бот умирает на стороне хоста
      this.clientRun?.destroy();
      this.clientRun = null;
      this.clientLobby?.reactivate();
      this.exitRunToLobby();
      this.showClientRoom();
    }
  }

  private exitRunToLobby(): void {
    this.runScene?.dispose();
    this.runScene = null;
    this.hud.hide();
    this.screens.hideAll();
    this.input.setAbilitiesVisible(false);
    this.resultsShown = false;
    this.mode = 'lobby';
    this.lobby.show();
  }

  private hostReturnToLobby(): void {
    if (this.netRole !== 'host') return;
    this.hostRun?.destroy();
    this.hostRun = null;
    this.hostLobby?.reactivate();
    this.hostLobby?.reopen();
    this.exitRunToLobby();
    this.showHostRoom();
  }

  private backToLobbyFromRun(): void {
    this.clientRun?.destroy();
    this.clientRun = null;
    this.clientLobby?.reactivate();
    this.exitRunToLobby();
    this.showClientRoom();
  }

  private netRunLost(msg: string): void {
    this.resultsShown = true;
    this.screens.hideAll();
    this.screens.showNetError(msg, () => this.toHangar());
  }

  // ---------- цикл ----------

  private fixedUpdate(dt: number): void {
    if (this.mode !== 'run' || this.resultsShown) return;
    const mv = this.input.move();
    const snap: InputSnapshot = {
      moveX: mv.x,
      moveY: mv.y,
      dash: this.input.consumeDash(),
      shield: this.input.consumeShield(),
    };
    if (this.netRole === 'host') {
      this.hostRun?.fixedTick(dt, snap);
      return;
    }
    if (this.netRole === 'client') {
      this.clientRun?.fixedTick(dt, snap);
      return;
    }
    const sim = this.sim;
    if (!sim) return;
    if (this.paused || this.levelUpOpen || sim.state !== 'running') return;
    sim.tick(dt, snap);
  }

  private frame(dt: number, wall: number): void {
    this.lastFrameDt = dt;
    if (this.mode !== 'run') {
      this.hangarScene.update(dt);
      this.core.renderer.render(this.hangarScene.scene, this.hangarScene.camera);
      return;
    }
    const scene = this.runScene;
    if (!scene) return;

    const got = this.runView();
    if (!got) return;
    const { view } = got;

    scene.sync(view, dt, wall, got.events);
    this.core.renderer.render(scene.scene, scene.camera);
    this.hud.update(view);
    const fr = scene.abilityFracs(view);
    this.input.setAbilityState(fr.dash, fr.shield, fr.shieldOn);

    if (this.netRole === 'none' && this.sim) {
      const sim = this.sim;
      if (sim.player.pendingLevelUps > 0 && !this.levelUpOpen && !this.resultsShown) {
        this.openLevelUp();
      }
      if (sim.state !== 'running' && !this.resultsShown) {
        this.finishRun();
      }
    }
  }

  // ---------- карточки ----------

  private openLevelUp(): void {
    const sim = this.sim!;
    this.levelUpOpen = true;
    const cards = rollCards(this.rng, sim);
    if (cards.length === 0) {
      // пул исчерпан — утешительное лечение
      sim.player.hp = Math.min(sim.player.maxHp, sim.player.hp + 25);
      sim.player.pendingLevelUps--;
      this.levelUpOpen = false;
      return;
    }
    const views: CardView[] = cards.map((c) => ({
      card: c,
      icon: cardIcon(c),
      title: cardTitle(c, sim),
      desc: cardDesc(c),
    }));
    const pick = (card: Card) => {
      applyCard(sim, card);
      sim.player.pendingLevelUps--;
      this.levelUpOpen = false;
      this.screens.hideLevelUp();
      if (sim.player.pendingLevelUps > 0) this.openLevelUp();
    };
    this.screens.showLevelUp(views, pick);
  }

  /** Карточки в сетевом забеге: паузы нет, выбор уходит хосту. */
  private openNetLevelUp(cards: Card[]): void {
    const view = this.runView()?.view;
    if (!view) return;
    const views: CardView[] = cards.map((c) => ({
      card: c,
      icon: cardIcon(c),
      title: cardTitle(c, view as never, view.player),
      desc: cardDesc(c),
    }));
    const pick = (card: Card) => {
      this.screens.hideLevelUp();
      if (this.netRole === 'host') this.hostRun?.pickCard(0, card);
      else this.clientRun?.pickCard(card);
    };
    this.screens.showLevelUp(views, pick);
  }

  // ---------- результаты ----------

  /** Записывает награды в сейв, возвращает true если поставлен рекорд времени. */
  private applyRewards(r: { won: boolean; timeSec: number; level: number; kills: number; scrap: number; blueprints: string[] }): boolean {
    const record = !r.won && r.timeSec > this.save.bestTimeSec;
    this.save.scrap += r.scrap;
    this.save.totalRuns++;
    this.save.totalKills += r.kills;
    if (!r.won && record) this.save.bestTimeSec = Math.floor(r.timeSec);
    this.save.bestKills = Math.max(this.save.bestKills, r.kills);
    this.save.bestLevel = Math.max(this.save.bestLevel, r.level);
    for (const bp of r.blueprints) {
      if (!this.save.blueprints.includes(bp) && !this.save.owned.includes(bp)) this.save.blueprints.push(bp);
    }
    persistSave(this.save);
    return record;
  }

  private finishRun(): void {
    const sim = this.sim!;
    const won = sim.state === 'won';
    this.resultsShown = true;
    const record = this.applyRewards({
      won,
      timeSec: sim.time,
      level: sim.level,
      kills: sim.kills,
      scrap: sim.player.scrapCollected,
      blueprints: sim.player.foundBlueprints,
    });
    window.setTimeout(
      () => {
        this.screens.showResults({
          won,
          timeSec: sim.time,
          level: sim.level,
          kills: sim.kills,
          scrap: sim.player.scrapCollected,
          record,
          blueprints: sim.player.foundBlueprints,
        });
      },
      won ? 900 : 1300,
    );
  }

  private finishNetRun(results: PlayerResult[]): void {
    if (this.resultsShown) return;
    const myPid = this.netRole === 'host' ? 0 : (this.clientLobby?.yourPid ?? -1);
    const mine = results.find((r) => r.pid === myPid) ?? results[0];
    if (!mine) return;
    this.resultsShown = true;
    const record = this.applyRewards(mine);
    window.setTimeout(
      () => {
        this.screens.showResults(
          {
            won: mine.won,
            timeSec: mine.timeSec,
            level: mine.level,
            kills: mine.kills,
            scrap: mine.scrap,
            record,
            blueprints: mine.blueprints,
          },
          { net: this.netRole === 'host' ? 'host' : 'client' },
        );
      },
      mine.won ? 900 : 1300,
    );
  }
}

new GameApp();
