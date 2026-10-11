import * as THREE from 'three';
import { buildPlayerBot, cylGeo } from './bots';
import type { RenderCore } from './core';

/** Фон экрана ангара: подиум и медленно вращающийся робот. */
export class HangarScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private bot = buildPlayerBot();
  private t = 0;

  constructor(core: RenderCore) {
    this.scene.background = new THREE.Color(0x0b0e13);
    this.scene.fog = new THREE.Fog(0x0b0e13, 8, 26);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
    this.camera.position.set(1.6, 2.6, 6.4);
    this.camera.lookAt(1.6, 0.9, 0);

    this.scene.add(new THREE.HemisphereLight(0xbfd7ff, 0x1c222b, 0.7));
    const key = new THREE.DirectionalLight(0xffe0b0, 1.6);
    key.position.set(4, 6, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x3ef0d0, 2.2);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);

    const pedestal = new THREE.Mesh(
      cylGeo(1.5, 1.7, 0.3, 24),
      new THREE.MeshStandardMaterial({ color: 0x1a212b, roughness: 0.6, metalness: 0.4 }),
    );
    pedestal.position.y = -0.15;
    this.scene.add(pedestal);
    const ring = new THREE.Mesh(
      cylGeo(1.55, 1.55, 0.05, 24),
      new THREE.MeshStandardMaterial({ color: 0x0f2e29, emissive: 0x3ef0d0, emissiveIntensity: 1.4 }),
    );
    ring.position.y = 0.02;
    this.scene.add(ring);

    this.bot.group.position.y = 0.05;
    this.scene.add(this.bot.group);

    core.onResize((w, h) => {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });
  }

  update(dt: number): void {
    this.t += dt;
    this.bot.group.rotation.y = this.t * 0.5;
    this.bot.body.position.y = Math.sin(this.t * 1.8) * 0.04;
  }
}
