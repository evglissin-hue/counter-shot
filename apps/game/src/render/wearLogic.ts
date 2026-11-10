// The logic of per-stone wear, free of three so Node tests can run it. Per
// stone id four floats: [faces, soot, crack, dust].
//
//  faces  bits 0..5: fresh (newly bared) faces in the stone's LOCAL frame, in
//         the order +X, -X, +Y, -Y, +Z, -Z; bit 6 (64): "new stone", laid back
//         by the masons.
//  soot   0..1, scorch from shells, guns and kegs.
//  crack  0..1, hairlines (blows held for now; milestone 3.4's crushing
//         report will drive it through setCrack).
//  dust   0..1, a pale wash that halves every 90 s.
//
// Everything here is cosmetic and rendering-only. Work per frame is O(moving
// stones): a stone is only looked at when the page says it moved.

/** A stone's rest pose, as the layout gives it. */
export interface RestStone {
  id: number;
  x: number;
  y: number;
  z: number;
  q: readonly number[];
  hx: number;
  hy: number;
  hz: number;
  castle: number;
  material: string;
  shape: string;
  plot?: number;
}

export const FACE_NEW = 64;
export const WEAR_STRIDE = 4;
/** A stone more than this far (m) from its rest position has left its place. */
export const GONE_DIST = 0.04;
/** Contacts: how far (m) two faces may be apart and still count as touching, and the overlap (m) they need. */
const TOUCH_GAP = 0.03;
const TOUCH_OVERLAP = 0.05;
export const DUST_HALF_LIFE = 90;
export const SOOT_MUZZLE_CAP = 0.8;
/** How long (s) a laid stone's flight home is ignored by the gone check (the hoist takes about a second). */
const HOLD_SECONDS = 6;
const CELL = 2;
/** Two wedges of adjacent courses stack when their centres are this close (m) in plan: about half a wedge's width. */
const WEDGE_STACK = 0.6;

function rotMat(q: readonly number[], out: Float64Array) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  // Columns are the local axes in world space; stored row-major [row * 3 + col].
  out[0] = 1 - 2 * (y * y + z * z);
  out[1] = 2 * (x * y - z * w);
  out[2] = 2 * (x * z + y * w);
  out[3] = 2 * (x * y + z * w);
  out[4] = 1 - 2 * (x * x + z * z);
  out[5] = 2 * (y * z - x * w);
  out[6] = 2 * (x * z - y * w);
  out[7] = 2 * (y * z + x * w);
  out[8] = 1 - 2 * (x * x + y * y);
}

export class WearModel {
  readonly n: number;
  /** Per id [faces, soot, crack, dust]. */
  wear: Float32Array;
  /** Current position per id (rest at first). */
  cur: Float32Array;
  readonly rest: Float32Array;
  /** Contacts, compressed: stone i has entries cStart[i] .. cStart[i + 1]; neighbour id and the face on stone i. */
  cStart: Int32Array;
  cNb: Int32Array;
  cFace: Uint8Array;
  private gone: Uint8Array;
  /** Per id: the time (s) until which the flight of a laid stone is ignored, or 0. */
  private hold: Float32Array;
  now = 0;

  private grid = new Map<number, number[]>();
  private dirtyFlag: Uint8Array;
  private dirtyList: number[] = [];
  private dusty = new Set<number>();
  private dustClock = 0;
  private kegBuf = new Float32Array(0);
  private kegN = 0;
  /** A pair of stones ended up as a contact list (for the report). */
  contactCount = 0;

  constructor(readonly stones: readonly RestStone[]) {
    const n = stones.length;
    this.n = n;
    this.wear = new Float32Array(n * WEAR_STRIDE);
    this.cur = new Float32Array(n * 3);
    this.rest = new Float32Array(n * 3);
    this.gone = new Uint8Array(n);
    this.hold = new Float32Array(n);
    this.dirtyFlag = new Uint8Array(n);
    this.cStart = new Int32Array(n + 1);
    this.cNb = new Int32Array(0);
    this.cFace = new Uint8Array(0);
    for (const s of stones) {
      this.rest[s.id * 3] = s.x;
      this.rest[s.id * 3 + 1] = s.y;
      this.rest[s.id * 3 + 2] = s.z;
    }
    this.resetPositions();
    this.buildGrid();
    this.buildContacts();
  }

  private resetPositions() {
    for (const s of this.stones) {
      this.cur[s.id * 3] = s.x;
      // Plot buildings start out of sight until the sim raises them.
      this.cur[s.id * 3 + 1] = s.plot !== undefined ? -1000 : s.y;
      this.cur[s.id * 3 + 2] = s.z;
    }
    this.gone.fill(0);
  }

  // --- layout analysis ----------------------------------------------------------

  private key(ix: number, iy: number, iz: number): number {
    return ((ix + 512) * 1024 + (iz + 512)) * 128 + (iy + 32);
  }

  private buildGrid() {
    for (const s of this.stones) {
      const k = this.key(Math.floor(s.x / CELL), Math.floor(s.y / CELL), Math.floor(s.z / CELL));
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = []));
      l.push(s.id);
    }
  }

  /** Visit every stone whose REST cell lies within r of (x, y, z) (callers test the current position). */
  private near(x: number, y: number, z: number, r: number, visit: (id: number) => void) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++)
        for (let iy = y0; iy <= y1; iy++) {
          const l = this.grid.get(this.key(ix, iy, iz));
          if (l) for (let i = 0; i < l.length; i++) visit(l[i]);
        }
  }

  private buildContacts() {
    const n = this.n;
    const A = new Float64Array(9);
    const B = new Float64Array(9);
    const lists: Array<number[]> = [];
    for (let i = 0; i < n; i++) lists.push([]);
    let maxR = 0;
    for (const s of this.stones) if (s.material === "stone" && s.plot === undefined) maxR = Math.max(maxR, s.shape === "wedge" ? 0.8 : Math.hypot(s.hx, s.hy, s.hz));
    // A coarse grid just for this: cells as wide as two of the biggest stones, so a stone's
    // neighbours are in the 27 cells round its own.
    const cell = 2 * maxR + 0.1;
    const cg = new Map<number, number[]>();
    const ck = (ix: number, iy: number, iz: number) => ((ix + 512) * 1024 + (iz + 512)) * 128 + (iy + 32);
    for (const s of this.stones) {
      if (s.material !== "stone" || s.plot !== undefined) continue;
      const k = ck(Math.floor(s.x / cell), Math.floor(s.y / cell), Math.floor(s.z / cell));
      let l = cg.get(k);
      if (!l) cg.set(k, (l = []));
      l.push(s.id);
    }
    for (const a of this.stones) {
      if (a.material !== "stone" || a.plot !== undefined) continue;
      rotMat(a.q, A);
      const cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell), cz = Math.floor(a.z / cell);
      for (let ix = cx - 1; ix <= cx + 1; ix++)
        for (let iz = cz - 1; iz <= cz + 1; iz++)
          for (let iy = cy - 1; iy <= cy + 1; iy++) {
            const l = cg.get(ck(ix, iy, iz));
            if (!l) continue;
            for (let i = 0; i < l.length; i++) {
              const bid = l[i];
              if (bid === a.id) continue;
              const b = this.stones[bid];
              if (b.castle !== a.castle) continue;
              let face = -1;
              if (a.shape === "wedge" || b.shape === "wedge") {
                // Tower wedges: only courses stacked on each other, which overlap by at least half a wedge
                // (the courses are staggered); a wedge's radial faces meet at angles a box test cannot see.
                // Wedge against box: no contact.
                if (a.shape === "wedge" && b.shape === "wedge") {
                  const dy = b.y - a.y;
                  if (Math.hypot(b.x - a.x, b.z - a.z) < WEDGE_STACK && Math.abs(Math.abs(dy) - (a.hy + b.hy)) <= TOUCH_GAP) face = dy > 0 ? 2 : 3;
                }
              } else {
                rotMat(b.q, B);
                face = boxContact(a, b, A, B);
              }
              if (face >= 0) lists[a.id].push(bid, face);
            }
          }
    }
    let total = 0;
    for (let i = 0; i < n; i++) total += lists[i].length >> 1;
    this.cNb = new Int32Array(total);
    this.cFace = new Uint8Array(total);
    let at = 0;
    for (let i = 0; i < n; i++) {
      this.cStart[i] = at;
      const l = lists[i];
      for (let k = 0; k < l.length; k += 2) {
        this.cNb[at] = l[k];
        this.cFace[at] = l[k + 1];
        at++;
      }
    }
    this.cStart[n] = at;
    this.contactCount = total;
  }

  /** Contacts of a stone as [neighbour id, face bit on this stone] pairs (for tests and tools). */
  contactsOf(id: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let k = this.cStart[id]; k < this.cStart[id + 1]; k++) out.push([this.cNb[k], this.cFace[k]]);
    return out;
  }

  private faceToward(id: number, nb: number): number {
    for (let k = this.cStart[id]; k < this.cStart[id + 1]; k++) if (this.cNb[k] === nb) return this.cFace[k];
    return -1;
  }

  // --- dirty tracking -----------------------------------------------------------

  private touch(id: number) {
    if (this.dirtyFlag[id]) return;
    this.dirtyFlag[id] = 1;
    this.dirtyList.push(id);
  }

  /** Hand over (and forget) every stone whose wear changed since the last drain. */
  drain(visit: (id: number) => void) {
    const l = this.dirtyList;
    for (let i = 0; i < l.length; i++) {
      const id = l[i];
      this.dirtyFlag[id] = 0;
      visit(id);
    }
    l.length = 0;
  }

  private setBit(id: number, bit: number) {
    const o = id * WEAR_STRIDE;
    const f = this.wear[o] | 0;
    const m = 1 << bit;
    if (f & m) return;
    this.wear[o] = f | m;
    this.touch(id);
  }

  private clearBit(id: number, bit: number) {
    const o = id * WEAR_STRIDE;
    const f = this.wear[o] | 0;
    const m = 1 << bit;
    if (!(f & m)) return;
    this.wear[o] = f & ~m;
    this.touch(id);
  }

  facesOf(id: number): number {
    return this.wear[id * WEAR_STRIDE] | 0;
  }

  isGone(id: number): boolean {
    return this.gone[id] === 1;
  }

  // --- motion -------------------------------------------------------------------

  /** A stone is now at (x, y, z) (call for every stone the page moves). */
  moved(id: number, x: number, y: number, z: number) {
    if (id < 0 || id >= this.n) return;
    const c = this.cur;
    c[id * 3] = x;
    c[id * 3 + 1] = y;
    c[id * 3 + 2] = z;
    const r = this.rest;
    const dx = x - r[id * 3], dy = y - r[id * 3 + 1], dz = z - r[id * 3 + 2];
    const away = dx * dx + dy * dy + dz * dz > GONE_DIST * GONE_DIST;
    if (this.hold[id] > 0) {
      // A stone the masons are laying: its flight home is not a breaking.
      if (!away || this.now > this.hold[id]) this.hold[id] = 0;
      else return;
    }
    if (away === (this.gone[id] === 1)) return;
    if (!away) {
      this.gone[id] = 0;
      return;
    }
    this.gone[id] = 1;
    // It has left its place: the faces it touched are bared rubble, and so are those of the standing stones facing it.
    for (let k = this.cStart[id]; k < this.cStart[id + 1]; k++) {
      this.setBit(id, this.cFace[k]);
      const nb = this.cNb[k];
      if (this.gone[nb]) continue;
      const f = this.faceToward(nb, id);
      if (f >= 0) this.setBit(nb, f);
    }
  }

  /** The masons laid this stone back (EventKind.Laid): bare faces covered, marked new, the neighbours' faces toward it covered. */
  laid(id: number) {
    if (id < 0 || id >= this.n) return;
    const o = id * WEAR_STRIDE;
    this.wear[o] = FACE_NEW;
    this.touch(id);
    this.gone[id] = 0;
    this.hold[id] = this.now + HOLD_SECONDS;
    for (let k = this.cStart[id]; k < this.cStart[id + 1]; k++) {
      const nb = this.cNb[k];
      if (this.gone[nb]) continue;
      const f = this.faceToward(nb, id);
      if (f >= 0) this.clearBit(nb, f);
    }
  }

  /** A plot building piece rose (EventKind.Raised): a new building, not a repair. */
  raised(id: number) {
    if (id < 0 || id >= this.n) return;
    const o = id * WEAR_STRIDE;
    if (this.wear[o] !== 0) {
      this.wear[o] = 0;
      this.touch(id);
    }
  }

  // --- soot, cracks, dust ------------------------------------------------------

  private addSoot(id: number, amount: number, cap: number) {
    const o = id * WEAR_STRIDE + 1;
    const s = this.wear[o];
    if (s >= cap) return;
    this.wear[o] = Math.min(cap, s + amount);
    this.touch(id);
  }

  explosion(x: number, y: number, z: number, radius: number) {
    const R = 1.8 * radius;
    const C = 1.2 * radius;
    const c = this.cur;
    this.near(x, y, z, Math.max(R, C), (id) => {
      const d = Math.hypot(c[id * 3] - x, c[id * 3 + 1] - y, c[id * 3 + 2] - z);
      if (d < R) this.addSoot(id, 0.8 * (1 - d / R), 1);
      if (d < C && !this.gone[id]) this.addCrack(id, 0.5 * (1 - d / C));
    });
  }

  impact(x: number, y: number, z: number, strength: number) {
    const c = this.cur;
    this.near(x, y, z, 1.2, (id) => {
      if (this.gone[id]) return;
      const d = Math.hypot(c[id * 3] - x, c[id * 3 + 1] - y, c[id * 3 + 2] - z);
      if (d < 1.2) this.addCrack(id, strength * 0.6 * (1 - d / 1.2));
    });
  }

  /** A gun fired from (x, y, z) towards (dx, dy, dz): scorch the stones below or behind the muzzle. */
  muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number) {
    const c = this.cur;
    this.near(x, y, z, 3, (id) => {
      const vx = c[id * 3] - x, vy = c[id * 3 + 1] - y, vz = c[id * 3 + 2] - z;
      const d = Math.hypot(vx, vy, vz);
      if (d >= 3) return;
      if (vy > 0.2 && vx * dx + vy * dy + vz * dz > 0) return;
      this.addSoot(id, 0.15 * (1 - d / 3), SOOT_MUZZLE_CAP);
    });
  }

  /** The burning kegs of the frame (KEG_STRIDE 4: x, y, z, ticks left); copied. */
  setKegs(data: ArrayLike<number> | null, count: number) {
    const m = data ? count * 4 : 0;
    if (this.kegBuf.length < m) this.kegBuf = new Float32Array(m);
    for (let i = 0; i < m; i++) this.kegBuf[i] = (data as ArrayLike<number>)[i];
    this.kegN = data ? count : 0;
  }

  private addCrack(id: number, amount: number) {
    const o = id * WEAR_STRIDE + 2;
    const v = this.wear[o];
    if (v >= 1) return;
    this.wear[o] = Math.min(1, v + amount);
    this.touch(id);
  }

  /** Milestone 3.4's crushing report will drive this; until then cracks come from blows held. */
  setCrack(id: number, value: number) {
    if (id < 0 || id >= this.n) return;
    const o = id * WEAR_STRIDE + 2;
    const v = Math.max(0, Math.min(1, value));
    if (this.wear[o] === v) return;
    this.wear[o] = v;
    this.touch(id);
  }

  /** A pale wash of dust settles on the stones within radius of a point (amount 0..1 at the centre). */
  dustAround(x: number, y: number, z: number, radius: number, amount: number) {
    const c = this.cur;
    this.near(x, y, z, radius, (id) => {
      const d = Math.hypot(c[id * 3] - x, c[id * 3 + 1] - y, c[id * 3 + 2] - z);
      if (d >= radius) return;
      const o = id * WEAR_STRIDE + 3;
      const v = Math.min(1, this.wear[o] + amount * (1 - d / radius));
      if (v === this.wear[o]) return;
      this.wear[o] = v;
      this.dusty.add(id);
      this.touch(id);
    });
  }

  /** Once a frame: burning kegs blacken the stones near them; dust halves every 90 s (worked once a second, over the dusty list only). */
  update(dt: number) {
    const c = this.cur;
    for (let i = 0; i < this.kegN; i++) {
      const kx = this.kegBuf[i * 4], ky = this.kegBuf[i * 4 + 1], kz = this.kegBuf[i * 4 + 2];
      this.near(kx, ky, kz, 2.5, (id) => {
        const d = Math.hypot(c[id * 3] - kx, c[id * 3 + 1] - ky, c[id * 3 + 2] - kz);
        if (d < 2.5) this.addSoot(id, 0.1 * dt * (1 - 0.5 * (d / 2.5)), 1);
      });
    }
    this.dustClock += dt;
    if (this.dustClock >= 1) {
      const steps = Math.floor(this.dustClock);
      this.dustClock -= steps;
      const k = Math.pow(0.5, steps / DUST_HALF_LIFE);
      for (const id of this.dusty) {
        const o = id * WEAR_STRIDE + 3;
        let v = this.wear[o] * k;
        if (v < 0.01) {
          v = 0;
          this.dusty.delete(id);
        }
        this.wear[o] = v;
        this.touch(id);
      }
    }
  }

  // --- state --------------------------------------------------------------------

  /** A copy of every stone's wear by id (for replay keyframes). */
  capture(): Float32Array {
    return this.wear.slice();
  }

  /** Write a captured state back (every stone becomes dirty). */
  apply(state: Float32Array) {
    this.wear.set(state.length === this.wear.length ? state : state.subarray(0, this.wear.length));
    this.dusty.clear();
    for (let id = 0; id < this.n; id++) {
      this.touch(id);
      if (this.wear[id * WEAR_STRIDE + 3] > 0) this.dusty.add(id);
      const r = this.rest, c = this.cur;
      const dx = c[id * 3] - r[id * 3], dy = c[id * 3 + 1] - r[id * 3 + 1], dz = c[id * 3 + 2] - r[id * 3 + 2];
      this.gone[id] = dx * dx + dy * dy + dz * dz > GONE_DIST * GONE_DIST ? 1 : 0;
      this.hold[id] = 0;
    }
  }

  /** Back to a fresh castle (a reset): no wear, every stone at rest. */
  clear() {
    this.wear.fill(0);
    this.hold.fill(0);
    this.dusty.clear();
    this.kegN = 0;
    this.dustClock = 0;
    this.resetPositions();
    for (let id = 0; id < this.n; id++) this.touch(id);
  }
}

/**
 * Do two boxes (A and B, with rotation matrices rA and rB, row-major world from
 * local) touch face to face? Returns the face bit on A (2 * axis + (neighbour on
 * the negative side ? 1 : 0)) or -1. B's extent along A's axes comes from the
 * relative rotation, so a wall turned by a quaternion works the same.
 */
const _d = new Float64Array(3);
const _hA = new Float64Array(3);
const _hB = new Float64Array(3);
const _rel = new Float64Array(9);
const _e = new Float64Array(3);

export function boxContact(a: RestStone, b: RestStone, rA: Float64Array, rB: Float64Array): number {
  const wx = b.x - a.x, wy = b.y - a.y, wz = b.z - a.z;
  const ra = Math.hypot(a.hx, a.hy, a.hz), rb = Math.hypot(b.hx, b.hy, b.hz);
  const lim = ra + rb + TOUCH_GAP;
  if (wx * wx + wy * wy + wz * wz > lim * lim) return -1;
  const d = _d, hA = _hA, hB = _hB, rel = _rel, e = _e;
  hA[0] = a.hx; hA[1] = a.hy; hA[2] = a.hz;
  hB[0] = b.hx; hB[1] = b.hy; hB[2] = b.hz;
  // d = rA^T * w; rel[k][j] = axisA_k . axisB_j.
  for (let k = 0; k < 3; k++) {
    d[k] = rA[k] * wx + rA[3 + k] * wy + rA[6 + k] * wz;
    for (let j = 0; j < 3; j++) rel[k * 3 + j] = rA[k] * rB[j] + rA[3 + k] * rB[3 + j] + rA[6 + k] * rB[6 + j];
  }
  for (let k = 0; k < 3; k++) e[k] = Math.abs(rel[k * 3]) * hB[0] + Math.abs(rel[k * 3 + 1]) * hB[1] + Math.abs(rel[k * 3 + 2]) * hB[2];
  for (let k = 0; k < 3; k++) {
    const gap = Math.abs(d[k]) - (hA[k] + e[k]);
    if (Math.abs(gap) > TOUCH_GAP) continue;
    if (Math.max(Math.abs(rel[k * 3]), Math.abs(rel[k * 3 + 1]), Math.abs(rel[k * 3 + 2])) < 0.94) continue;
    let ok = true;
    for (let m = 0; m < 3 && ok; m++) {
      if (m === k) continue;
      const ov = Math.min(hA[m], d[m] + e[m]) - Math.max(-hA[m], d[m] - e[m]);
      if (ov <= TOUCH_OVERLAP) ok = false;
    }
    if (ok) return 2 * k + (d[k] < 0 ? 1 : 0);
  }
  return -1;
}
