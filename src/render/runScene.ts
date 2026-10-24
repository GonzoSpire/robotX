import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/math';
import type { GameEvent } from '../run/sim';
import { DASH_CD, SHIELD_CD } from '../run/sim';
import { PLAYER_ACCENTS, type RunView } from '../run/view';
import {
  boxGeo,
  buildEnemyBot,
  buildPlayerBot,
  forwardConeGeo,
  octaGeo,
  ringGeo,
  sphereGeo,
  setFlash,
  type BotView,
} from './bots';
import type { RenderCore } from './core';

const CAM_H = 13.5;
const CAM_D = 8.5;

export interface RosterView {
  pid: number;
  name: string;
  colorIdx: number;
}

interface EnemyItem {
  view: BotView;
}
interface PlayerItem {
  pid: number;
  view: BotView;
  shieldMesh: THREE.Mesh;
  shieldMat: THREE.MeshBasicMaterial;
  deadT: number;
  nameplate: HTMLElement | null;
}
interface FxSpark {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  s0: number;
  s1: number;
}
interface FxBoom {
  group: THREE.Object3D;
  sphereMat: THREE.MeshBasicMaterial;
  ringMat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  r: number;
}
interface FxBeam {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
}
interface FxFlame {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
}

export class RunScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private playerItems = new Map<number, PlayerItem>();
  private readonly localPid: number;
  private enemyViews = new Map<number, EnemyItem>();
  private projViews = new Map<number, THREE.Mesh>();
  private boltViews = new Map<number, THREE.Mesh>();
  private gemViews = new Map<number, THREE.Mesh>();
  private mineViews = new Map<number, THREE.Group>();
  private waveViews = new Map<number, THREE.Mesh>();
  private droneViews: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }> = [];

  private sparks: FxSpark[] = [];
  private booms: FxBoom[] = [];
  private beams: FxBeam[] = [];
  private flames: FxFlame[] = [];

  private shake = 0;
  private camX = 0;
  private camY = 0;
  private readonly v = new THREE.Vector3();
  private readonly nameplates: HTMLElement;

  constructor(
    private readonly core: RenderCore,
    roster: RosterView[],
    localPid: number,
    uiRoot: HTMLElement,
    private readonly onFloater: (x: number, y: number, text: string, cls: string) => void,
  ) {
    this.localPid = localPid;
    this.scene.background = new THREE.Color(0x0b0e13);
    this.scene.fog = new THREE.Fog(0x0b0e13, 22, 58);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);

    this.nameplates = document.createElement('div');
    this.nameplates.className = 'nameplates';
    uiRoot.appendChild(this.nameplates);

    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x39424e, 1.25);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffe0b0, 1.6);
    dir.position.set(6, 14, 4);
    this.scene.add(dir);

    this.buildArena();

    for (const r of roster) {
      const accent = PLAYER_ACCENTS[r.colorIdx] ?? PLAYER_ACCENTS[0];
      const view = buildPlayerBot(accent);
      this.scene.add(view.group);
      if (r.pid === localPid) {
        const pl = new THREE.PointLight(accent, 14, 11, 2);
        pl.position.set(0, 2.2, 0);
        view.group.add(pl);
      }
      const shieldMat = new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const shieldMesh = new THREE.Mesh(sphereGeo(1, 18), shieldMat);
      shieldMesh.position.y = 0.8;
      shieldMesh.scale.setScalar(1.15);
      shieldMesh.visible = false;
      view.group.add(shieldMesh);

      let nameplate: HTMLElement | null = null;
      if (r.pid !== localPid) {
        nameplate = document.createElement('div');
        nameplate.className = 'nameplate';
        nameplate.textContent = r.name;
        this.nameplates.appendChild(nameplate);
      }
      this.playerItems.set(r.pid, { pid: r.pid, view, shieldMesh, shieldMat, deadT: 0, nameplate });
    }

    core.onResize((w, h) => {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });
  }

  // ---------- арена ----------

  private buildArena(): void {
    const W = 28;
    const H = 18;

    const tex = this.makeGridTexture();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 2 + 10, H * 2 + 10),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0.05 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshStandardMaterial({ color: 0x07090d, roughness: 1 }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.06;
    this.scene.add(outer);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a212b, roughness: 0.7, metalness: 0.3 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x33230f, emissive: 0xff9e3d, emissiveIntensity: 1.2 });
    const mk = (w: number, d: number, x: number, z: number) => {
      const wall = new THREE.Mesh(boxGeo(w, 1.2, d), wallMat);
      wall.position.set(x, 0.6, z);
      this.scene.add(wall);
      const trim = new THREE.Mesh(boxGeo(w, 0.07, 0.12), trimMat);
      trim.position.set(x, 1.24, z);
      this.scene.add(trim);
    };
    mk(W * 2 + 2, 0.7, 0, H + 0.35);
    mk(W * 2 + 2, 0.7, 0, -H - 0.35);
    mk(0.7, H * 2 + 2, W + 0.35, 0);
    mk(0.7, H * 2 + 2, -W - 0.35, 0);
  }

  private makeGridTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#141a22';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#1c2530';
    g.lineWidth = 2;
    g.strokeRect(0, 0, 128, 128);
    g.beginPath();
    g.moveTo(64, 0);
    g.lineTo(64, 128);
    g.moveTo(0, 64);
    g.lineTo(128, 64);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(28, 18);
    tex.magFilter = THREE.NearestFilter;
    return tex;
  }

  // ---------- синхронизация с симуляцией ----------

  sync(sim: RunView, dt: number, wall: number, events: GameEvent[]): void {
    this.updateCamera(sim, dt);
    this.updatePlayers(sim, dt, wall);
    this.updateEnemies(sim, wall);
    this.updateProjectiles(sim);
    this.updateSimpleEntities(sim, wall);
    this.updateDrones(sim, wall);
    this.updateNameplates();
    this.updateFx(dt);
    for (const ev of events) this.handleEvent(ev, sim);
  }

  /** Свой робот; после смерти — ближайший живой союзник (спектатор). */
  private cameraTarget(sim: RunView) {
    const own = sim.players.find((p) => p.id === this.localPid);
    if (own && !own.dead) return own;
    let best = own ?? sim.players[0];
    let bestD2 = Infinity;
    for (const p of sim.players) {
      if (p.dead) continue;
      const d2 = (p.x - (best?.x ?? 0)) ** 2 + (p.y - (best?.y ?? 0)) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = p;
      }
    }
    return best;
  }

  private updateCamera(sim: RunView, dt: number): void {
    const p = this.cameraTarget(sim);
    this.camX = damp(this.camX, p.x, 6, dt);
    this.camY = damp(this.camY, p.y, 6, dt);
    this.shake = Math.max(0, this.shake - this.shake * 5 * dt - 0.01 * dt);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    this.camera.position.set(this.camX + sx, CAM_H, this.camY + CAM_D + sy);
    this.camera.lookAt(this.camX, 0.6, this.camY);
  }

  private updatePlayers(sim: RunView, dt: number, wall: number): void {
    for (const p of sim.players) {
      const item = this.playerItems.get(p.id);
      if (!item) continue;
      const g = item.view.group;
      g.position.set(p.x, 0, p.y);
      g.rotation.y = Math.atan2(p.facingX, p.facingY);

      if (p.dead) {
        item.deadT += dt;
        g.rotation.z = Math.min(item.deadT * 4, Math.PI / 2);
        item.view.body.position.y = -Math.min(item.deadT * 0.8, 0.35);
      } else {
        item.deadT = 0;
        const bobK = p.moving ? 1 : 0.3;
        item.view.body.position.y = Math.abs(Math.sin(wall * 11)) * 0.05 * bobK;
        item.view.body.rotation.x = p.moving ? 0.06 : 0;
        const stretch = p.dashT > 0 ? 1 : 0;
        item.view.body.scale.z = lerp(item.view.body.scale.z, stretch ? 1.3 : 1, 1 - Math.exp(-14 * dt));
      }

      const shieldOn = p.shieldT > 0;
      item.shieldMesh.visible = shieldOn;
      if (shieldOn) {
        item.shieldMat.opacity = 0.16 + Math.sin(wall * 9) * 0.06 + (p.shieldT < 1 ? Math.sin(wall * 25) * 0.1 : 0);
      }
      setFlash(item.view, p.iframe > 0.35 ? 0.7 : 0);
      if (item.nameplate) item.nameplate.style.opacity = p.dead ? '0' : '1';
    }
  }

  private updateNameplates(): void {
    for (const item of this.playerItems.values()) {
      if (!item.nameplate) continue;
      const g = item.view.group;
      const s = this.worldToScreen(g.position.x, g.position.z, 2.3);
      item.nameplate.style.transform = `translate(-50%,-100%) translate(${s.x}px,${s.y}px)`;
    }
  }

  private updateEnemies(sim: RunView, wall: number): void {
    const seen = new Set<number>();
    for (const e of sim.enemies) {
      seen.add(e.uid);
      let item = this.enemyViews.get(e.uid);
      if (!item) {
        item = { view: buildEnemyBot(e.def.id) };
        this.scene.add(item.view.group);
        this.enemyViews.set(e.uid, item);
      }
      const v = item.view;
      v.group.position.set(e.x, 0, e.y);
      // моб смотрит на ближайшего живого игрока
      let tx = sim.players[0]?.x ?? 0;
      let ty = sim.players[0]?.y ?? 0;
      let bestD2 = Infinity;
      for (const p of sim.players) {
        if (p.dead) continue;
        const d2 = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          tx = p.x;
          ty = p.y;
        }
      }
      v.group.rotation.y = Math.atan2(tx - e.x, ty - e.y);
      const spawnK = e.spawnT > 0 ? 1 - e.spawnT / 0.35 : 1;
      const pop = 0.3 + 0.7 * spawnK;
      v.group.scale.setScalar(pop);
      setFlash(v, e.flashT > 0 ? clamp(e.flashT / 0.12, 0, 1) : 0);

      const speedK = e.state === 'dash' ? 1 : 0.5;
      v.body.position.y = Math.abs(Math.sin(wall * 10 + e.uid)) * 0.05 * speedK;
      if (e.state === 'windup') v.body.position.x = Math.sin(wall * 42) * 0.05;
      else v.body.position.x = 0;
      if (e.def.id === 'boss') v.body.position.y += Math.sin(wall * 2.2) * 0.08;
    }
    for (const [uid, item] of this.enemyViews) {
      if (seen.has(uid)) continue;
      this.scene.remove(item.view.group);
      disposeMaterials(item.view.group);
      this.enemyViews.delete(uid);
    }
  }

  private updateProjectiles(sim: RunView): void {
    const seenP = new Set<number>();
    for (const pr of sim.projectiles) {
      seenP.add(pr.uid);
      let mesh = this.projViews.get(pr.uid);
      if (!mesh) {
        if (pr.kind === 'missile') {
          mesh = new THREE.Mesh(
            forwardConeGeo(0.13, 0.55),
            new THREE.MeshBasicMaterial({ color: 0xffc46b }),
          );
        } else {
          mesh = new THREE.Mesh(
            boxGeo(0.1, 0.1, 0.42),
            new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
          );
        }
        this.scene.add(mesh);
        this.projViews.set(pr.uid, mesh);
      }
      mesh.position.set(pr.x, 0.85, pr.y);
      mesh.rotation.y = Math.atan2(pr.vx, pr.vy);
    }
    this.releaseUnseen(this.projViews, seenP);

    const seenB = new Set<number>();
    for (const b of sim.bolts) {
      seenB.add(b.uid);
      let mesh = this.boltViews.get(b.uid);
      if (!mesh) {
        mesh = new THREE.Mesh(
          sphereGeo(0.2, 10),
          new THREE.MeshBasicMaterial({ color: 0xc06bff }),
        );
        this.scene.add(mesh);
        this.boltViews.set(b.uid, mesh);
      }
      mesh.position.set(b.x, 0.8, b.y);
    }
    this.releaseUnseen(this.boltViews, seenB);
  }

  private updateSimpleEntities(sim: RunView, wall: number): void {
    const seenG = new Set<number>();
    for (const gem of sim.gems) {
      seenG.add(gem.uid);
      let mesh = this.gemViews.get(gem.uid);
      if (!mesh) {
        if (gem.kind === 'xp') {
          mesh = new THREE.Mesh(
            octaGeo(0.2),
            new THREE.MeshBasicMaterial({ color: 0x3ef0d0 }),
          );
        } else if (gem.kind === 'blueprint') {
          mesh = new THREE.Mesh(
            octaGeo(0.26),
            new THREE.MeshBasicMaterial({ color: 0x9ad8ff }),
          );
        } else {
          mesh = new THREE.Mesh(
            boxGeo(0.24, 0.24, 0.24),
            new THREE.MeshBasicMaterial({ color: 0xffa24b }),
          );
        }
        this.scene.add(mesh);
        this.gemViews.set(gem.uid, mesh);
      }
      mesh.position.set(gem.x, 0.4 + Math.sin(wall * 5 + gem.uid) * 0.08, gem.y);
      mesh.rotation.y = wall * 2 + gem.uid;
      mesh.scale.setScalar(gem.magnet ? 1.25 : 1);
    }
    this.releaseUnseen(this.gemViews, seenG);

    const seenM = new Set<number>();
    for (const m of sim.mines) {
      seenM.add(m.uid);
      let group = this.mineViews.get(m.uid);
      if (!group) {
        group = new THREE.Group();
        const body = new THREE.Mesh(
          new THREE.CylinderGeometry(0.28, 0.34, 0.14, 10),
          new THREE.MeshStandardMaterial({ color: 0x2c3540, roughness: 0.6, metalness: 0.4 }),
        );
        const lampMat = new THREE.MeshStandardMaterial({ color: 0x330b0b, emissive: 0xff3b4e, emissiveIntensity: 1 });
        const lamp = new THREE.Mesh(boxGeo(0.14, 0.06, 0.14), lampMat);
        lamp.position.y = 0.09;
        group.add(body, lamp);
        this.scene.add(group);
        this.mineViews.set(m.uid, group);
      }
      const lampMat = (group.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      lampMat.emissiveIntensity = m.armT > 0 ? 1.2 : Math.sin(wall * 12) > 0 ? 1.6 : 0.25;
      group.position.set(m.x, 0.08, m.y);
    }
    this.releaseUnseen(this.mineViews, seenM);

    const seenW = new Set<number>();
    for (const sw of sim.shockwaves) {
      seenW.add(sw.uid);
      let mesh = this.waveViews.get(sw.uid);
      if (!mesh) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0x7ef2ff,
          transparent: true,
          opacity: 0.8,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        mesh = new THREE.Mesh(ringGeo(0.92, 1, 48), mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.25;
        this.scene.add(mesh);
        this.waveViews.set(sw.uid, mesh);
      }
      mesh.position.x = sw.x;
      mesh.position.z = sw.y;
      mesh.scale.setScalar(sw.r);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = clamp(1 - sw.r / sw.maxR, 0, 1) * 0.85;
    }
    this.releaseUnseen(this.waveViews, seenW);
  }

  private updateDrones(sim: RunView, wall: number): void {
    let total = 0;
    for (const p of sim.players) {
      if (p.dead) continue;
      for (const w of p.weapons) total += w.drones.length;
    }
    while (this.droneViews.length < total) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x7ef2ff });
      const mesh = new THREE.Mesh(octaGeo(0.26), mat);
      this.scene.add(mesh);
      this.droneViews.push({ mesh, mat });
    }
    let i = 0;
    for (const p of sim.players) {
      if (p.dead) continue;
      const color = PLAYER_ACCENTS[p.colorIdx] ?? PLAYER_ACCENTS[0];
      for (const w of p.weapons) {
        for (const d of w.drones) {
          const dv = this.droneViews[i++];
          dv.mesh.visible = true;
          dv.mat.color.setHex(color);
          dv.mesh.position.set(d.x, 1.0 + Math.sin(wall * 6 + i) * 0.1, d.y);
          dv.mesh.rotation.y = wall * 5;
          dv.mesh.rotation.x = Math.PI / 2;
        }
      }
    }
    for (; i < this.droneViews.length; i++) this.droneViews[i].mesh.visible = false;
  }

  private releaseUnseen(map: Map<number, THREE.Object3D>, seen: Set<number>): void {
    for (const [uid, obj] of map) {
      if (seen.has(uid)) continue;
      this.scene.remove(obj);
      disposeMaterials(obj);
      map.delete(uid);
    }
  }

  // ---------- события → эффекты ----------

  private handleEvent(ev: GameEvent, sim: RunView): void {
    const own = sim.players.find((p) => p.id === this.localPid);
    switch (ev.t) {
      case 'shoot':
        this.spawnSpark(ev.x + ev.dx * 1.1, ev.y + ev.dy * 1.1, 0.35, 0xffd9a0, 0.08);
        break;
      case 'hit': {
        this.spawnSpark(ev.x, ev.y, ev.crit ? 0.55 : 0.35, ev.crit ? 0xffe14d : 0xffffff, 0.16);
        this.onFloater(ev.x, ev.y, String(ev.dmg), ev.crit ? 'crit' : 'dmg');
        break;
      }
      case 'kill':
        this.spawnSpark(ev.x, ev.y, 0.8, 0xff5a5a, 0.3);
        break;
      case 'damaged':
        if (ev.pid === this.localPid) {
          this.shake = Math.min(0.6, this.shake + 0.3);
          this.onFloater(ev.x, ev.y, `−${ev.amount}`, 'hurt');
        }
        break;
      case 'blocked':
        if (ev.pid === this.localPid) this.spawnSpark(ev.x, ev.y, 0.7, 0x3ef0d0, 0.2);
        break;
      case 'shield':
        this.spawnRing(ev.x, ev.y, 1.6, 0x3ef0d0);
        break;
      case 'beam':
        this.spawnBeam(ev.x1, ev.y1, ev.x2, ev.y2, ev.w);
        break;
      case 'flame':
        this.spawnFlame(ev.x, ev.y, ev.dx, ev.dy, ev.range);
        break;
      case 'boom':
        this.spawnBoom(ev.x, ev.y, ev.r);
        this.shake = Math.min(0.6, this.shake + 0.12);
        break;
      case 'nova':
        break;
      case 'levelup':
        if (ev.pid === this.localPid) {
          this.onFloater(ev.x, ev.y, `УРОВЕНЬ ${ev.level}`, 'levelup');
        }
        this.spawnRing(ev.x, ev.y, 2.4, 0xffe14d);
        break;
      case 'scrap':
        if (ev.pid === this.localPid) this.onFloater(ev.x, ev.y, `+${ev.amount} ⚙`, 'scrap');
        break;
      case 'blueprint':
        if (ev.pid === this.localPid) this.onFloater(ev.x, ev.y, '★ ЧЕРТЁЖ ★', 'levelup');
        this.spawnRing(ev.x, ev.y, 2, 0x9ad8ff);
        this.shake = 0.2;
        break;
      case 'bossWarn':
        this.onFloater(own?.x ?? 0, own?.y ?? 0, '!! ЯДРО-ТИТАН !!', 'boss');
        this.shake = 0.4;
        break;
      case 'bossSpawn':
        this.spawnBoom(ev.x, ev.y, 3);
        this.shake = 0.5;
        break;
      case 'died':
        this.shake = Math.max(this.shake, 0.5);
        this.spawnBoom(ev.x, ev.y, 1.6);
        break;
      case 'won':
        this.spawnRing(own?.x ?? 0, own?.y ?? 0, 4, 0xffe14d);
        this.shake = 0.4;
        break;
      default:
        break;
    }
  }

  // ---------- пулы эффектов ----------

  private spawnSpark(x: number, y: number, size: number, color: number, dur: number): void {
    let fx = this.sparks.find((s) => s.t >= s.dur);
    if (!fx) {
      if (this.sparks.length > 48) return;
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(sphereGeo(0.24, 8), mat);
      this.scene.add(mesh);
      fx = { mesh, mat, t: 0, dur: 1, s0: 0.5, s1: 1 };
      this.sparks.push(fx);
    }
    fx.t = 0;
    fx.dur = dur;
    fx.s0 = size * 0.6;
    fx.s1 = size * 1.8;
    fx.mat.color.setHex(color);
    fx.mat.opacity = 0.95;
    fx.mesh.position.set(x, 0.8, y);
    fx.mesh.visible = true;
  }

  private spawnRing(x: number, y: number, r: number, color: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(ringGeo(0.9, 1, 48), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.3, y);
    this.scene.add(mesh);
    this.booms.push({ group: mesh, sphereMat: mat, ringMat: mat, t: 0, dur: 0.35, r });
  }

  private spawnBoom(x: number, y: number, r: number): void {
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0xffb35c,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff7a3d,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sphere = new THREE.Mesh(sphereGeo(0.5, 12), sphereMat);
    sphere.position.y = 0.7;
    const ring = new THREE.Mesh(ringGeo(0.9, 1, 32), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2;
    const group = new THREE.Group();
    group.add(sphere, ring);
    group.position.set(x, 0, y);
    this.scene.add(group);
    this.booms.push({ group, sphereMat, ringMat, t: 0, dur: 0.3, r });
  }

  private spawnBeam(x1: number, y1: number, x2: number, y2: number, w: number): void {
    let fx = this.beams.find((b) => b.t >= b.dur);
    if (!fx) {
      if (this.beams.length > 5) return;
      const mat = new THREE.MeshBasicMaterial({
        color: 0x8ef2ff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(boxGeo(1, 1, 1), mat);
      this.scene.add(mesh);
      fx = { mesh, mat, t: 0, dur: 1 };
      this.beams.push(fx);
    }
    fx.t = 0;
    fx.dur = 0.14;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    fx.mesh.position.set((x1 + x2) / 2, 0.9, (y1 + y2) / 2);
    fx.mesh.rotation.y = Math.atan2(-dy, dx);
    fx.mesh.scale.set(len, w, w);
    fx.mat.opacity = 0.95;
    fx.mesh.visible = true;
  }

  private spawnFlame(x: number, y: number, dx: number, dy: number, range: number): void {
    let fx = this.flames.find((f) => f.t >= f.dur);
    if (!fx) {
      if (this.flames.length > 4) return;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff8c3b,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(forwardConeGeo(1, 1), mat);
      this.scene.add(mesh);
      fx = { mesh, mat, t: 0, dur: 1 };
      this.flames.push(fx);
    }
    fx.t = 0;
    fx.dur = 0.22;
    fx.mesh.position.set(x, 0.8, y);
    fx.mesh.rotation.y = Math.atan2(dx, dy);
    fx.mesh.scale.set(range * 0.55, range * 0.55, range);
    fx.mat.opacity = 0.42;
    fx.mesh.visible = true;
  }

  private updateFx(dt: number): void {
    for (const s of this.sparks) {
      if (s.t >= s.dur) {
        s.mesh.visible = false;
        continue;
      }
      s.t += dt;
      const k = clamp(s.t / s.dur, 0, 1);
      s.mesh.scale.setScalar(lerp(s.s0, s.s1, k));
      s.mat.opacity = 1 - k;
    }
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i];
      b.t += dt;
      const k = clamp(b.t / b.dur, 0, 1);
      const sphere = b.group.children[0] as THREE.Mesh | undefined;
      if (sphere && b.sphereMat !== b.ringMat) {
        sphere.scale.setScalar(lerp(b.r * 0.3, b.r * 0.9, k));
        b.sphereMat.opacity = 0.85 * (1 - k);
      }
      b.group.scale.setScalar(lerp(0.4, b.r * 1.05, k));
      b.ringMat.opacity = 0.9 * (1 - k);
      if (b.t >= b.dur) {
        this.scene.remove(b.group);
        b.sphereMat.dispose();
        b.ringMat.dispose();
        this.booms.splice(i, 1);
      }
    }
    for (const b of this.beams) {
      if (b.t >= b.dur) {
        b.mesh.visible = false;
        continue;
      }
      b.t += dt;
      b.mat.opacity = 0.95 * (1 - clamp(b.t / b.dur, 0, 1));
    }
    for (const f of this.flames) {
      if (f.t >= f.dur) {
        f.mesh.visible = false;
        continue;
      }
      f.t += dt;
      f.mat.opacity = 0.42 * (1 - clamp(f.t / f.dur, 0, 1));
    }
  }

  // ---------- утилиты ----------

  worldToScreen(x: number, y: number, h = 0.8): { x: number; y: number } {
    this.v.set(x, h, y).project(this.camera);
    const c = this.core.renderer.domElement;
    return { x: (this.v.x * 0.5 + 0.5) * c.clientWidth, y: (-this.v.y * 0.5 + 0.5) * c.clientHeight };
  }

  /** Затухание после рывка/щита для кнопок HUD (локальный игрок). */
  abilityFracs(sim: RunView): { dash: number; shield: number; shieldOn: boolean } {
    const p = sim.players.find((x) => x.id === this.localPid) ?? sim.players[0];
    return {
      dash: p.dashCd / DASH_CD,
      shield: p.shieldCd / SHIELD_CD,
      shieldOn: p.shieldT > 0,
    };
  }

  dispose(): void {
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) disposeMaterials(obj);
    });
    for (const d of this.droneViews) d.mesh.visible = false;
    this.nameplates.remove();
  }
}

function disposeMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const m = obj.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    }
  });
}
