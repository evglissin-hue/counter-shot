// Moments (track S, step S1): the page works out when something worth showing
// happened, from what it is already told: a frame's events (Muzzle, Down,
// Fell, Keg, Explosion, GunOut, Landed), the frame's minions, parts and plots,
// and the match report (the earned feed, gates, storms, keeps, the result).
// A moment is emitted once. Nothing here feeds the simulation.
//
// The class is plain data in, plain data out (no DOM, no renderer), so it is
// tested from synthetic streams. Consumers (the impact cam, the recorder, the
// book of feats) call `onMoment`.

import { Earn, repairSections, sectionOf, BUILDINGS, BUILDING_KINDS, type CastleLayout } from "@keepfall/content";
import { Cause, EVENT_STRIDE, EventKind, MINION_STRIDE, PART_STRIDE, PLOT_STRIDE, type FrameData } from "@keepfall/sim";

export type MomentKind =
  | "multiKill"
  | "ricochetKill"
  | "collapseKill"
  | "thrown"
  | "kegChain"
  | "kegBack"
  | "gunSilenced"
  | "buildingWrecked"
  | "gateDown"
  | "breachOpened"
  | "towerDown"
  | "floorCaved"
  | "bannerDown"
  | "bridgeDown"
  | "stormBegun"
  | "stormBeaten"
  | "lastBlow";

export interface Moment {
  /** The page clock (ms) when it was found. */
  atMs: number;
  /** The simulation tick it belongs to. */
  tick: number;
  x: number;
  y: number;
  z: number;
  kind: MomentKind;
  /** Whose doing it was: 0 or 1, -1 nobody. */
  team: number;
  /** How worth showing: higher is more. See scoreOf. */
  score: number;
  /** A short, concrete line: "Tower down: 212 stones, 9 men, a gun". */
  text: string;
  /** The shot that did it, when one did. */
  shot?: number;
  /** The number the kind is sized by (men, stones, metres, kegs); the book of feats keeps the best. */
  size: number;
  men?: number;
  stones?: number;
  guns?: number;
}

/**
 * The scoring table, in one place: score = base + per * size, plus a bonus per
 * man and per gun that went with it. The rare score more. A first look, to be
 * tuned by watching matches.
 */
export const SCORE: Record<MomentKind, { base: number; per: number }> = {
  multiKill: { base: 20, per: 25 },
  ricochetKill: { base: 60, per: 20 },
  collapseKill: { base: 40, per: 30 },
  thrown: { base: 30, per: 2 },
  kegChain: { base: 50, per: 40 },
  kegBack: { base: 80, per: 30 },
  gunSilenced: { base: 80, per: 0 },
  buildingWrecked: { base: 70, per: 0 },
  gateDown: { base: 120, per: 0 },
  breachOpened: { base: 90, per: 2 },
  towerDown: { base: 200, per: 1 },
  floorCaved: { base: 250, per: 0 },
  bannerDown: { base: 400, per: 0 },
  bridgeDown: { base: 60, per: 30 },
  stormBegun: { base: 50, per: 0 },
  stormBeaten: { base: 120, per: 0 },
  lastBlow: { base: 1000, per: 0 },
};
const MAN_BONUS = 20;
const GUN_BONUS = 60;

export function scoreOf(kind: MomentKind, size: number, extra: { men?: number; guns?: number } = {}): number {
  const s = SCORE[kind];
  return Math.round(s.base + s.per * size + MAN_BONUS * (extra.men ?? 0) + GUN_BONUS * (extra.guns ?? 0));
}

/** Tuning that is not a score. */
const T = {
  /** A shot's knockdowns close into one moment this many ticks after the last. */
  shotWait: 90,
  /** Fewest men for a multi-kill moment (feats ask for more). */
  multiMin: 2,
  /** A man thrown this far (m, along the ground) is a moment. */
  throwMin: 20,
  /** Bodies slower than this at the blow are not tracked for throwing. */
  throwSpeed: 9,
  /** Give up on a body that has not settled after this many ticks. */
  throwTrack: 600,
  /** A collapse record closes after this many quiet ticks. */
  collapseWait: 150,
  /** Stones of a tower (share of it) that make it "down", and of a wall that make a breach. */
  towerShare: 0.3,
  towerMin: 40,
  breachMin: 20,
  /** A keg chain closes after this many quiet ticks; fewest kegs for a chain. */
  kegWait: 120,
  kegMin: 3,
  /** A burst this near a lit keg is that keg (m). */
  kegNear: 4,
  /** A ricochet credit counts for a shot whose knockdowns fall within this many ticks of it. */
  ricochetSlack: 45,
  /** Landings and bridges: a shot that came down this near a bridge (m) dropped it. */
  bridgeNear: 22,
  /** Most moments kept in the log. */
  logCap: 300,
};

/** What the class needs to know of the world it watches. */
export interface MomentsOptions {
  layout: CastleLayout;
  /** The page clock, in ms. */
  clock: () => number;
  /** A gun (match emplacement id) as the page knows it: its team and a name, or null. */
  gun: (emp: number) => { team: number; name: string; x: number; y: number; z: number } | null;
  /** The team this page plays (for "Your" and "Enemy" in words). */
  me: () => number;
}

/** The part of a MatchInfo that moments read. */
export interface MatchView {
  tick: number;
  earned: Float32Array;
  gateOpen: [boolean, boolean];
  storm: [number, number];
  keeps: [number, number];
  result: { winner: number; reason: string; tick: number } | null;
}
const EARN_STRIDE = 6;

interface Man {
  team: number;
  x: number;
  y: number;
  z: number;
}
interface ShotGroup {
  shot: number;
  team: number;
  men: Set<number>;
  first: number;
  last: number;
  x: number;
  y: number;
  z: number;
  /** Seen to glance off masonry first (a ricochet credit near its kills). */
  ricochet: boolean;
}
interface Thrown {
  id: number;
  team: number;
  shot: number;
  x0: number;
  z0: number;
  x: number;
  y: number;
  z: number;
  tick: number;
}
interface Collapse {
  castle: number;
  first: number;
  last: number;
  bySection: Map<number, number>;
  men: number;
  guns: number;
}
interface KegSet {
  x: number;
  y: number;
  z: number;
  team: number;
  burst: boolean;
}
interface KegChain {
  first: number;
  last: number;
  bursts: number;
  own: number;
  men: number;
  team: number;
  x: number;
  y: number;
  z: number;
}

export class Moments {
  private subs: Array<(m: Moment) => void> = [];
  /** Every moment emitted this match, oldest first (capped). */
  readonly log: Moment[] = [];
  private shots = new Map<number, { team: number; auto: boolean }>();
  private groups = new Map<number, ShotGroup>();
  private cur = new Map<number, Man>();
  private prev = new Map<number, Man>();
  private thrown = new Map<number, Thrown>();
  private collapses: Array<Collapse | null> = [null, null];
  private kegs: KegSet[] = [];
  private chain: KegChain | null = null;
  private ricochets: Array<{ team: number; tick: number; x: number; z: number }> = [];
  private landings: Array<{ team: number; tick: number; x: number; z: number }> = [];
  private tick = 0;
  private prevMatch: MatchView | null = null;
  private lastKeeps: [number, number] = [3, 3];
  private ended = false;
  private readonly sectionOf: Int16Array;
  private readonly sectionStones: number[];
  private readonly sectionKind: string[];
  private readonly gateAt: Array<[number, number, number]> = [];
  private readonly keepAt: Array<[number, number, number]> = [];
  private readonly yardAt: Array<[number, number, number]> = [];

  constructor(private o: MomentsOptions) {
    this.sectionOf = sectionOf(o.layout);
    const secs = repairSections(o.layout);
    this.sectionStones = secs.map((s) => s.stones.length);
    this.sectionKind = secs.map((s) => s.kind);
    for (const c of [0, 1]) {
      const mean = (pick: (s: CastleLayout["stones"][number]) => boolean): [number, number, number] => {
        let n = 0, x = 0, y = 0, z = 0;
        for (const s of o.layout.stones) {
          if (s.castle !== c || !pick(s)) continue;
          n++;
          x += s.x;
          y += s.y;
          z += s.z;
        }
        return n ? [x / n, y / n, z / n] : [0, 0, 0];
      };
      this.gateAt[c] = mean((s) => s.part === "gate");
      this.keepAt[c] = mean((s) => s.part === "keep" || s.part === "storey");
      const all = mean(() => true);
      this.yardAt[c] = [all[0], 2, all[2]];
    }
  }

  /** Subscribe to moments. Returns the unsubscribe function. */
  onMoment(cb: (m: Moment) => void): () => void {
    this.subs.push(cb);
    return () => {
      const i = this.subs.indexOf(cb);
      if (i >= 0) this.subs.splice(i, 1);
    };
  }

  /** A new match or range: forget everything in flight (the log stays until cleared). */
  reset() {
    this.log.length = 0;
    this.shots.clear();
    this.groups.clear();
    this.cur.clear();
    this.prev.clear();
    this.thrown.clear();
    this.collapses = [null, null];
    this.kegs = [];
    this.chain = null;
    this.ricochets = [];
    this.landings = [];
    this.prevMatch = null;
    this.lastKeeps = [3, 3];
    this.ended = false;
    this.tick = 0;
    this.lastSeen.clear();
    this.plotState.clear();
  }

  private emit(m: Omit<Moment, "atMs" | "score"> & { score?: number }) {
    const full: Moment = { ...m, atMs: this.o.clock(), score: m.score ?? scoreOf(m.kind, m.size, { men: m.men, guns: m.guns }) };
    this.log.push(full);
    if (this.log.length > T.logCap) this.log.shift();
    for (const cb of this.subs.slice()) cb(full);
  }

  // ---- the frame ---------------------------------------------------------------

  frame(f: FrameData) {
    this.tick = f.tick;
    // Who stands where (the last two frames, so a man who fell this frame is still found).
    this.prev = this.cur;
    this.cur = new Map();
    for (let i = 0; i < f.minionCount; i++) {
      const o = i * MINION_STRIDE;
      this.cur.set(f.minions[o] | 0, { x: f.minions[o + 1], y: f.minions[o + 2], z: f.minions[o + 3], team: f.minions[o + 6] | 0 });
    }
    for (let k = 0; k < f.eventCount; k++) {
      const o = k * EVENT_STRIDE;
      const kind = f.events[o], a = f.events[o + 1], b = f.events[o + 2], c = f.events[o + 3], d = f.events[o + 4];
      switch (kind) {
        case EventKind.Muzzle: {
          const g = this.o.gun(a);
          this.shots.set(b, { team: g ? g.team : -1, auto: c === 1 });
          break;
        }
        case EventKind.Landed: {
          const emp = a < 0 ? -a - 1 : a;
          const g = this.o.gun(emp);
          if (g) this.landings.push({ team: g.team, tick: f.tick, x: b, z: d });
          break;
        }
        case EventKind.Down:
          this.onDown(a | 0, b | 0, c | 0, d);
          break;
        case EventKind.Fell:
          this.onFell(a | 0, b | 0, c | 0);
          break;
        case EventKind.Keg:
          this.onKegSet(a | 0, b, c, d);
          break;
        case EventKind.Explosion:
          this.onBurst(a, b, c);
          break;
        case EventKind.GunOut:
          this.onGunOut(a | 0, b | 0, c | 0);
          break;
      }
    }
    this.followThrown(f);
    this.plots(f);
    this.closeSettled();
    if (this.landings.length > 40) this.landings.splice(0, this.landings.length - 40);
  }

  /** A man fell: cause, shot (-1 none), speed of his body. (Called with the event's fields in order.) */
  private onDown(id: number, cause: number, shot: number, speed: number) {
    const man = this.cur.get(id) ?? this.prev.get(id) ?? this.lastSeen.get(id);
    const x = man ? man.x : 0, y = man ? man.y + 1 : 1, z = man ? man.z : 0;
    const mteam = man ? man.team : -1;
    this.lastSeen.set(id, man ?? { team: -1, x, y: y - 1, z });
    const info = shot >= 0 ? this.shots.get(shot) : undefined;
    const shooter = info ? info.team : -1;
    if ((cause === Cause.Ball || cause === Cause.Burst) && shot >= 0) {
      // His own side's gun killing him is not a multi-kill.
      if (!(mteam >= 0 && shooter >= 0 && mteam === shooter)) {
        let g = this.groups.get(shot);
        if (!g) {
          g = { shot, team: shooter, men: new Set(), first: this.tick, last: this.tick, x, y, z, ricochet: false };
          this.groups.set(shot, g);
        }
        g.men.add(id);
        g.last = this.tick;
      }
    } else if (cause === Cause.Masonry) {
      const castle = this.castleAt(x, z);
      const col = this.collapse(castle);
      col.men++;
      col.last = this.tick;
    } else if (cause === Cause.Burst && shot < 0) {
      // A keg's burst (or a building's): part of the open chain.
      if (this.chain) {
        this.chain.men++;
        this.chain.last = this.tick;
        if (mteam >= 0 && mteam === this.chain.team) this.chain.own++;
      }
    }
    if (speed >= T.throwSpeed) {
      this.thrown.set(id, { id, team: shooter >= 0 ? shooter : cause === Cause.Burst && this.chain ? this.chain.team : -1, shot, x0: x, z0: z, x, y, z, tick: this.tick });
    }
  }
  private lastSeen = new Map<number, Man>();

  /** Which castle a place is in (the nearer one's courtyard centre). */
  private castleAt(x: number, z: number): number {
    const d = (c: number) => (x - this.yardAt[c][0]) ** 2 + (z - this.yardAt[c][2]) ** 2;
    return d(0) <= d(1) ? 0 : 1;
  }

  private collapse(castle: number): Collapse {
    let c = this.collapses[castle];
    if (!c) {
      c = { castle, first: this.tick, last: this.tick, bySection: new Map(), men: 0, guns: 0 };
      this.collapses[castle] = c;
    }
    return c;
  }

  private onFell(castle: number, section: number, count: number) {
    if (castle < 0 || castle > 1 || count <= 0) return;
    const c = this.collapse(castle);
    c.bySection.set(section, (c.bySection.get(section) ?? 0) + count);
    c.last = this.tick;
  }

  private onGunOut(emp: number, _cause: number, shot: number) {
    const g = this.o.gun(emp);
    if (!g) return;
    const doer = 1 - g.team;
    const castle = g.team;
    const col = this.collapses[castle];
    if (col && shot < 0) col.guns++;
    const text = g.team === this.o.me() ? `Your ${g.name} knocked out` : `Enemy ${g.name} silenced`;
    this.emit({ tick: this.tick, x: g.x, y: g.y, z: g.z, kind: "gunSilenced", team: doer, size: 1, guns: 1, text, shot: shot >= 0 ? shot : undefined });
  }

  // ---- kegs --------------------------------------------------------------------

  private onKegSet(sapper: number, x: number, y: number, z: number) {
    const man = this.cur.get(sapper) ?? this.prev.get(sapper) ?? this.lastSeen.get(sapper);
    this.kegs.push({ x, y, z, team: man ? man.team : -1, burst: false });
    if (this.kegs.length > 30) this.kegs.shift();
  }

  private onBurst(x: number, y: number, z: number) {
    let hit: KegSet | null = null;
    let best = T.kegNear * T.kegNear;
    for (const k of this.kegs) {
      if (k.burst) continue;
      const d = (k.x - x) ** 2 + (k.y - y) ** 2 + (k.z - z) ** 2;
      if (d < best) {
        best = d;
        hit = k;
      }
    }
    if (!hit) return;
    hit.burst = true;
    if (!this.chain) this.chain = { first: this.tick, last: this.tick, bursts: 0, own: 0, men: 0, team: hit.team, x, y, z };
    this.chain.bursts++;
    this.chain.last = this.tick;
  }

  // ---- bodies in flight --------------------------------------------------------

  private followThrown(f: FrameData) {
    if (!this.thrown.size) return;
    for (let i = 0; i < f.partCount; i++) {
      const o = i * PART_STRIDE;
      const t = this.thrown.get(f.parts[o] | 0);
      if (t && (f.parts[o + 1] | 0) === 0) {
        t.x = f.parts[o + 2];
        t.y = f.parts[o + 3];
        t.z = f.parts[o + 4];
      }
    }
    // A body that settled (or sank) has gone as far as it will go.
    for (let i = 0; i < f.settledCount; i++) {
      const o = i * PART_STRIDE;
      const t = this.thrown.get(f.settled[o] | 0);
      if (t && (f.settled[o + 1] | 0) === 0) {
        t.x = f.settled[o + 2];
        t.y = f.settled[o + 3];
        t.z = f.settled[o + 4];
      }
      if (t) this.finishThrown(t);
    }
    for (let i = 0; i < f.gone.length; i++) {
      const t = this.thrown.get(f.gone[i]);
      if (t) this.finishThrown(t);
    }
  }

  private finishThrown(t: Thrown) {
    this.thrown.delete(t.id);
    const m = Math.hypot(t.x - t.x0, t.z - t.z0);
    if (m < T.throwMin) return;
    const metres = Math.round(m);
    this.emit({ tick: this.tick, x: t.x0, y: t.y, z: t.z0, kind: "thrown", team: t.team, size: metres, men: 1, text: `A man thrown ${metres} m`, shot: t.shot >= 0 ? t.shot : undefined });
  }

  // ---- plots -------------------------------------------------------------------

  private plotState = new Map<number, number>();
  private plots(f: FrameData) {
    for (let i = 0; i < f.plotCount; i++) {
      const o = i * PLOT_STRIDE;
      const castle = f.plots[o] | 0, plot = f.plots[o + 1] | 0, kind = f.plots[o + 2] | 0, state = f.plots[o + 3] | 0;
      const key = castle * 16 + plot;
      const was = this.plotState.get(key) ?? 0;
      this.plotState.set(key, state);
      if (state === 3 && was !== 3 && was !== 0) {
        const name = BUILDINGS[BUILDING_KINDS[kind]]?.name ?? "Building";
        const at = this.yardAt[castle];
        this.emit({ tick: f.tick, x: at[0], y: 3, z: at[2], kind: "buildingWrecked", team: 1 - castle, size: 1, text: `${name} wrecked` });
      }
    }
  }

  // ---- closing what has gone quiet --------------------------------------------

  private closeSettled() {
    const now = this.tick;
    // A body that never settled: judge it where it is.
    for (const t of [...this.thrown.values()]) if (now - t.tick > T.throwTrack) this.finishThrown(t);
    // Shots.
    for (const g of [...this.groups.values()].sort((a, b) => a.shot - b.shot)) {
      if (now - g.last < T.shotWait) continue;
      this.groups.delete(g.shot);
      this.closeShot(g);
    }
    // Collapses.
    for (const castle of [0, 1]) {
      const c = this.collapses[castle];
      if (c && now - c.last >= T.collapseWait) {
        this.collapses[castle] = null;
        this.closeCollapse(c);
      }
    }
    // Keg chain.
    if (this.chain && now - this.chain.last >= T.kegWait) {
      const k = this.chain;
      this.chain = null;
      this.closeChain(k);
    }
    this.ricochets = this.ricochets.filter((r) => now - r.tick < 600);
  }

  private closeShot(g: ShotGroup) {
    const n = g.men.size;
    const team = g.team;
    const credit = this.ricochets.find((r) => r.team === team && r.tick >= g.first - T.ricochetSlack && r.tick <= g.last + T.ricochetSlack);
    if (credit) {
      this.emit({ tick: g.last, x: g.x, y: g.y, z: g.z, kind: "ricochetKill", team, size: n, men: n, shot: g.shot, text: n === 1 ? "A man felled off a ricochet" : `${word(n)} men felled off a ricochet` });
      return;
    }
    if (n >= T.multiMin) {
      this.emit({ tick: g.last, x: g.x, y: g.y, z: g.z, kind: "multiKill", team, size: n, men: n, shot: g.shot, text: `${word(n)} men with one shot` });
    }
  }

  private closeCollapse(c: Collapse) {
    let stones = 0;
    let towerSec = -1, towerN = 0, wallSec = -1, wallN = 0;
    for (const [sec, n] of c.bySection) {
      stones += n;
      const kind = sec >= 0 ? this.sectionKind[sec] : "";
      if (kind === "towers" && n > towerN) {
        towerN = n;
        towerSec = sec;
      }
      if (kind === "walls" && n > wallN) {
        wallN = n;
        wallSec = sec;
      }
    }
    const team = 1 - c.castle;
    const at = (sec: number): [number, number, number] => {
      if (sec < 0) return this.yardAt[c.castle];
      const ids = repairSectionStones(this.o.layout, sec);
      let x = 0, y = 0, z = 0;
      for (const id of ids) {
        const s = this.o.layout.stones[id];
        x += s.x;
        y += s.y;
        z += s.z;
      }
      const n = Math.max(1, ids.length);
      return [x / n, y / n, z / n];
    };
    const tail = (men: number, guns: number) => [men ? `${men} ${men === 1 ? "man" : "men"}` : "", guns ? (guns === 1 ? "a gun" : `${guns} guns`) : ""].filter(Boolean);
    if (towerSec >= 0 && towerN >= T.towerMin && towerN >= T.towerShare * this.sectionStones[towerSec]) {
      const [x, y, z] = at(towerSec);
      const parts = [`${stones} stones`, ...tail(c.men, c.guns)];
      this.emit({ tick: c.last, x, y, z, kind: "towerDown", team, size: stones, men: c.men, stones, guns: c.guns, text: `Tower down: ${parts.join(", ")}` });
      return;
    }
    if (wallSec >= 0 && wallN >= T.breachMin) {
      const [x, y, z] = at(wallSec);
      const parts = [`${wallN} stones`, ...tail(c.men, c.guns)];
      this.emit({ tick: c.last, x, y, z, kind: "breachOpened", team, size: wallN, men: c.men, stones: wallN, guns: c.guns, text: `Breach in the wall: ${parts.join(", ")}` });
      return;
    }
    if (c.men >= 1) {
      const [x, y, z] = this.yardAt[c.castle];
      this.emit({ tick: c.last, x, y, z, kind: "collapseKill", team, size: c.men, men: c.men, stones, text: c.men === 1 ? "A man buried under falling masonry" : `${word(c.men)} men buried under falling masonry` });
    }
  }

  private closeChain(k: KegChain) {
    if (k.own >= 2) {
      this.emit({ tick: k.last, x: k.x, y: k.y, z: k.z, kind: "kegBack", team: k.team >= 0 ? 1 - k.team : -1, size: k.own, men: k.own, text: `A keg among its own: ${k.own} men` });
    }
    if (k.bursts >= T.kegMin) {
      this.emit({ tick: k.last, x: k.x, y: k.y, z: k.z, kind: "kegChain", team: k.team, size: k.bursts, men: k.men, text: `${k.bursts} kegs in a chain${k.men ? `, ${k.men} ${k.men === 1 ? "man" : "men"} down` : ""}` });
    }
  }

  // ---- the match report --------------------------------------------------------

  /** The match's report (called as each arrives). */
  match(info: MatchView) {
    const prev = this.prevMatch;
    this.prevMatch = info;
    // Trick-shot credits from the earned feed (they arrive before the frames they belong to).
    for (let o = 0; o + EARN_STRIDE <= info.earned.length; o += EARN_STRIDE) {
      if ((info.earned[o + 2] | 0) === Earn.Ricochet) this.ricochets.push({ team: info.earned[o] | 0, tick: info.tick, x: info.earned[o + 3], z: info.earned[o + 5] });
    }
    if (!prev) {
      this.lastKeeps = [info.keeps[0], info.keeps[1]];
      return;
    }
    const tick = info.tick;
    for (const c of [0, 1]) {
      if (!prev.gateOpen[c] && info.gateOpen[c]) {
        const [x, y, z] = this.gateAt[c];
        this.emit({ tick, x, y, z, kind: "gateDown", team: 1 - c, size: 1, text: "Gate broken down" });
      }
      if (!prev.storm[c] && info.storm[c]) {
        const [x, y, z] = this.yardAt[c];
        this.emit({ tick, x, y, z, kind: "stormBegun", team: 1 - c, size: 1, text: "A storm of the courtyard begins" });
      } else if (prev.storm[c] && !info.storm[c] && !info.result) {
        const [x, y, z] = this.yardAt[c];
        this.emit({ tick, x, y, z, kind: "stormBeaten", team: c, size: 1, text: "A storm beaten off" });
      }
      const was = this.lastKeeps[c], now = info.keeps[c];
      if (now < was && !info.result) {
        const [x, y, z] = this.keepAt[c];
        if (now === 0) this.emit({ tick, x, y, z, kind: "bannerDown", team: 1 - c, size: 1, text: "Banner down" });
        else this.emit({ tick, x, y, z, kind: "floorCaved", team: 1 - c, size: was - now, text: now === 2 ? "The keep's roof caves in" : "A keep floor caves in" });
      }
      this.lastKeeps[c] = Math.min(was, now);
    }
    if (info.result && !this.ended) {
      this.ended = true;
      const r = info.result;
      const loser = r.winner === 0 || r.winner === 1 ? 1 - r.winner : -1;
      const at = loser >= 0 ? (r.reason === "keep" ? this.keepAt[loser] : this.yardAt[loser]) : this.yardAt[0];
      const text = r.winner < 0 ? "Both fell on the same blow" : r.reason === "keep" ? "The last blow: the banner falls" : r.reason === "storm" ? "The last blow: the courtyard is held" : r.reason === "surrender" ? "The last word: a surrender" : "Time called";
      this.emit({ tick: r.tick, x: at[0], y: at[1], z: at[2], kind: "lastBlow", team: r.winner, size: 1, text });
    }
  }

  /** The bridges' state changed (true: can be crossed). */
  bridges(was: boolean[], now: boolean[]) {
    for (let k = 0; k < now.length; k++) {
      if (!(was[k] && !now[k])) continue;
      const b = this.o.layout.bridges[k];
      if (!b) continue;
      const { x, z, width, length } = b.site;
      // Men on the deck as it went (the page runs a little behind the match, so a margin).
      let men = 0;
      for (const m of this.cur.values()) if (Math.abs(m.x - x) < width / 2 + 1.5 && Math.abs(m.z - z) < length / 2 + 1.5) men++;
      if (men < 1) continue;
      let team = -1;
      let best = Infinity;
      for (const l of this.landings) {
        const d = Math.hypot(l.x - x, l.z - z);
        if (d < T.bridgeNear && this.tick - l.tick < 900 && d < best) {
          best = d;
          team = l.team;
        }
      }
      this.emit({ tick: this.tick, x, y: 1, z, kind: "bridgeDown", team, size: men, men, text: `Bridge down with ${men} ${men === 1 ? "man" : "men"} on it` });
    }
  }
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
function word(n: number): string {
  return WORDS[n] ?? String(n);
}

function repairSectionStones(layout: CastleLayout, sec: number): number[] {
  return repairSections(layout)[sec].stones;
}
