// What the page needs to know to draw the machines (3.5): which pieces of the
// layout are drawn as a bell, a treadwheel, a jib or a yard instead of as
// boxes, how a bell swings, when the crane's wheel turns and how a pennant
// streams. Render only, no sim: it reads the layout and the frame and decides
// nothing. Tested in Node (apps/game/test/organs.test.ts).

import { CRANE, ORGAN_KINDS, type CastleLayout } from "@keepfall/content";
import { WORKS_STRIDE } from "@keepfall/sim";

const BELL = ORGAN_KINDS.indexOf("bell");
const CRANE_K = ORGAN_KINDS.indexOf("crane");
const MAST = ORGAN_KINDS.indexOf("mast");

/** The pieces of one castle's organs the page draws itself (stone ids, -1 where the layout has none, as in the lab). */
export interface OrganIds {
  /** The iron box the bell hangs for. */
  bell: number;
  /** The treadwheel's box, and the jib (the crane's key piece) the rope hangs from. */
  wheel: number;
  jib: number;
  /** The signal mast's yard (its key piece): the pennant flies from it. */
  yard: number;
}

/** Each castle's organ pieces. */
export function organIds(layout: CastleLayout): [OrganIds, OrganIds] {
  const out: [OrganIds, OrganIds] = [
    { bell: -1, wheel: -1, jib: -1, yard: -1 },
    { bell: -1, wheel: -1, jib: -1, yard: -1 },
  ];
  for (const r of layout.organs ?? []) {
    const o = out[r.castle];
    if (r.organ === BELL) o.bell = r.key;
    else if (r.organ === MAST) o.yard = r.key;
    else if (r.organ === CRANE_K) {
      o.jib = r.key;
      // The treadwheel is the one stout, tall box of the crane (its sills and its mast's lengths are slender).
      for (let id = r.first; id < r.first + r.count; id++) {
        const s = layout.stones[id];
        if (s.hy > 1 && s.hz > 1 && s.hx < 0.5) o.wheel = id;
      }
    }
  }
  return out;
}

/** The stones drawn by the organs' view and so not as boxes. */
export function drawnByOrgans(layout: CastleLayout): number[] {
  const ids: number[] = [];
  for (const o of organIds(layout)) {
    if (o.bell >= 0) ids.push(o.bell);
    if (o.wheel >= 0) ids.push(o.wheel);
  }
  return ids;
}

/** Is a stone's drawn place off its place as built (fallen, or withdrawn while it is being put back)? Metres. */
export function displaced(home: { x: number; y: number; z: number }, x: number, y: number, z: number, limit = 0.4): boolean {
  if (y < -500) return true;
  return Math.hypot(x - home.x, y - home.y, z - home.z) > limit;
}

/** Bell: swings this far (radians) at its fullest, and this often (Hz). */
export const BELL_SWING = 0.34;
export const BELL_HZ = 0.85;

/** The share of its swing a bell has, from how long it has been ringing (seconds, -1 for not ringing) and what it had a moment ago: eases in over 0.4 s, out over 1.5 s. */
export function bellAmplitude(now: number, ringing: number, dt: number): number {
  const target = ringing >= 0 ? 1 : 0;
  const rate = target > now ? 1 / 0.4 : 1 / 1.5;
  const step = rate * dt;
  return target > now ? Math.min(target, now + step) : Math.max(target, now - step);
}

/** The bell's angle about its yoke at a time: a ringing bell swings, a clapper trails a little behind it. */
export function bellAngle(amp: number, t: number): number {
  return amp * BELL_SWING * Math.sin(t * Math.PI * 2 * BELL_HZ);
}
export function clapperAngle(amp: number, t: number): number {
  return amp * 0.5 * Math.sin(t * Math.PI * 2 * BELL_HZ - 1.1);
}

/** Do a castle's masons work high now (a repair whose stone's foot is at or over CRANE.low)? Per castle, from a frame's works entries. */
export function masonsWorkHigh(layout: CastleLayout, works: ArrayLike<number>, count: number): [boolean, boolean] {
  const high: [boolean, boolean] = [false, false];
  for (let i = 0; i < count; i++) {
    const o = i * WORKS_STRIDE;
    const c = works[o] | 0;
    if (c !== 0 && c !== 1) continue;
    const s = layout.stones[works[o + 6] | 0];
    if (s && s.y - s.hy >= CRANE.low - 0.01) high[c] = true;
  }
  return high;
}

/** The wheel's turning speed (rad/s) when the masons work high; it eases up and down over a second. */
export const WHEEL_SPEED = 0.9;

/** One point of a streaming cloth: how far along the wind it stands, and how it is blown aside and down, for u in 0..1 along it at a time. */
export interface StreamerPoint {
  along: number;
  side: number;
  drop: number;
}

/**
 * A pennant or flag streaming from a pole: `length` m long, blown out to
 * `stream` (0..1: how straight the wind holds it out; slack cloth hangs),
 * fluttering at `t` seconds. Pure maths, for the vertex updates.
 */
export function streamerAt(u: number, t: number, length: number, stream: number, out: StreamerPoint = { along: 0, side: 0, drop: 0 }): StreamerPoint {
  const flutter = Math.sin(t * 7.5 - u * 6.5) * (0.07 + 0.12 * stream) + Math.sin(t * 12.7 - u * 11) * 0.03;
  const hang = (1 - stream) * u * 0.85;
  out.along = length * u * (0.35 + 0.65 * stream) * (1 - 0.5 * hang * hang);
  out.side = length * u * flutter;
  out.drop = length * hang * u * 0.5 - Math.abs(flutter) * length * u * 0.15;
  return out;
}

/** How straight the wind holds cloth out, from its speed (m/s). A calm day leaves it slack. */
export function streamOf(windSpeed: number): number {
  return Math.min(1, 0.4 + windSpeed * 0.1);
}
