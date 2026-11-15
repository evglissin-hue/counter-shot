// The machines of each castle, as the eye sees them (3.5): the bell hanging
// from its headbeam on the back right tower and swinging while it rings; the
// crane's treadwheel (turning while the masons work high) with a rope and hook
// from the jib's end; the signal mast's pennant and flag, streaming in the
// wind on the keep's roof. The pieces are masonry in the sim (organs.ts in
// content); the stone renderer leaves the bell's box and the wheel's box
// undrawn and this follows their bodies, so a fallen bell is a fallen bell.
// Render only: it reads the layout, the bodies and the frame, and decides nothing.

import * as THREE from "three/webgpu";
import type { CastleLayout } from "@keepfall/content";
import { applyCloudShadow } from "./clouds";
import { mergeGeometries } from "./geometry";
import { TEAM_COLORS } from "./minions";
import { BELL_HZ, WHEEL_SPEED, bellAmplitude, bellAngle, clapperAngle, displaced, masonsWorkHigh, organIds, streamOf, streamerAt, type OrganIds, type StreamerPoint } from "./organsLogic";
import type { StoneSet } from "./stones";

/** What the organs' view remembers, for a keyframe: per castle the bell's swing share and the wheel's angle and speed share. */
export interface OrganState {
  bell: number[];
  wheel: number[];
  speed: number[];
}

/** Geometry parts are boxes and turned shapes merged into one mesh each: position and normal only. */
function plain(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute("uv");
  return g.index ? g.toNonIndexed() : g;
}

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  return plain(g);
}

/** The bell: a lathe-turned shape (flared mouth, narrow crown), a lip ring, mouth at y 0 and its crown at 1.38. */
function bellGeometry(): THREE.BufferGeometry {
  const prof = [
    [0.0, 0.02], [0.6, 0.0], [0.66, 0.04], [0.62, 0.14], [0.52, 0.3], [0.42, 0.55], [0.35, 0.82], [0.3, 1.06], [0.22, 1.26], [0.12, 1.36], [0.0, 1.38],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(prof, 20);
  const lip = new THREE.TorusGeometry(0.645, 0.045, 6, 20);
  lip.rotateX(Math.PI / 2);
  lip.translate(0, 0.06, 0);
  const waist = new THREE.TorusGeometry(0.4, 0.025, 4, 16);
  waist.rotateX(Math.PI / 2);
  waist.translate(0, 0.62, 0);
  return mergeGeometries([plain(body), plain(lip), plain(waist)]);
}

/** The treadwheel: two rims, spokes, an axle and the treads across, axle along x, 1.02 m radius. */
function wheelGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const rim = new THREE.TorusGeometry(1.02, 0.055, 5, 24);
    rim.rotateY(Math.PI / 2);
    rim.translate(s * 0.3, 0, 0);
    parts.push(plain(rim));
    for (let k = 0; k < 6; k++) parts.push(boxAt(0.06, 2.04, 0.06, s * 0.3, 0, 0, (k * Math.PI) / 6));
  }
  const axle = new THREE.CylinderGeometry(0.07, 0.07, 0.9, 6);
  axle.rotateZ(Math.PI / 2);
  parts.push(plain(axle));
  for (let k = 0; k < 14; k++) {
    const a = (k * Math.PI * 2) / 14;
    parts.push(boxAt(0.62, 0.04, 0.22, 0, Math.cos(a) * 0.98, Math.sin(a) * 0.98, a));
  }
  return mergeGeometries(parts);
}

/** A cloth that streams: `cols` columns along the pole's pull, hoist `h0` at its pole end tapering to `h1` at the free end. */
class Streamer {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private attr: THREE.BufferAttribute;
  private pt: StreamerPoint = { along: 0, side: 0, drop: 0 };
  constructor(private length: number, private h0: number, private h1: number, private cols: number, material: THREE.Material) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array((cols + 1) * 2 * 3);
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.attr);
    const idx: number[] = [];
    for (let i = 0; i < cols; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, c, b, d);
    }
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), length * 1.6 + 1);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.layout(0, 1, 0, 0.5);
  }
  /** Fill the vertices for wind direction (wx, wz: unit) and how straight it holds the cloth, at time t. */
  layout(t: number, wx: number, wz: number, stream: number) {
    const px = -wz, pz = wx;
    for (let i = 0; i <= this.cols; i++) {
      const u = i / this.cols;
      streamerAt(u, t + 0.0, this.length, stream, this.pt);
      const h = this.h0 + (this.h1 - this.h0) * u;
      const x = wx * this.pt.along + px * this.pt.side, z = wz * this.pt.along + pz * this.pt.side;
      const y = -this.pt.drop;
      const o = i * 6;
      this.pos[o] = x;
      this.pos[o + 1] = y;
      this.pos[o + 2] = z;
      this.pos[o + 3] = x;
      this.pos[o + 4] = y - h;
      this.pos[o + 5] = z;
    }
    this.attr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}

interface BellView {
  ids: OrganIds;
  group: THREE.Group;
  pivot: THREE.Group;
  clapper: THREE.Group;
  home: THREE.Vector3;
  amp: number;
  ringing: number;
}
interface CraneView {
  wheel: THREE.Group;
  turn: THREE.Group;
  /** The rope and hook swing from this, which sits at the jib's end (`end`, in the jib's own frame). */
  sway: THREE.Group;
  anchor: THREE.Group;
  end: THREE.Vector3;
  angle: number;
  speed: number;
}
interface MastView {
  anchor: THREE.Group;
  pennant: Streamer;
  flag: Streamer;
  home: THREE.Vector3;
}

const _p = new Float32Array(7);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class OrganView {
  readonly root = new THREE.Group();
  private bells: Array<BellView | null> = [null, null];
  private cranes: Array<CraneView | null> = [null, null];
  private masts: Array<MastView | null> = [null, null];
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private ids: [OrganIds, OrganIds];
  private high: [boolean, boolean] = [false, false];
  private wind = { x: 1, z: 0, speed: 3 };
  private bellRinging = [-1, -1];

  constructor(private layout: CastleLayout, private stones: StoneSet) {
    this.root.name = "organs";
    this.ids = organIds(layout);
    const iron = this.mat(0x3a3836, 0.4, 0.55);
    const wood = this.mat(0x4f453a, 0.9);
    const rope = this.mat(0x9a8a6a, 0.95);
    const bell = this.geo(bellGeometry());
    const wheelGeo = this.geo(wheelGeometry());
    for (const c of [0, 1] as const) {
      const ids = this.ids[c];
      const team = TEAM_COLORS[c];
      if (ids.bell >= 0) this.bells[c] = this.buildBell(ids, bell, iron);
      if (ids.wheel >= 0 && ids.jib >= 0) this.cranes[c] = this.buildCrane(c, ids, wheelGeo, wood, rope, iron);
      if (ids.yard >= 0) this.masts[c] = this.buildMast(ids, team);
    }
  }

  private mat(hex: number, roughness: number, metalness = 0): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(m);
    m.color = new THREE.Color(hex);
    m.roughness = roughness;
    m.metalness = metalness;
    this.mats.push(m);
    return m;
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Mesh {
    const me = new THREE.Mesh(g, m);
    me.position.set(x, y, z);
    me.castShadow = true;
    me.receiveShadow = true;
    parent.add(me);
    return me;
  }

  private home(id: number): THREE.Vector3 {
    const s = this.layout.stones[id];
    return new THREE.Vector3(s.x, s.y, s.z);
  }

  /** A bell hangs from the headbeam: the iron box's centre is 1.9 m under the headbeam's underside (content organs.ts), the bell's mouth 0.4 m under that centre. */
  private buildBell(ids: OrganIds, bell: THREE.BufferGeometry, iron: THREE.Material): BellView {
    const group = new THREE.Group();
    const pivot = new THREE.Group();
    // The yoke's pivot is under the headbeam: 1.45 m over the box's centre.
    pivot.position.set(0, 1.45, 0);
    group.add(pivot);
    // The bell hangs from the pivot, its mouth at the box's old foot (0.4 m under its centre).
    const body = this.mesh(bell, iron, pivot, 0, -1.45 - 0.4, 0);
    // The yoke: a stirrup from the crown to the beam, and a cap on the crown.
    const yoke = this.geo(mergeGeometries([boxAt(0.06, 0.52, 0.06, -0.11, 0, 0), boxAt(0.06, 0.52, 0.06, 0.11, 0, 0), boxAt(0.34, 0.07, 0.12, 0, 0.26, 0), boxAt(0.3, 0.06, 0.16, 0, -0.26, 0)]));
    this.mesh(yoke, iron, pivot, 0, -0.26, 0);
    // The clapper: a rod and a ball in the bell, swinging on its own.
    const clapper = new THREE.Group();
    clapper.position.set(0, 1.12, 0);
    body.add(clapper);
    const cg = this.geo(mergeGeometries([boxAt(0.04, 0.9, 0.04, 0, -0.45, 0), plain(new THREE.SphereGeometry(0.1, 8, 6).translate(0, -0.9, 0))]));
    this.mesh(cg, iron, clapper);
    this.root.add(group);
    return { ids, group, pivot, clapper, home: this.home(ids.bell), amp: 0, ringing: -1 };
  }

  private buildCrane(c: number, ids: OrganIds, wheelGeo: THREE.BufferGeometry, wood: THREE.Material, rope: THREE.Material, iron: THREE.Material): CraneView {
    const wheel = new THREE.Group();
    const turn = new THREE.Group();
    wheel.add(turn);
    this.mesh(wheelGeo, wood, turn);
    this.root.add(wheel);
    // Rope and hook hang from the jib's end: the end is away from the castle's middle (the jib points at the gate over the front wall).
    const jib = this.layout.stones[ids.jib];
    const s = Math.sign(jib.z - this.layout.castleZ[c]) || 1;
    const local = new THREE.Vector3(0, -0.12, s * (jib.hz - 0.15)).applyQuaternion(new THREE.Quaternion(jib.q[0], jib.q[1], jib.q[2], jib.q[3]).invert());
    const anchor = new THREE.Group();
    const ropeGroup = new THREE.Group();
    anchor.add(ropeGroup);
    const len = 3.4;
    const rg = this.geo(new THREE.CylinderGeometry(0.022, 0.022, len, 4, 1));
    this.mesh(rg, rope, ropeGroup, 0, -len / 2, 0).castShadow = false;
    const block = this.geo(mergeGeometries([boxAt(0.2, 0.3, 0.14, 0, 0, 0), plain(new THREE.TorusGeometry(0.13, 0.03, 5, 10, Math.PI * 1.45).rotateZ(Math.PI * 0.78).translate(0, -0.3, 0))]));
    this.mesh(block, iron, ropeGroup, 0, -len - 0.1, 0);
    this.root.add(anchor);
    return { wheel, turn, sway: ropeGroup, anchor, end: local, angle: c * 1.3, speed: 0 };
  }

  private buildMast(ids: OrganIds, team: number): MastView {
    const cloth = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(cloth);
    cloth.color = new THREE.Color(team);
    cloth.roughness = 0.85;
    cloth.side = THREE.DoubleSide;
    this.mats.push(cloth);
    const paper = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(paper);
    paper.color = new THREE.Color(0xe6dec6);
    paper.roughness = 0.85;
    paper.side = THREE.DoubleSide;
    this.mats.push(paper);
    const anchor = new THREE.Group();
    const pennant = new Streamer(3.2, 0.85, 0.16, 18, cloth);
    const flag = new Streamer(1.1, 0.8, 0.7, 7, paper);
    anchor.add(pennant.mesh, flag.mesh);
    this.root.add(anchor);
    return { anchor, pennant, flag, home: this.home(ids.yard) };
  }

  /** The bell's ringing, as the page's organ watch reports it: seconds since it began (>= 0), or -1 for still. */
  setBellRinging(castle: number, seconds: number) {
    if (castle === 0 || castle === 1) this.bellRinging[castle] = seconds;
  }

  /** The frame's repairs (WORKS_STRIDE each): the crane's wheel turns for a castle whose masons work high. */
  setWorks(works: ArrayLike<number>, count: number) {
    this.high = masonsWorkHigh(this.layout, works, count);
  }

  /** The match's wind (m/s). */
  setWind(x: number, z: number) {
    const sp = Math.hypot(x, z);
    this.wind.speed = sp;
    if (sp > 0.05) {
      this.wind.x = x / sp;
      this.wind.z = z / sp;
    }
  }

  clear() {
    this.bellRinging.fill(-1);
    this.high = [false, false];
    for (const b of this.bells) if (b) b.amp = 0;
    for (const c of this.cranes) if (c) c.speed = 0;
  }

  captureState(): OrganState {
    return { bell: this.bells.map((b) => b?.amp ?? 0), wheel: this.cranes.map((c) => c?.angle ?? 0), speed: this.cranes.map((c) => c?.speed ?? 0) };
  }

  restoreState(st: OrganState) {
    this.bells.forEach((b, i) => b && (b.amp = st.bell[i]));
    this.cranes.forEach((c, i) => {
      if (!c) return;
      c.angle = st.wheel[i];
      c.speed = st.speed[i];
    });
  }

  /** Every rendered frame: the bodies' places, the swing, the turn, the cloth. */
  update(dt: number, now: number) {
    for (let c = 0; c < 2; c++) {
      const b = this.bells[c];
      if (b) {
        this.place(b.group, b.ids.bell);
        const shown = b.group.visible;
        b.amp = bellAmplitude(b.amp, this.bellRinging[c], dt);
        // A bell that has fallen off its place does not swing.
        const k = shown && !this.moved(b.ids.bell, b.home) ? b.amp : 0;
        const phase = now + c * 0.37;
        b.pivot.rotation.z = bellAngle(k, phase);
        b.clapper.rotation.z = clapperAngle(k, phase);
      }
      const cr = this.cranes[c];
      if (cr) {
        this.place(cr.wheel, this.ids[c].wheel);
        this.place(cr.anchor, this.ids[c].jib, cr.end);
        const want = this.high[c] ? WHEEL_SPEED : 0;
        cr.speed += (want - cr.speed) * Math.min(1, dt * 1.6);
        cr.angle += cr.speed * dt * (c === 0 ? 1 : -1);
        cr.turn.rotation.x = cr.angle;
        // The hook sways a little, more in the wind and while the wheel is turning.
        cr.sway.rotation.x = Math.sin(now * 1.1 + c) * (0.025 + 0.02 * cr.speed);
        cr.sway.rotation.z = Math.sin(now * 0.83 + c * 2) * 0.03 + this.wind.x * 0.01 * Math.min(1, this.wind.speed / 6);
      }
      const m = this.masts[c];
      if (m) {
        const id = this.ids[c].yard;
        this.stones.getTransform(id, _p);
        const gone = displaced(m.home, _p[0], _p[1], _p[2], 0.6);
        m.anchor.visible = !gone;
        if (!gone) {
          // The pennant flies from the yard's right end, the little flag from its left; the cloth is in world axes, streaming with the wind.
          _q.set(_p[3], _p[4], _p[5], _p[6]);
          _v.set(0.88, 0, 0).applyQuaternion(_q);
          m.anchor.position.set(_p[0] + _v.x, _p[1] + _v.y - 0.05, _p[2] + _v.z);
          m.pennant.mesh.position.set(0, 0, 0);
          _w.set(-0.78, 0, 0).applyQuaternion(_q);
          m.flag.mesh.position.set(_w.x - _v.x, _w.y - _v.y - 0.1, _w.z - _v.z);
          const stream = streamOf(this.wind.speed);
          m.pennant.layout(now + c * 1.7, this.wind.x, this.wind.z, stream);
          m.flag.layout(now * 1.15 + c * 0.9, this.wind.x, this.wind.z, stream);
        }
      }
    }
  }

  private moved(id: number, home: THREE.Vector3): boolean {
    this.stones.getTransform(id, _p);
    return displaced(home, _p[0], _p[1], _p[2], 0.3);
  }

  /** Put a group where a stone's body is (hidden while it is withdrawn). With `at`, the group sits at that point of the stone's own frame (the rope's anchor at the jib's end). */
  private place(g: THREE.Object3D, id: number, at?: THREE.Vector3) {
    this.stones.getTransform(id, _p);
    const out = _p[1] < -500;
    g.visible = !out;
    if (out) return;
    _q.set(_p[3], _p[4], _p[5], _p[6]);
    if (at) _v.copy(at).applyQuaternion(_q);
    else _v.set(0, 0, 0);
    g.position.set(_p[0] + _v.x, _p[1] + _v.y, _p[2] + _v.z);
    g.quaternion.copy(_q);
  }

  /** Hertz the bell swings at (for the sound's own timing, should it want it). */
  static readonly bellHz = BELL_HZ;

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const m of this.masts) {
      if (!m) continue;
      m.pennant.mesh.geometry.dispose();
      m.flag.mesh.geometry.dispose();
    }
  }
}
