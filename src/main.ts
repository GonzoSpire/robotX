import './style.css';
import { FixedLoop } from './core/loop';
import { Rng } from './core/rng';
import { loadSave, persistSave } from './core/save';
import { InputManager } from './input/input';
import { RenderCore } from './render/core';
import { HangarScene } from './render/hangarScene';
import { RunScene } from './render/runScene';
import { applyCard, cardDesc, cardIcon, cardTitle, rollCards, type Card } from './run/cards';
import { RunSim, defaultStart, type InputSnapshot, type RunStartConfig } from './run/sim';
import { computeLoadoutStats } from './meta/loadout';
import { blueprintDropPool } from './meta/crafting';
import { HangarScreen } from './ui/hangar';
import { Hud } from './ui/hud';
import { Screens, type CardView } from './ui/screens';

class GameApp {
  mode: 'hangar' | 'run' = 'hangar';
  private paused = false;
  private levelUpOpen = false;
  private resultsShown = false;
  private sim: RunSim | null = null;
  private runScene: RunScene | null = null;
  private readonly rng = new Rng();
  private readonly save = loadSave();

  private readonly core: RenderCore;
  private readonly hangarScene: HangarScene;
  private readonly hangar: HangarScreen;
  private readonly input: InputManager;
  private readonly hud: Hud;
  private readonly screens: Screens;
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
    this.hud = new Hud(ui, () => this.togglePause());
    this.hud.hide();
    this.input.setAbilitiesVisible(false);
    this.hangar = new HangarScreen(ui, this.save, { onStartRun: () => this.startRun() });
    this.screens = new Screens(ui, {
      onRetry: () => this.startRun(),
      onToHangar: () => this.toHangar(),
      onResume: () => this.togglePause(false),
      onRestart: () => this.startRun(),
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.mode === 'run' && !this.levelUpOpen && !this.resultsShown) {
        this.togglePause();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'run' && this.sim?.state === 'running' && !this.levelUpOpen) {
        this.togglePause(true);
      }
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    this.hangar.show();
    this.loop.start();

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

  private startRun(): void {
    this.sim = new RunSim(this.buildStart(), this.rng.int(2 ** 31));
    this.runScene?.dispose();
    this.runScene = new RunScene(this.core, (x, y, text, cls) => {
      const scene = this.runScene;
      if (!scene) return;
      const s = scene.worldToScreen(x, y);
      this.hud.floater(s.x, s.y, text, cls);
    });
    this.paused = false;
    this.levelUpOpen = false;
    this.resultsShown = false;
    this.screens.hideAll();
    this.hangar.hide();
    this.hud.show();
    this.input.setAbilitiesVisible(true);
    this.mode = 'run';
  }

  private toHangar(): void {
    this.mode = 'hangar';
    this.sim = null;
    this.runScene?.dispose();
    this.runScene = null;
    this.hud.hide();
    this.screens.hideAll();
    this.input.setAbilitiesVisible(false);
    this.hangar.show();
  }

  private togglePause(force?: boolean): void {
    if (this.mode !== 'run' || !this.sim || this.sim.state !== 'running') return;
    const target = force ?? !this.paused;
    if (target === this.paused) return;
    this.paused = target;
    if (target) this.screens.showPause();
    else this.screens.hidePause();
  }

  private fixedUpdate(dt: number): void {
    const sim = this.sim;
    if (this.mode !== 'run' || !sim) return;
    if (this.paused || this.levelUpOpen || this.resultsShown || sim.state !== 'running') return;
    const mv = this.input.move();
    const snap: InputSnapshot = {
      moveX: mv.x,
      moveY: mv.y,
      dash: this.input.consumeDash(),
      shield: this.input.consumeShield(),
    };
    sim.tick(dt, snap);
  }

  private frame(dt: number, wall: number): void {
    if (this.mode === 'hangar') {
      this.hangarScene.update(dt);
      this.core.renderer.render(this.hangarScene.scene, this.hangarScene.camera);
      return;
    }
    const sim = this.sim;
    const scene = this.runScene;
    if (!sim || !scene) return;

    const events = sim.drainEvents();
    scene.sync(sim, dt, wall, events);
    this.core.renderer.render(scene.scene, scene.camera);
    this.hud.update(sim);
    const fr = scene.abilityFracs(sim);
    this.input.setAbilityState(fr.dash, fr.shield, fr.shieldOn);

    if (sim.pendingLevelUps > 0 && !this.levelUpOpen && !this.resultsShown) {
      this.openLevelUp();
    }
    if (sim.state !== 'running' && !this.resultsShown) {
      this.finishRun();
    }
  }

  private openLevelUp(): void {
    const sim = this.sim!;
    this.levelUpOpen = true;
    const cards = rollCards(this.rng, sim);
    if (cards.length === 0) {
      // пул исчерпан — утешительное лечение
      sim.player.hp = Math.min(sim.player.maxHp, sim.player.hp + 25);
      sim.pendingLevelUps--;
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
      sim.pendingLevelUps--;
      this.levelUpOpen = false;
      this.screens.hideLevelUp();
      if (sim.pendingLevelUps > 0) this.openLevelUp();
    };
    this.screens.showLevelUp(views, pick);
  }

  private finishRun(): void {
    const sim = this.sim!;
    const won = sim.state === 'won';
    this.resultsShown = true;

    this.save.scrap += sim.scrapCollected;
    this.save.totalRuns++;
    this.save.totalKills += sim.kills;
    const record = sim.time > this.save.bestTimeSec;
    if (record) this.save.bestTimeSec = Math.floor(sim.time);
    this.save.bestKills = Math.max(this.save.bestKills, sim.kills);
    this.save.bestLevel = Math.max(this.save.bestLevel, sim.player.level);
    for (const bp of sim.foundBlueprints) {
      if (!this.save.blueprints.includes(bp) && !this.save.owned.includes(bp)) this.save.blueprints.push(bp);
    }
    persistSave(this.save);

    window.setTimeout(
      () => {
        this.screens.showResults({
          won,
          timeSec: sim.time,
          level: sim.player.level,
          kills: sim.kills,
          scrap: sim.scrapCollected,
          record,
          blueprints: sim.foundBlueprints,
        });
      },
      won ? 900 : 1300,
    );
  }
}

new GameApp();
