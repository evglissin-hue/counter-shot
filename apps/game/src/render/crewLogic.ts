// A crew at every gun (look round L1): what each man does and where he stands, by the gun's reload stage. Pure rules, no
// three, so Node can test them. The crew are figures on the page only (milestone 3.6 makes real crews later): nothing here
// feeds the match, and a pose is a function of the gun's state alone (stage, carriage, age of the shot), so a keyframe
// applied or a fast forward lands on the right pose with nothing to swing.
//
// Frame: the gun's own (x to the gunner's left looking down the barrel, z along it, y up), y measured from the floor the
// crew's feet reach (the wall walk). A wall gun sits on a timber platform `lift` metres above that floor; two men may stand
// on the platform's strip each side of the carriage (level 1), the rest stand on the floor (level 0). The gun's props
// (powder box, garland, shell crate) stand in the gun's rest frame, so a gun that has turned moves the places men fetch from.

import type { WeaponKind } from "@keepfall/content";
import { smooth01 } from "./recoilLogic";

// --- the table: splits and places ---------------------------------------------------------------------------

/** The long gun's and the chain shot's reload by stage: [from, to]. */
export const SPLITS = {
  clear: [0, 0.08],
  swab: [0.08, 0.3],
  load: [0.3, 0.5],
  ram: [0.5, 0.72],
  runOut: [0.72, 0.92],
  ready: [0.92, 1],
} as const;
/** The mortar's: swab, the powder, the shell (two men carry it), stand clear. */
export const MORTAR_SPLITS = { clear: [0, 0.08], swab: [0.08, 0.3], powder: [0.3, 0.5], shell: [0.5, 0.8], ready: [0.8, 1] } as const;
/** The swivel's one man: works at the breech, then goes to the tiller. */
export const SWIVEL_SPLITS = { clear: [0, 0.08], breech: [0.08, 0.5], tiller: [0.5, 0.9], ready: [0.9, 1] } as const;

/** Men at each weapon. */
export const CREW_SIZE: Record<WeaponKind, number> = { longGun: 4, chainShot: 4, mortar: 3, swivel: 1 };
/** Roles by index: 0 the gunner (linstock), 1 the spongeman and rammer, 2 the loader (powder), 3 the helper (shot). */
export const GUNNER = 0, SPONGE = 1, LOADER = 2, HELPER = 3;

/** A place in the gun's frame: x to the gunner's left, z along the barrel, and the level (0 the floor, 1 the platform's top). */
export type Place = readonly [x: number, z: number, level: number];

export interface Places {
  /** The props beside the gun (rest frame): powder box, and shot garland (a mortar's: its shell crate). */
  box: readonly [number, number];
  ammo: readonly [number, number];
  /** Where a man stands to take from them. */
  boxAt: readonly [number, number];
  ammoAt: readonly [number, number];
  /** The strips beside the cheeks at the front of the carriage, right and left. */
  frontR: Place;
  frontL: Place;
  /** Where each man waits, clear of the work. */
  rest: readonly [Place, Place, Place, Place];
  /** The gunner by the breech at the ready. */
  gunnerReady: Place;
  /** The helper waiting at the left for the loader to step off. */
  helperWait: Place;
  /** Where the men lean on the cheeks (z, with the gun run out) and on the rear. */
  pushZ: number;
  pushRear: Place;
}

export const PLACES: Record<WeaponKind, Places> = {
  longGun: {
    box: [1.95, -1.75],
    ammo: [-1.95, -1.75],
    boxAt: [1.6, -1.3],
    ammoAt: [-1.35, -1.4],
    frontR: [-0.85, 0.6, 1],
    frontL: [0.85, 0.6, 1],
    rest: [[-1.25, -1.75, 0], [-1.4, -0.6, 0], [1.55, -0.7, 0], [-0.9, -2.0, 0]],
    gunnerReady: [-0.85, -1.0, 1],
    helperWait: [1.2, -0.5, 0],
    pushZ: 0.35,
    pushRear: [0.55, -1.95, 0],
  },
  chainShot: {
    box: [1.35, -0.85],
    ammo: [-1.5, -0.5],
    boxAt: [1.35, -1.4],
    ammoAt: [-1.5, -1.35],
    frontR: [-0.85, 0.6, 1],
    frontL: [0.85, 0.6, 1],
    rest: [[-1.1, -1.7, 0], [-1.1, -0.6, 0], [1.7, -0.3, 0], [-1.1, -1.45, 0]],
    gunnerReady: [-0.85, -0.95, 1],
    helperWait: [1.2, -0.4, 0],
    pushZ: 0.35,
    pushRear: [0.55, -1.8, 0],
  },
  mortar: {
    box: [1.9, -0.9],
    ammo: [-1.9, -0.5],
    boxAt: [1.6, -0.3],
    ammoAt: [-1.9, 0.15],
    frontR: [-1.05, 0.9, 0],
    frontL: [1.05, 0.9, 0],
    rest: [[-1.2, -1.1, 0], [-1.55, 0.55, 0], [1.4, -0.8, 0], [0, 0, 0]],
    gunnerReady: [-1.2, -0.5, 0],
    helperWait: [-1.0, 0.1, 0],
    pushZ: 0,
    pushRear: [0, -1.6, 0],
  },
  swivel: {
    box: [0, 0],
    ammo: [0, 0],
    boxAt: [0, 0],
    ammoAt: [0, 0],
    frontR: [-0.7, 0.1, 0],
    frontL: [0.7, 0.1, 0],
    rest: [[-0.7, -0.55, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
    gunnerReady: [-0.7, -0.55, 0],
    helperWait: [0, 0, 0],
    pushZ: 0,
    pushRear: [0, 0, 0],
  },
};

/** The sight camera: behind the pivot and above it (metres), and the cone round its view's centre, with the band below the crosshair, that nobody may stand in (radians). */
export const SIGHT = { back: 3.2, up: 1.1, azimuth: 0.11, below: 0.3, above: 0.08 };
/** A figure whose head comes this near the camera is hidden (metres). */
export const HIDE_NEAR = 0.8;
/** The staff (a sponge one end, a rammer the other) and the linstock (metres). */
export const POLE = 3.0;
export const LINSTOCK = 1.55;
/** How far a man's feet may stand from the pivot, along and across the gun (metres): the floor's reach. */
export const REACH = { x: 2.2, zBack: 2.5, zFront: 1.6 };
/** Platform: a wall gun's carriage stands on courses of beams this high at most below the trunnions (see gunModel). */
export const CARRIAGE_DROP = 0.85;

// --- what the page tells it, and what it gives back ----------------------------------------------------------

/**
 * One gun as the crew need it. `drop`: the pivot's height above the floor; `lift`: the platform's height. The crew's frame
 * follows the gun's turn only in part (the platform does not turn): `turn` is the gun's yaw from the crew's frame and
 * `propTurn` the props' (the rest aim's).
 */
export interface CrewGun {
  kind: WeaponKind;
  stage: number;
  slide: number;
  age: number;
  pitch: number;
  barrel: number;
  drop: number;
  lift: number;
  turn: number;
  propTurn: number;
  ridden: boolean;
}

export function newCrewGun(): CrewGun {
  return { kind: "longGun", stage: 1, slide: 0, age: 1e6, pitch: 0.05, barrel: 1.8, drop: 1.7, lift: 0.85, turn: 0, propTurn: 0, ridden: false };
}

/** The platform's height under a gun the pivot of which stands `drop` above the floor. */
export function liftOf(kind: WeaponKind, drop: number): number {
  return kind === "longGun" || kind === "chainShot" ? Math.max(0, drop - CARRIAGE_DROP) : 0;
}

export const NO_TOOL = 0, STAFF = 1, LINSTOCK_TOOL = 2;
export const NO_CARRY = 0, CARTRIDGE = 1, BALL = 2, SHELL = 3;

type V3 = [number, number, number];
const _p: [number, number] = [0, 0];

/** One man: where his feet are, how he stands, what his hands work at (hw 0: they hang), and what he holds. */
export interface Figure {
  role: number;
  px: number;
  pz: number;
  /** The height of the floor under his feet (the platform's top, or 0). */
  py: number;
  face: number;
  lean: number;
  crouch: number;
  stride: number;
  hw: number;
  hl: V3;
  hr: V3;
  tool: number;
  /** The tool's head (a staff's sponge end, the linstock's burning tip) and butt. */
  ta: V3;
  tb: V3;
  carry: number;
  cp: V3;
  glow: number;
}

export function newFigure(): Figure {
  return { role: 0, px: 0, pz: 0, py: 0, face: 0, lean: 0, crouch: 0, stride: 0, hw: 0, hl: [0, 0, 0], hr: [0, 0, 0], tool: 0, ta: [0, 0, 0], tb: [0, 0, 0], carry: 0, cp: [0, 0, 0], glow: 0 };
}

export function newFigures(n = 4): Figure[] {
  return Array.from({ length: n }, newFigure);
}

function reset(f: Figure, role: number) {
  f.role = role;
  f.hw = 0;
  f.tool = NO_TOOL;
  f.carry = NO_CARRY;
  f.glow = 0;
  f.crouch = 0;
  f.stride = 0;
  f.lean = 0;
  for (const v of [f.hl, f.hr, f.ta, f.tb, f.cp]) set3(v, 0, 0, 0);
}

// --- helpers -------------------------------------------------------------------------------------------------

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const clamp01 = (u: number) => (u < 0 ? 0 : u > 1 ? 1 : u);
const sm = smooth01;
/** Progress through a window of the stage, 0 to 1. */
const win = (s: number, w: readonly [number, number]) => clamp01((s - w[0]) / (w[1] - w[0]));
const inWin = (s: number, a: number, b: number) => s >= a && s < b;
/** n strokes over u in 0..1: 0 at both ends and between, 1 at the middle of each. */
const strokes = (u: number, n: number) => 0.5 * (1 - Math.cos(2 * Math.PI * n * u));

/** A point turned about the vertical by `a` (the same turn the gun's yaw makes): a point in a frame turned by `a` into the frame it stands in. */
export function turned(x: number, z: number, a: number, out: [number, number]) {
  const c = Math.cos(a), s = Math.sin(a);
  out[0] = x * c + z * s;
  out[1] = -x * s + z * c;
}

/** key: [stage, x, z, level, face, lean]. A man's way through the reload: smooth between the keys. */
type Key = readonly [number, number, number, number, number, number];
const key = (s: number, p: readonly [number, number, number], face: number, lean = 0): Key => [s, p[0], p[1], p[2], face, lean];
const at = (x: number, z: number, level = 0): Place => [x, z, level];

function track(keys: readonly Key[], s: number, f: Figure, lift: number) {
  let i = 0;
  while (i < keys.length - 2 && s > keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1];
  const u = b[0] > a[0] ? sm((s - a[0]) / (b[0] - a[0])) : 1;
  f.px = lerp(a[1], b[1], u);
  f.pz = lerp(a[2], b[2], u);
  f.py = lift * lerp(a[3], b[3], u);
  f.face = lerp(a[4], b[4], u);
  f.lean = lerp(a[5], b[5], u);
  if (posing) clearOfSight(posing, f);
}

/** The gun being posed (set by `poseCrew`): `track` keeps its men out of the sight's line. */
let posing: CrewGun | null = null;

/**
 * Nobody stands in the sight camera's central cone for the gun the player rides: a man who would (the gun turned on him)
 * steps aside, out to the cone's edge and the width of his shoulders. (The camera sits behind the gun and turns with it.)
 */
function clearOfSight(g: CrewGun, f: Figure) {
  if (!g.ridden) return;
  const c = Math.cos(g.turn), s = Math.sin(g.turn);
  // Into the gun's frame (the way `inSightLine` does).
  let x = f.px * c - f.pz * s;
  const z = f.px * s + f.pz * c;
  const dz = z + SIGHT.back;
  if (dz < 0.5) return;
  const need = dz * Math.tan(SIGHT.azimuth * 1.2) + 0.25;
  if (Math.abs(x) >= need) return;
  x = x < 0 || (x === 0 && f.role % 2 === 1) ? -need : need;
  f.px = x * c + z * s;
  f.pz = -x * s + z * c;
}

/** Where a gun's muzzle is, in its frame (y from the floor). */
export function muzzleOf(g: CrewGun, o: V3): V3 {
  const mortar = g.kind === "mortar";
  turned(0, g.barrel * Math.cos(g.pitch) - (mortar ? 0 : g.slide), g.turn, _p);
  o[0] = _p[0];
  o[1] = g.drop + g.barrel * Math.sin(g.pitch) - (mortar ? g.slide : 0);
  o[2] = _p[1];
  return o;
}

/** The vent (touch hole) at the top of the breech, in the gun's frame. */
function ventOf(g: CrewGun, o: V3): V3 {
  const mortar = g.kind === "mortar";
  turned(0, (g.kind === "swivel" ? -0.3 : mortar ? -0.2 : -0.72) - (mortar ? 0 : g.slide), g.turn, _p);
  o[0] = _p[0];
  o[1] = g.drop + (g.kind === "swivel" ? 0.08 : mortar ? 0.4 : 0.25) - (mortar ? g.slide : 0);
  o[2] = _p[1];
  return o;
}

const _m: V3 = [0, 0, 0];
const _v: V3 = [0, 0, 0];
const _w: V3 = [0, 0, 0];

const set3 = (o: V3, x: number, y: number, z: number) => {
  o[0] = x;
  o[1] = y;
  o[2] = z;
};

/** The point in front of a man's chest. */
function chest(f: Figure, ahead: number, up: number, o: V3): V3 {
  o[0] = f.px + Math.sin(f.face) * ahead;
  o[1] = f.py + up;
  o[2] = f.pz + Math.cos(f.face) * ahead;
  return o;
}

/** Both hands about one point, `apart` either side of it across his body. */
function bothHands(f: Figure, x: number, y: number, z: number, apart = 0.1) {
  const lx = Math.cos(f.face), lz = -Math.sin(f.face);
  set3(f.hl, x + lx * apart, y, z + lz * apart);
  set3(f.hr, x - lx * apart, y, z - lz * apart);
  f.hw = 1;
}

/** The way a man looks, from where he stands to a point. */
const faceTo = (px: number, pz: number, x: number, z: number) => Math.atan2(x - px, z - pz);

/**
 * The staff (a sponge one end, a rammer the other), worked from where he stands: a pole through the muzzle's lip and
 * the point in front of his chest, its head `ins` metres into the bore (it slides through his hands; the barrel hides
 * the part inside).
 */
function pole(f: Figure, g: CrewGun, ins: number) {
  muzzleOf(g, _m);
  chest(f, 0.45, f.py ? 1.2 : 1.2, _v);
  let dx = _v[0] - _m[0], dy = _v[1] - _m[1], dz = _v[2] - _m[2];
  const d = Math.hypot(dx, dy, dz) || 1;
  dx /= d;
  dy /= d;
  dz /= d;
  const h = 0.15 - ins;
  set3(f.ta, _m[0] + dx * h, _m[1] + dy * h, _m[2] + dz * h);
  set3(f.tb, f.ta[0] + dx * POLE, f.ta[1] + dy * POLE, f.ta[2] + dz * POLE);
  const gap = Math.min(0.55, Math.max(0.3, d - 0.3));
  set3(f.hr, _v[0], _v[1], _v[2]);
  set3(f.hl, _v[0] + dx * gap, _v[1] + dy * gap, _v[2] + dz * gap);
  f.tool = STAFF;
  f.hw = 1;
}

/** The staff stood upright at his side, a hand on it. */
function poleRest(f: Figure) {
  const x = f.px - Math.cos(f.face) * 0.3 + Math.sin(f.face) * 0.15, z = f.pz + Math.sin(f.face) * 0.3 + Math.cos(f.face) * 0.15;
  set3(f.tb, x, f.py, z);
  set3(f.ta, x, f.py + POLE, z);
  set3(f.hr, x, f.py + 1.05, z);
  set3(f.hl, x, f.py + 1.4, z);
  f.tool = STAFF;
  f.hw = 1;
}

/** The linstock in the gunner's hands: upright at his side (w 0), or its tip held to the vent (w 1). */
function linstock(f: Figure, g: CrewGun, w: number) {
  ventOf(g, _m);
  chest(f, 0.35, 1.15, _v);
  const ux = _v[0] + Math.sin(f.face) * 0.2, uy = _v[1] + 0.95, uz = _v[2] + Math.cos(f.face) * 0.2;
  const tx = lerp(ux, _m[0], w), ty = lerp(uy, _m[1] + 0.06, w), tz = lerp(uz, _m[2], w);
  set3(f.ta, tx, ty, tz);
  let dx = _v[0] - tx, dy = _v[1] - ty, dz = _v[2] - tz;
  const d = Math.hypot(dx, dy, dz) || 1;
  dx /= d;
  dy /= d;
  dz /= d;
  set3(f.tb, tx + dx * LINSTOCK, ty + dy * LINSTOCK, tz + dz * LINSTOCK);
  set3(f.hl, tx + dx * 0.75, ty + dy * 0.75, tz + dz * 0.75);
  set3(f.hr, tx + dx * 1.2, ty + dy * 1.2, tz + dz * 1.2);
  f.tool = LINSTOCK_TOOL;
  f.glow = 1;
  f.hw = 1;
}

/** The gunner's match: held to the vent for the moment of the shot and just after, hovering near it at the ready. */
function gunnerMatch(f: Figure, g: CrewGun) {
  const touch = g.age < 0.5 ? 1 - sm((g.age - 0.08) / 0.4) : 0;
  const ready = 0.55 * sm((g.stage - 0.9) / 0.1);
  linstock(f, g, Math.max(touch, ready));
}

/** The flinch of the shot: the men lean away and crouch a little as it fires. */
function flinch(f: Figure, g: CrewGun, amount: number) {
  const a = g.age;
  const k = a < 0 ? 0 : a < 0.08 ? a / 0.08 : Math.max(0, 1 - (a - 0.08) / 0.8);
  f.lean -= amount * k;
  f.crouch += 0.1 * k;
}

/** A man reaching down into a box (or garland), coming up with the cargo (`kind`) once `u` passes the half. */
function fetch(f: Figure, at: readonly [number, number], turn: number, u: number, kind: number) {
  turned(at[0], at[1], turn, _p);
  const bend = Math.sin(clamp01(u) * Math.PI);
  f.lean = lerp(f.lean, 0.7, bend);
  f.crouch = 0.25 * bend;
  const got = u > 0.5;
  chest(f, 0.3, lerp(0.35, 1.0, sm((u - 0.5) / 0.5)), _v);
  const x = got ? _v[0] : _p[0], y = got ? _v[1] : f.py + 0.4, z = got ? _v[2] : _p[1];
  bothHands(f, x, y, z, 0.12);
  if (got) {
    f.carry = kind;
    set3(f.cp, x, y, z);
  }
}

/** Cargo held at the chest. */
function hold(f: Figure, kind: number) {
  chest(f, 0.38, 1.1, _v);
  bothHands(f, _v[0], _v[1], _v[2], 0.13);
  f.carry = kind;
  set3(f.cp, _v[0], _v[1], _v[2]);
}

/** Cargo put into the muzzle: from the chest to the lip, then in (gone by the end). */
function putIn(f: Figure, g: CrewGun, u: number, kind: number) {
  muzzleOf(g, _m);
  chest(f, 0.38, 1.1, _v);
  const a = sm(u / 0.7);
  const x = lerp(_v[0], _m[0], a), y = lerp(_v[1], _m[1], a), z = lerp(_v[2], _m[2], a);
  f.lean = lerp(f.lean, 0.3, a);
  bothHands(f, x, y, z, 0.12);
  if (u < 0.85) {
    f.carry = kind;
    set3(f.cp, x, y, z);
  }
}

/** Both hands on a cheek's top at z (side +1 the left cheek), stepping into it. */
function pushCheek(f: Figure, g: CrewGun, side: number, z: number) {
  turned(0.42 * side, z, g.turn, _p);
  bothHands(f, _p[0], g.drop - 0.25, _p[1], 0.2);
  f.crouch += 0.1;
  f.stride = 0.4;
}

// --- the long gun and the chain shot -------------------------------------------------------------------------

function longCrew(g: CrewGun, out: Figure[]) {
  const P = PLACES[g.kind];
  const s = g.stage;
  const lift = g.lift;
  const { frontR: fr, frontL: fl, rest, gunnerReady: gr } = P;
  const muz = muzzleOf(g, _w);
  const aimR = faceTo(fr[0], fr[1], muz[0], muz[2]);
  const aimL = faceTo(fl[0], fl[1], muz[0], muz[2]);
  // The men leaning on the cheeks stand behind their hands; the hands (z) go forward with the carriage.
  const pushZ = P.pushZ - g.slide;
  const pushR = at(fr[0], pushZ - 0.4, 1);
  const pushL = at(fl[0], pushZ - 0.4, 1);
  const rearZ = -1.05 - g.slide;
  const pushB = at(P.pushRear[0], rearZ - 0.55, 0);
  const pushing = s >= 0.78 && s <= SPLITS.runOut[1] + 0.02;
  const boxAt = at(P.boxAt[0], P.boxAt[1]);
  const ammoAt = at(P.ammoAt[0], P.ammoAt[1]);
  const wait = at(P.helperWait[0], P.helperWait[1]);
  turned(P.box[0], P.box[1], g.propTurn, _p);
  const faceBox = faceTo(boxAt[0], boxAt[1], _p[0], _p[1]);
  turned(P.ammo[0], P.ammo[1], g.propTurn, _p);
  const faceAmmo = faceTo(ammoAt[0], ammoAt[1], _p[0], _p[1]);

  // 0 the gunner: at the breech with the match; steps back as the gun leaps; back at the breech for the ready
  {
    const f = out[GUNNER];
    reset(f, GUNNER);
    track([key(0, gr, 0.3), key(0.06, rest[0], 0.2), key(0.8, rest[0], 0.2), key(0.92, gr, 0.3), key(1, gr, 0.3)], s, f, lift);
    flinch(f, g, 0.5);
    gunnerMatch(f, g);
  }
  // 1 the spongeman and rammer
  {
    const f = out[SPONGE];
    reset(f, SPONGE);
    track(
      [
        key(0, rest[1], 0.5),
        key(0.08, rest[1], 0.5),
        key(0.14, fr, aimR, 0.1),
        key(0.3, fr, aimR, 0.1),
        key(0.38, rest[1], 0.5),
        key(0.46, rest[1], 0.5),
        key(0.55, fr, aimR, 0.1),
        key(0.72, fr, aimR, 0.1),
        key(0.78, pushR, 0.1, 0.35),
        key(0.92, pushR, 0.1, 0.35),
        key(0.97, rest[1], 0.5),
        key(1, rest[1], 0.5),
      ],
      s,
      f,
      lift,
    );
    if (inWin(s, 0.14, 0.3)) {
      const ins = 0.5 * strokes((s - 0.14) / 0.16, 3);
      f.lean += 0.25 * ins;
      pole(f, g, ins);
    } else if (inWin(s, 0.55, 0.72)) {
      const ins = 0.55 * strokes((s - 0.55) / 0.17, 2);
      f.lean += 0.3 * ins;
      f.crouch = 0.08 * ins;
      pole(f, g, ins);
    } else if (pushing) {
      poleRest(f);
      pushCheek(f, g, -1, pushZ);
    } else poleRest(f);
    flinch(f, g, 0.25);
  }
  // 2 the loader: the cartridge from the box to the muzzle
  {
    const f = out[LOADER];
    reset(f, LOADER);
    track(
      [
        key(0, rest[2], 2.5),
        key(0.12, rest[2], 2.5),
        key(0.22, boxAt, faceBox),
        key(0.31, boxAt, faceBox),
        key(0.4, fl, aimL, 0.1),
        key(0.45, fl, aimL, 0.1),
        key(0.52, rest[2], 2.5),
        key(0.72, rest[2], 2.5),
        key(0.78, pushL, -0.1, 0.35),
        key(0.92, pushL, -0.1, 0.35),
        key(0.97, rest[2], 2.5),
        key(1, rest[2], 2.5),
      ],
      s,
      f,
      lift,
    );
    if (inWin(s, 0.26, 0.31)) fetch(f, P.box, g.propTurn, (s - 0.26) / 0.05, CARTRIDGE);
    else if (inWin(s, 0.31, 0.4)) hold(f, CARTRIDGE);
    else if (inWin(s, 0.4, 0.46)) putIn(f, g, (s - 0.4) / 0.06, CARTRIDGE);
    else if (pushing) pushCheek(f, g, 1, pushZ);
    flinch(f, g, 0.25);
  }
  // 3 the helper: the ball from the garland to the muzzle, then the rear of the carriage
  {
    const f = out[HELPER];
    reset(f, HELPER);
    track(
      [
        key(0, rest[3], 0.9),
        key(0.03, rest[3], faceAmmo),
        key(0.08, ammoAt, faceAmmo),
        key(0.14, ammoAt, faceAmmo),
        key(0.3, wait, 0.8),
        key(0.44, wait, 0.8),
        key(0.49, fl, aimL, 0.1),
        key(0.53, fl, aimL, 0.1),
        key(0.6, wait, 0.8),
        key(0.66, wait, 0.8),
        key(0.78, pushB, 0, 0.45),
        key(0.92, pushB, 0, 0.45),
        key(1, rest[3], 0.9),
      ],
      s,
      f,
      lift,
    );
    if (inWin(s, 0.08, 0.14)) fetch(f, P.ammo, g.propTurn, (s - 0.08) / 0.06, BALL);
    else if (inWin(s, 0.14, 0.49)) hold(f, BALL);
    else if (inWin(s, 0.49, 0.53)) putIn(f, g, (s - 0.49) / 0.04, BALL);
    else if (pushing) {
      turned(0, rearZ, g.turn, _p);
      bothHands(f, _p[0], g.drop - 0.3, _p[1], 0.25);
      f.stride = 0.4;
    }
    flinch(f, g, 0.25);
  }
}

// --- the mortar ----------------------------------------------------------------------------------------------

function mortarCrew(g: CrewGun, out: Figure[]) {
  const P = PLACES.mortar;
  const s = g.stage;
  const { frontR: fr, frontL: fl, rest, gunnerReady: gr } = P;
  const muz = muzzleOf(g, _w);
  const aimR = faceTo(fr[0], fr[1], muz[0], muz[2]);
  const aimL = faceTo(fl[0], fl[1], muz[0], muz[2]);
  const S = MORTAR_SPLITS;
  // The shell: two men take it from the crate (ends of it), carry it in front of the bed, and lift it into the muzzle.
  const shellFrom = [at(P.ammo[0], P.ammo[1] + 0.8), at(P.ammo[0], P.ammo[1] - 0.8)];
  const shellTo = [at(-0.6, 1.3), at(0.6, 1.3)];

  // 0 the gunner: the match, always
  {
    const f = out[GUNNER];
    reset(f, GUNNER);
    track([key(0, gr, 0.3), key(0.06, rest[0], 0.2), key(0.8, rest[0], 0.2), key(0.9, gr, 0.3), key(1, gr, 0.3)], s, f, 0);
    flinch(f, g, 0.5);
    gunnerMatch(f, g);
  }
  // 1 the spongeman, then a shell carrier
  {
    const f = out[SPONGE];
    reset(f, SPONGE);
    track(
      [
        key(0, rest[1], 2.8),
        key(0.08, rest[1], 2.8),
        key(0.14, fr, aimR, 0.1),
        key(0.3, fr, aimR, 0.1),
        key(0.36, rest[1], 2.8),
        key(0.5, rest[1], 2.8),
        key(0.55, shellFrom[0], faceTo(shellFrom[0][0], shellFrom[0][1], P.ammo[0], P.ammo[1])),
        key(0.6, shellFrom[0], faceTo(shellFrom[0][0], shellFrom[0][1], P.ammo[0], P.ammo[1])),
        key(0.7, shellTo[0], faceTo(shellTo[0][0], shellTo[0][1], 0, 1.3)),
        key(0.76, shellTo[0], faceTo(shellTo[0][0], shellTo[0][1], 0, 1.3)),
        key(0.82, rest[1], 2.8),
        key(1, rest[1], 2.8),
      ],
      s,
      f,
      0,
    );
    if (inWin(s, 0.14, 0.3)) {
      const ins = 0.5 * strokes((s - 0.14) / 0.16, 3);
      f.lean += 0.25 * ins;
      pole(f, g, ins);
    } else if (!inWin(s, S.shell[0] + 0.05, S.shell[1])) poleRest(f);
    flinch(f, g, 0.25);
  }
  // 2 the loader: the powder, then the other shell carrier
  {
    const f = out[LOADER];
    reset(f, LOADER);
    track(
      [
        key(0, rest[2], 2.5),
        key(0.3, rest[2], 2.5),
        key(0.33, at(P.boxAt[0], P.boxAt[1]), Math.PI * 0.6),
        key(0.36, at(P.boxAt[0], P.boxAt[1]), Math.PI * 0.6),
        key(0.41, fl, aimL, 0.1),
        key(0.45, fl, aimL, 0.1),
        key(0.5, rest[2], 2.5),
        key(0.55, shellFrom[1], faceTo(shellFrom[1][0], shellFrom[1][1], P.ammo[0], P.ammo[1])),
        key(0.6, shellFrom[1], faceTo(shellFrom[1][0], shellFrom[1][1], P.ammo[0], P.ammo[1])),
        key(0.7, shellTo[1], faceTo(shellTo[1][0], shellTo[1][1], 0, 1.3)),
        key(0.76, shellTo[1], faceTo(shellTo[1][0], shellTo[1][1], 0, 1.3)),
        key(0.82, rest[2], 2.5),
        key(1, rest[2], 2.5),
      ],
      s,
      f,
      0,
    );
    if (inWin(s, 0.3, 0.36)) fetch(f, P.box, g.propTurn, (s - 0.3) / 0.06, CARTRIDGE);
    else if (inWin(s, 0.36, 0.41)) hold(f, CARTRIDGE);
    else if (inWin(s, 0.41, 0.48)) putIn(f, g, (s - 0.41) / 0.07, CARTRIDGE);
    flinch(f, g, 0.25);
  }
  // The shell between the two: lifted from the crate (0.55 to 0.62), carried (to 0.7), raised into the muzzle (to 0.78).
  if (s >= 0.55 && s < 0.78) {
    const a = out[SPONGE], b = out[LOADER];
    const mx = (a.px + b.px) / 2, mz = (a.pz + b.pz) / 2;
    const lift1 = sm((s - 0.55) / 0.07);
    const into = sm((s - 0.7) / 0.08);
    const x = lerp(mx, muz[0], into), z = lerp(mz, muz[2], into);
    const y = lerp(0.15 + 0.75 * lift1, muz[1], into);
    for (const f of [a, b]) {
      const sideX = f === a ? -0.2 : 0.2;
      bothHands(f, x, y, z, 0.0);
      set3(f === a ? f.hl : f.hl, x + sideX, y, z);
      set3(f.hr, x + sideX, y, z);
      f.tool = NO_TOOL;
      f.lean = 0.15 + 0.2 * into;
    }
    a.carry = SHELL;
    set3(a.cp, x, y, z);
    if (s >= 0.76) a.carry = NO_CARRY;
  }
}

// --- the swivel ----------------------------------------------------------------------------------------------

function swivelCrew(g: CrewGun, out: Figure[]) {
  const P = PLACES.swivel;
  const s = g.stage;
  const f = out[GUNNER];
  reset(f, GUNNER);
  const breech = at(-0.6, -0.2);
  const tiller = P.gunnerReady;
  const faceX = Math.PI / 2;
  track([key(0, tiller, faceX), key(0.08, at(-0.9, -0.7), faceX - 0.2), key(0.16, breech, faceX), key(0.5, breech, faceX), key(0.62, tiller, faceX), key(1, tiller, faceX)], s, f, 0);
  ventOf(g, _m);
  if (inWin(s, 0.16, 0.5)) {
    // A short stroke at the breech: the hands work along it.
    const u = (s - 0.16) / 0.34;
    const k = strokes(u, 4);
    f.lean = 0.45;
    turned(0, -0.3 - g.slide + 0.12 * (k - 0.5), g.turn, _p);
    bothHands(f, _p[0], g.drop + 0.02, _p[1], 0.1);
  } else {
    gunnerMatch(f, g);
    // One hand on the tiller.
    turned(0, -0.9 - g.slide, g.turn, _p);
    set3(f.hr, _p[0], g.drop - 0.02, _p[1]);
    f.lean = 0.3;
  }
  flinch(f, g, 0.5);
}

/**
 * Pose a gun's crew: fills `out` (at least four figures) and returns how many men there are. `out` positions are in the
 * gun's frame, y from its floor.
 */
export function poseCrew(g: CrewGun, out: Figure[]): number {
  posing = g;
  if (g.kind === "longGun" || g.kind === "chainShot") longCrew(g, out);
  else if (g.kind === "mortar") mortarCrew(g, out);
  else swivelCrew(g, out);
  posing = null;
  return CREW_SIZE[g.kind];
}

/** How many men stand at a gun: none for an empty slot (`armed` ""), a gun knocked out (it was swept away; its crew is back with it) or a gun not shown now. */
export function crewSizeFor(armed: string, out: boolean, shown: boolean): number {
  if (armed === "" || out || !shown) return 0;
  return CREW_SIZE[armed as WeaponKind] ?? 0;
}

/** Whether a point in the gun's frame (y from its floor) lies in the sight camera's central cone and the band below the crosshair. */
export function inSightLine(cx: number, y: number, cz: number, drop: number, turn = 0, scale = 1): boolean {
  // Into the gun's own frame (the sight turns with the gun).
  const c = Math.cos(turn), s = Math.sin(turn);
  const x = cx * c - cz * s, z = cx * s + cz * c;
  const dz = z + SIGHT.back;
  if (dz <= 0.05) return false;
  const az = Math.atan2(Math.abs(x), dz);
  const el = Math.atan2(y - (drop + SIGHT.up), dz);
  return az < SIGHT.azimuth * scale && el < SIGHT.above && el > -SIGHT.below;
}

/** Where a man's head stands (gun frame, y from the floor), for the sight's clear cone and for hiding. */
export function headOf(f: Figure, o: V3): V3 {
  const h = 1.62 - f.crouch;
  const lean = f.lean;
  o[0] = f.px + Math.sin(f.face) * Math.sin(lean) * 0.6;
  o[1] = f.py + h * Math.cos(Math.min(1.2, Math.abs(lean)) * 0.8) + 0.05;
  o[2] = f.pz + Math.cos(f.face) * Math.sin(lean) * 0.6;
  return o;
}
