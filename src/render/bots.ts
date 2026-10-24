import * as THREE from 'three';
import { ENEMIES, type EnemyId } from '../content/enemies';

/** Кэш геометрий — переиспользуется всеми ботами и эффектами. */
const geoCache = new Map<string, THREE.BufferGeometry>();

function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}

export function boxGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  return geo(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
}

export function cylGeo(rt: number, rb: number, h: number, seg = 10): THREE.CylinderGeometry {
  return geo(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
}

export function octaGeo(r: number): THREE.OctahedronGeometry {
  return geo(`o${r}`, () => new THREE.OctahedronGeometry(r));
}

export function circleGeo(r: number, seg = 20): THREE.CircleGeometry {
  return geo(`ci${r}|${seg}`, () => new THREE.CircleGeometry(r, seg));
}

export function sphereGeo(r: number, seg = 12): THREE.SphereGeometry {
  return geo(`s${r}|${seg}`, () => new THREE.SphereGeometry(r, seg, seg));
}

export function ringGeo(inner: number, outer: number, seg = 48): THREE.RingGeometry {
  return geo(`r${inner}|${outer}|${seg}`, () => new THREE.RingGeometry(inner, outer, seg));
}

/** Конус «вперёд» (+Z), основание в нуле — для огнемёта/ракет. */
export function forwardConeGeo(r: number, h: number): THREE.ConeGeometry {
  return geo(`f${r}|${h}`, () => {
    const g = new THREE.ConeGeometry(r, h, 12, 1, true);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, h / 2);
    return g;
  });
}

export interface FlashMat {
  mat: THREE.MeshStandardMaterial;
  baseEmissive: THREE.Color;
  baseI: number;
}

export interface BotView {
  group: THREE.Group;
  body: THREE.Group;
  mats: FlashMat[];
}

function mat(color: number, emissive = 0x000000, ei = 0): FlashMat {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.75,
    metalness: 0.15,
    flatShading: true,
    emissive,
    emissiveIntensity: ei,
  });
  return { mat: m, baseEmissive: new THREE.Color(emissive), baseI: ei };
}

function part(parent: THREE.Object3D, g: THREE.BufferGeometry, fm: FlashMat, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(g, fm.mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function blobShadow(parent: THREE.Object3D, r: number): void {
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false });
  const mesh = new THREE.Mesh(circleGeo(1, 18), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  mesh.scale.setScalar(r);
  parent.add(mesh);
}

export function setFlash(view: BotView, k: number): void {
  for (const fm of view.mats) {
    if (k > 0) {
      fm.mat.emissive.setRGB(1, 0.95, 0.85).lerp(fm.baseEmissive, 1 - k);
      fm.mat.emissiveIntensity = fm.baseI + k * 1.6;
    } else {
      fm.mat.emissive.copy(fm.baseEmissive);
      fm.mat.emissiveIntensity = fm.baseI;
    }
  }
}

/** Бот игрока: коробчатый мех ~1.5 высотой, лицом к +Z. accent — цвет свечения игрока. */
export function buildPlayerBot(accent = 0x3ef0d0): BotView {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const shell = mat(0x5d6d7e);
  const dark = mat(0x2c3540);
  const glow = mat(0x1f4d47, accent, 0.9);
  const orange = mat(0x4a3520, 0xff9e3d, 0.7);
  const mats = [shell, dark, glow, orange];

  part(body, boxGeo(0.22, 0.5, 0.3), dark, -0.19, 0.25, 0);
  part(body, boxGeo(0.22, 0.5, 0.3), dark, 0.19, 0.25, 0);
  part(body, boxGeo(0.72, 0.56, 0.52), shell, 0, 0.78, 0);
  part(body, boxGeo(0.34, 0.22, 0.06), glow, 0, 0.82, 0.28);
  part(body, boxGeo(0.26, 0.26, 0.4), dark, -0.52, 0.95, 0.02);
  part(body, boxGeo(0.26, 0.26, 0.4), dark, 0.52, 0.95, 0.02);
  part(body, boxGeo(0.12, 0.12, 0.52), orange, -0.52, 0.95, 0.3);
  part(body, boxGeo(0.12, 0.12, 0.52), orange, 0.52, 0.95, 0.3);
  part(body, boxGeo(0.36, 0.3, 0.36), shell, 0, 1.24, 0);
  part(body, boxGeo(0.28, 0.09, 0.05), glow, 0, 1.26, 0.19);
  part(body, boxGeo(0.03, 0.3, 0.03), dark, 0.12, 1.5, -0.08);
  part(body, boxGeo(0.06, 0.06, 0.06), orange, 0.12, 1.66, -0.08);

  blobShadow(group, 0.62);
  return { group, body, mats };
}

/** Мобы: разный силуэт под каждый тип. */
export function buildEnemyBot(id: EnemyId): BotView {
  const def = ENEMIES[id];
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const shell = mat(def.color);
  const dark = mat(0x232a33);
  const glow = mat(0x2a2020, def.accent, 1.1);
  const mats = [shell, dark, glow];

  switch (id) {
    case 'chaser': {
      part(body, boxGeo(0.6, 0.42, 0.72), shell, 0, 0.52, 0);
      part(body, boxGeo(0.34, 0.28, 0.3), shell, 0, 0.62, 0.46);
      part(body, boxGeo(0.24, 0.07, 0.05), glow, 0, 0.66, 0.62);
      part(body, boxGeo(0.13, 0.36, 0.13), dark, -0.22, 0.18, 0.24);
      part(body, boxGeo(0.13, 0.36, 0.13), dark, 0.22, 0.18, 0.24);
      part(body, boxGeo(0.13, 0.36, 0.13), dark, -0.22, 0.18, -0.24);
      part(body, boxGeo(0.13, 0.36, 0.13), dark, 0.22, 0.18, -0.24);
      break;
    }
    case 'sprinter': {
      const torso = part(body, boxGeo(0.3, 0.66, 0.42), shell, 0, 0.72, 0.06);
      torso.rotation.x = 0.25;
      part(body, boxGeo(0.22, 0.1, 0.06), glow, 0, 0.88, 0.26);
      part(body, boxGeo(0.09, 0.46, 0.09), dark, -0.1, 0.22, 0);
      part(body, boxGeo(0.09, 0.46, 0.09), dark, 0.1, 0.22, 0);
      part(body, boxGeo(0.26, 0.08, 0.3), dark, 0, 0.06, -0.06);
      break;
    }
    case 'tank': {
      part(body, boxGeo(1.5, 0.78, 1.06), shell, 0, 0.66, 0);
      part(body, boxGeo(0.36, 0.5, 1.42), dark, -0.78, 0.26, 0);
      part(body, boxGeo(0.36, 0.5, 1.42), dark, 0.78, 0.26, 0);
      part(body, boxGeo(0.4, 0.26, 0.4), shell, 0, 1.16, 0);
      part(body, boxGeo(0.26, 0.07, 0.05), glow, 0, 1.18, 0.21);
      part(body, boxGeo(0.5, 0.1, 0.06), glow, 0, 0.86, 0.55);
      break;
    }
    case 'boss': {
      part(body, boxGeo(2.7, 1.5, 2.0), shell, 0, 1.15, 0);
      part(body, boxGeo(0.6, 0.8, 2.4), dark, -1.5, 0.45, 0);
      part(body, boxGeo(0.6, 0.8, 2.4), dark, 1.5, 0.45, 0);
      part(body, sphereGeo(0.5, 12), glow, 0, 1.35, 1.05);
      part(body, boxGeo(0.9, 0.2, 0.1), glow, 0, 1.6, 1.0);
      part(body, boxGeo(0.08, 0.8, 0.08), dark, 0.6, 2.2, -0.3);
      part(body, boxGeo(0.16, 0.16, 0.16), glow, 0.6, 2.62, -0.3);
      part(body, boxGeo(0.08, 0.8, 0.08), dark, -0.6, 2.2, -0.3);
      part(body, boxGeo(0.16, 0.16, 0.16), glow, -0.6, 2.62, -0.3);
      break;
    }
  }

  blobShadow(group, def.radius * 1.05);
  return { group, body, mats };
}
