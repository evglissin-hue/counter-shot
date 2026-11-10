// What stands on the courtyards' plots, as the eye sees it (phase 2 M3). The
// buildings themselves are masonry drawn with the castles (stones.ts); this
// adds what tells a plot's story: stakes and a rope round an empty plot,
// scaffold poles while a building rises, and once it works, its trade: a
// barracks' team banner and rack of pikes, a Powder Mill's turning drive
// wheel and stacked kegs, a Foundry's furnace glowing at the door and smoke
// from its chimney. Kegs a sapper has set at a wall sit here too, their fuses
// sputtering. Render only: it reads the frame and decides nothing.

import * as THREE from "three/webgpu";
import { PLOTS, plotCentre } from "@keepfall/content";
import { KEG_STRIDE, PLOT_STRIDE } from "@keepfall/sim";
import { mergeGeometries } from "./geometry";
import { TEAM_COLORS } from "./minions";

/** Plot states (sim structures.ts PlotState). */
const EMPTY = 0, RISING = 1, STANDING = 2;
const BARRACKS = 0, MILL = 1, FOUNDRY = 2;
const MAX_KEGS = 16;

/** Something to puff: a small cloud of smoke or a spark, at a point (the renderer owns the particles). */
export type Puff = (kind: "smoke" | "spark" | "dust", x: number, y: number, z: number, scale: number) => void;

/** What the plots and kegs remember, for a keyframe. */
export interface EstateState {
  views: Float64Array;
  kegs: Float32Array;
  nextSpark: number;
}

interface PlotView {
  castle: number;
  plot: number;
  kind: number;
  state: number;
  share: number;
  stakes: THREE.Group;
  scaffold: THREE.Group;
  props: THREE.Group[];
  wheel: THREE.Object3D | null;
  glow: THREE.MeshBasicNodeMaterial | null;
  /** The chimney's top (world), for smoke. */
  chimney: THREE.Vector3;
  nextPuff: number;
}

export class EstateView {
  readonly root = new THREE.Group();
  private views: PlotView[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private kegs: THREE.InstancedMesh;
  private sparks: THREE.InstancedMesh;
  private kegData = new Float32Array(MAX_KEGS * KEG_STRIDE);
  private kegCount = 0;
  private nextSpark = 0;


  constructor() {
    this.root.name = "estate";
    const wood = this.mat(0x4f453a, 0.9);
    const rope = this.mat(0x9a8a6a, 0.95);
    const iron = this.mat(0x2e2d2b, 0.55, 0.5);
    const stoneMat = this.mat(0x6f6a62, 0.85);
    const kegMat = this.mat(0x231c15, 0.75);
    const doorMat = this.mat(0x2e251d, 0.85);
    for (const castle of [0, 1]) {
      for (const p of PLOTS) {
        const c = plotCentre(castle, p.index);
        // Where things go round a plot, in its castle's own frame (z mirrored for castle 1).
        const at = (lx: number, ly: number, lz: number) => new THREE.Vector3(c.x + lx, ly, castle === 0 ? c.z + lz : c.z - lz);
        const w = p.w, d = p.d;
        const stakes = new THREE.Group();
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.add(stakes, this.box(0.07, 0.62, 0.07), wood, at((sx * w) / 2, 0.31, (sz * d) / 2));
        for (const sz of [-1, 1]) this.add(stakes, this.box(w, 0.025, 0.025), rope, at(0, 0.42, (sz * d) / 2));
        for (const sx of [-1, 1]) this.add(stakes, this.box(0.025, 0.025, d), rope, at((sx * w) / 2, 0.42, 0));
        // A stack of timber waiting on the plot.
        for (let k = 0; k < 4; k++) this.add(stakes, this.box(1.6, 0.12, 0.14), wood, at(-w / 4, 0.06 + (k >> 1) * 0.12, -0.2 + (k & 1) * 0.16));
        const scaffold = new THREE.Group();
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.add(scaffold, this.box(0.09, 4.2, 0.09), wood, at(sx * (w / 2 + 0.45), 2.1, sz * (d / 2 + 0.45)));
        for (const h of [1.5, 2.9]) {
          for (const sz of [-1, 1]) this.add(scaffold, this.box(w + 1.0, 0.07, 0.3), wood, at(0, h, sz * (d / 2 + 0.45)));
          for (const sx of [-1, 1]) this.add(scaffold, this.box(0.3, 0.07, d + 1.0), wood, at(sx * (w / 2 + 0.45), h, 0));
        }
        // A barracks: its door, its banner on a pole clear of the eaves, a free-standing rack of pikes along the front.
        const barracks = new THREE.Group();
        const out = p.x > 0 ? 1 : -1; // the plot's outer side
        const front = castle === 0 ? -1 : 1; // world z towards the plot's front (its gate side)
        this.add(barracks, this.box(0.95, 1.9, 0.06), doorMat, at(-out * 0.6, 0.95, -d / 2 - 0.04));
        this.add(barracks, this.box(0.08, 4.6, 0.08), wood, at(-out * (w / 2 - 0.4), 2.3, -d / 2 - 0.65));
        const cloth = new THREE.MeshStandardNodeMaterial();
        cloth.color = new THREE.Color(TEAM_COLORS[castle]);
        cloth.roughness = 0.9;
        cloth.side = THREE.DoubleSide;
        this.mats.push(cloth);
        // The cloth hangs from the pole's top towards the middle of the front, in the plane of the front wall.
        const banner = this.add(barracks, this.box(0.03, 1.3, 0.8), cloth, at(-out * (w / 2 - 0.4) + out * 0.44, 3.6, -d / 2 - 0.65));
        banner.rotation.y = Math.PI / 2;
        for (let k = 0; k < 4; k++) {
          const pk = this.add(barracks, this.box(0.035, 3.6, 0.035), wood, at(out * (0.45 + k * 0.32), 1.75, -d / 2 - 0.8));
          pk.rotation.x = front * -0.07; // tops leaning back onto the rail behind them, clear of the eaves
        }
        this.add(barracks, this.box(1.6, 0.08, 0.1), wood, at(out * 0.93, 1.25, -d / 2 - 0.72));
        for (const sx of [0.2, 1.66]) this.add(barracks, this.box(0.08, 1.25, 0.08), wood, at(out * sx, 0.62, -d / 2 - 0.72));
        // A Powder Mill: a tall drive wheel turning against its outer wall, its door, kegs stacked beside it.
        const mill = new THREE.Group();
        this.add(mill, this.box(0.9, 1.75, 0.06), doorMat, at(out * 0.55, 0.88, -d / 2 - 0.04));
        const hub = new THREE.Group();
        hub.position.copy(at(out * (w / 2 + 0.18), 1.35, 0));
        const rim = new THREE.TorusGeometry(1.15, 0.07, 5, 20);
        this.geos.push(rim);
        const rimMesh = new THREE.Mesh(rim, wood);
        rimMesh.rotation.y = Math.PI / 2;
        rimMesh.castShadow = true;
        hub.add(rimMesh);
        for (let k = 0; k < 4; k++) {
          const spoke = new THREE.Mesh(this.box(0.06, 2.3, 0.06), wood);
          spoke.rotation.x = (k * Math.PI) / 4;
          spoke.castShadow = true;
          hub.add(spoke);
        }
        for (let k = 0; k < 8; k++) {
          const paddle = new THREE.Mesh(this.box(0.32, 0.06, 0.4), wood);
          const a = (k * Math.PI) / 4;
          paddle.position.set(0, Math.cos(a) * 1.15, Math.sin(a) * 1.15);
          paddle.rotation.x = -a;
          paddle.castShadow = true;
          hub.add(paddle);
        }
        mill.add(hub);
        const kegGeo = this.kegGeometry();
        for (let k = 0; k < 4; k++) {
          const keg = new THREE.Mesh(kegGeo, kegMat);
          keg.position.copy(at(-out * (0.3 + (k % 3) * 0.48) + (k === 3 ? -out * 0.24 : 0), k === 3 ? 0.72 : 0.24, -d / 2 - 0.4));
          keg.rotation.z = Math.PI / 2;
          keg.castShadow = true;
          mill.add(keg);
        }
        // A Foundry: the furnace door glowing, an anvil on its stump.
        const foundry = new THREE.Group();
        const glow = new THREE.MeshBasicNodeMaterial();
        glow.color = new THREE.Color(0xff8a3a);
        glow.toneMapped = false;
        this.mats.push(glow);
        const door = this.add(foundry, this.box(0.9, 0.95, 0.02), glow, at(0, 0.5, -d / 2 - 0.02));
        door.castShadow = false;
        this.add(foundry, this.box(0.36, 0.5, 0.36), wood, at(out * 1.3, 0.25, -d / 2 - 0.7));
        this.add(foundry, this.box(0.5, 0.18, 0.22), iron, at(out * 1.3, 0.59, -d / 2 - 0.7));
        this.add(foundry, this.box(0.7, 0.3, 0.5), stoneMat, at(-out * 1.2, 0.15, -d / 2 - 0.6));
        for (const g of [stakes, scaffold, barracks, mill, foundry]) {
          g.visible = false;
          this.root.add(g);
        }
        this.views.push({
          castle,
          plot: p.index,
          kind: -1,
          state: EMPTY,
          share: 0,
          stakes,
          scaffold,
          props: [barracks, mill, foundry],
          wheel: hub,
          glow,
          chimney: at(-w / 2 + 0.8, 6.85, d / 2 + 0.46),
          nextPuff: 0,
        });
      }
    }

    // Kegs set against a wall, and the sparks of their fuses.
    this.kegs = new THREE.InstancedMesh(this.kegGeometry(), kegMat, MAX_KEGS);
    this.kegs.count = 0;
    this.kegs.frustumCulled = false;
    this.kegs.castShadow = true;
    const spark = new THREE.MeshBasicNodeMaterial();
    spark.color = new THREE.Color(0xffc070);
    spark.toneMapped = false;
    this.mats.push(spark);
    const sg = new THREE.SphereGeometry(0.06, 6, 4);
    this.geos.push(sg);
    this.sparks = new THREE.InstancedMesh(sg, spark, MAX_KEGS);
    this.sparks.count = 0;
    this.sparks.frustumCulled = false;
    this.root.add(this.kegs, this.sparks);
    this.mats.push(wood, rope, iron, stoneMat, kegMat, doorMat);
  }

  private mat(hex: number, roughness: number, metalness = 0): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial();
    m.color = new THREE.Color(hex);
    m.roughness = roughness;
    m.metalness = metalness;
    return m;
  }

  private box(w: number, h: number, d: number): THREE.BufferGeometry {
    const g = new THREE.BoxGeometry(w, h, d);
    g.deleteAttribute("uv");
    this.geos.push(g);
    return g;
  }

  private kegGeometry(): THREE.BufferGeometry {
    const staves = new THREE.CylinderGeometry(0.2, 0.2, 0.46, 10, 1);
    const bulge = new THREE.SphereGeometry(0.23, 10, 6);
    bulge.scale(1, 0.95, 1);
    const hoop = new THREE.TorusGeometry(0.215, 0.018, 4, 12);
    hoop.rotateX(Math.PI / 2);
    const h1 = hoop.clone();
    h1.translate(0, 0.15, 0);
    const h2 = hoop.clone();
    h2.translate(0, -0.15, 0);
    for (const g of [staves, bulge, h1, h2]) g.deleteAttribute("uv");
    const g = mergeGeometries([staves, bulge, h1, h2]);
    this.geos.push(g);
    return g;
  }

  private add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, at: THREE.Vector3): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** Plot states from a frame: [castle, plot, kind, state, share raised, health] each. */
  setPlots(data: Float32Array, count: number) {
    for (let i = 0; i < count; i++) {
      const o = i * PLOT_STRIDE;
      const v = this.views.find((x) => x.castle === data[o] && x.plot === data[o + 1]);
      if (!v) continue;
      v.kind = data[o + 2] | 0;
      v.state = data[o + 3] | 0;
      v.share = data[o + 4];
      v.stakes.visible = v.state === EMPTY;
      v.scaffold.visible = v.state === RISING;
      v.props.forEach((g, k) => (g.visible = v.state === STANDING && v.kind === k));
    }
  }

  /** Kegs burning at walls: [x, y, z, ticks left] each. */
  setKegs(data: Float32Array, count: number) {
    const n = Math.min(count, MAX_KEGS);
    this.kegData.set(data.subarray(0, n * KEG_STRIDE));
    this.kegCount = n;
  }

  /** Keyframe (S3): per plot [kind, state, share, wheel turn, seconds to its next puff], the kegs and the next spark. */
  captureState(now: number): EstateState {
    const views = new Float64Array(this.views.length * 5);
    this.views.forEach((v, i) => views.set([v.kind, v.state, v.share, v.wheel ? v.wheel.rotation.x : 0, v.nextPuff - now], i * 5));
    return { views, kegs: this.kegData.slice(0, this.kegCount * KEG_STRIDE), nextSpark: this.nextSpark - now };
  }

  /** Keyframe (S3): plots and kegs as captured. */
  restoreState(st: EstateState, now: number) {
    this.views.forEach((v, i) => {
      const o = i * 5;
      v.kind = st.views[o];
      v.state = st.views[o + 1];
      v.share = st.views[o + 2];
      if (v.wheel) v.wheel.rotation.x = st.views[o + 3];
      v.nextPuff = now + st.views[o + 4];
      v.stakes.visible = v.state === EMPTY;
      v.scaffold.visible = v.state === RISING;
      v.props.forEach((g, k) => (g.visible = v.state === STANDING && v.kind === k));
    });
    this.kegData.fill(0);
    this.kegData.set(st.kegs);
    this.kegCount = st.kegs.length / KEG_STRIDE;
    this.nextSpark = now + st.nextSpark;
  }

  /** Forget every plot (a new world). */
  clear() {
    for (const v of this.views) {
      v.kind = -1;
      v.state = EMPTY;
      v.stakes.visible = v.scaffold.visible = false;
      for (const g of v.props) g.visible = false;
    }
    this.kegCount = 0;
  }

  /** Every rendered frame: wheels turn, furnaces flicker, chimneys smoke, fuses spark. */
  update(dt: number, now: number, puff: Puff) {

    for (const v of this.views) {
      if (v.state !== STANDING) continue;
      if (v.kind === MILL && v.wheel) v.wheel.rotation.x += dt * 0.9 * (v.castle === 0 ? 1 : -1);
      if (v.kind === FOUNDRY) {
        if (v.glow) v.glow.color.setRGB(1.6 + 0.35 * Math.sin(now * 7.1) + 0.2 * Math.sin(now * 13.7), 0.62 + 0.08 * Math.sin(now * 9.3), 0.22);
        if (now >= v.nextPuff) {
          v.nextPuff = now + 0.45;
          puff("smoke", v.chimney.x, v.chimney.y, v.chimney.z, 0.32);
        }
      }
      if (v.kind === BARRACKS && now >= v.nextPuff) v.nextPuff = now + 1;
    }
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion(); // upright
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < this.kegCount; i++) {
      const o = i * KEG_STRIDE;
      // Standing upright at the foot of the wall: the frame's height is 0.35 m over the ground, a keg's middle 0.23 m.
      p.set(this.kegData[o], this.kegData[o + 1] - 0.12, this.kegData[o + 2]);
      m.compose(p, q, one);
      this.kegs.setMatrixAt(i, m);
      // The fuse's spark on top, sputtering; faster as it burns down.
      const left = this.kegData[o + 3] / 60;
      const flick = 0.7 + 0.5 * Math.abs(Math.sin(now * (14 + 10 / Math.max(0.3, left)) + i));
      p.y += 0.29;
      m.compose(p, q, new THREE.Vector3(flick, flick, flick));
      this.sparks.setMatrixAt(i, m);
      if (now >= this.nextSpark) puff("spark", p.x, p.y, p.z, 0.18);
    }
    if (now >= this.nextSpark) this.nextSpark = now + 0.11;
    this.kegs.count = this.kegCount;
    this.sparks.count = this.kegCount;
    if (this.kegCount) {
      this.kegs.instanceMatrix.needsUpdate = true;
      this.sparks.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
