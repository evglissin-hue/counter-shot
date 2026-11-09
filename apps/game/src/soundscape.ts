// The battle's sound from what the sim reports (cosmetic, page only): what
// each impact strikes (stone, timber, earth or water), the footfalls of
// marching ranks near the camera, pikes meeting where minions fight, men
// shouting and the low roar wherever the fighting is, the stream's murmur
// near the water, and crows over the woods when it is quiet. Sound.ts makes
// the sounds; this decides when and where. The battle's shape is here too:
// waves setting out, marching drums and tramp, cries and falls, gate blows,
// buildings rising and falling, masons' ropes, and your castle's alarms.

import { BRIDGES, MID_Z, STREAM, plotCentre, streamOffset, streamWidth, valleyHeight, type CastleLayout, type WeaponKind } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, KEG_STRIDE, MINION_STRIDE, PLOT_STRIDE, type FrameData } from "@keepfall/sim";
import type { Listener } from "./render/api";
import type { Sound } from "./sound";

export type Material = "stone" | "wood" | "earth" | "water";

/** Upright actions (sim army.ts Action). */
const WALK = 0, FIGHT = 2;
/** Footfalls a second of one marching pikeman (two a stride of 1.4 m at about 1.6 m/s). */
const STEPS_PER_MAN = 2.3;
/** At most this many pike clashes start in one sim frame. */
const CLASHES = 3;
/** Minion unit of a mason (they walk to work, not in a march). */
const MASON = 1;
/** Seconds a stone takes to be lifted (render/works.ts LAY_SECONDS). */
const LIFT = 1.15;
/** What a gate blow's impact strength is (sim army.ts). */
const BLOW = 0.12;
/** Plot states (structures.ts PlotState). */
const RISING = 1, STANDING = 2, RUINED = 3;

/** The part of a MatchInfo this reads. */
interface MatchView {
  waves: [number, number];
  standing: [number, number];
  gateHits: [number, number];
  ladders: [number, number];
  result?: unknown;
}

export class Soundscape {
  /** Each fighting minion's ticks since its last blow, as last seen (a drop means a new blow). */
  private lastAct = new Map<number, number>();
  private walk = { w: 0, x: 0, y: 0, z: 0 };
  private fight = { n: 0, x: 0, y: 0, z: 0 };
  /** Where some of the fighters are (x, y, z triples), for shouts. */
  private fighters: number[] = [];
  private stepDebt = 0;
  private shoutDebt = 0;
  private crowIn = 18 + Math.random() * 25;
  /** Gate leaves (centres), which are timber. */
  private gates: Array<[number, number, number]>;
  /** Which castle is yours and which the enemy's (set by match()). */
  private me = 1;
  private foe = 0;
  private keepsSet = false;
  /** Seconds of page time (counted in update()), for rate limits. */
  private t = 0;
  private last = new Map<string, number>();
  private prevMatch: MatchView | null = null;
  private lastGateBlow = -99;
  /** The two nearest marching groups, and where each drum is in its beat. */
  private drums: Array<{ x: number; y: number; z: number } | null> = [null, null];
  private drumIn = [0, 0];
  private drumCount = [0, 0];
  /** Where fights were last seen (x, z, time), for a war cry when two lines first meet. */
  private fights: Array<{ x: number; z: number; t: number }> = [];
  /** Plots' states as last seen (castle * 8 + plot), the rising ones to saw at, and their stroke timers. */
  private plotState = new Map<number, number>();
  private sawing: Array<{ key: number; x: number; z: number }> = [];
  private sawIn = new Map<number, number>();
  /** The keg positions seen last frame (to tell a new one). */
  private kegs = new Set<string>();
  /** When each rope creak in the air ends. */
  private creaks: number[] = [];

  constructor(
    private sound: Sound,
    private layout: CastleLayout,
  ) {
    this.gates = layout.stones.filter((s) => s.part === "gate").map((s) => [s.x, s.y, s.z]);
  }

  /** What an impact at a point struck. */
  material(x: number, y: number, z: number): Material {
    const half = streamWidth(x) / 2 + 0.4;
    const dz = z - (MID_Z + streamOffset(x));
    if (dz > -half && dz < half && y < STREAM.level + 0.8) return "water";
    for (const b of BRIDGES) {
      if (Math.abs(x - b.x) < b.width / 2 + 1.2 && Math.abs(z - b.z) < b.length / 2 + 1.2 && y < 2.5) return "wood";
    }
    for (const g of this.gates) {
      const gx = x - g[0], gz = z - g[2];
      if (gx * gx + gz * gz < 2.6 * 2.6 && y < 5.6) return "wood";
    }
    const ground = valleyHeight(x, z);
    for (const cz of this.layout.castleZ) {
      if (Math.abs(x) < 20 && Math.abs(z - cz) < 20 && y > ground + 0.35) return "stone";
    }
    return y - ground < 1.0 ? "earth" : "stone";
  }

  /**
   * An impact the sim reported: the sound of what it struck (masonry keeps
   * the stone hit). `open` is the page's own budget for impacts this frame;
   * a blow on a gate has its own (three a second).
   */
  impact(x: number, y: number, z: number, strength: number, open = true) {
    const material = this.material(x, y, z);
    if (material === "wood" && Math.abs(strength - BLOW) < 0.004) {
      if (this.every("batter", 1 / 3)) this.sound.gateBoom(x, y, z);
      return;
    }
    if (!open) return;
    switch (material) {
      case "water":
        this.sound.splash(x, y, z, Math.min(1.4, 0.3 + strength));
        break;
      case "wood":
        this.sound.woodHit(x, y, z, strength);
        break;
      case "earth":
        this.sound.earthHit(x, y, z, strength);
        break;
      default:
        this.sound.impact(x, y, z, strength);
    }
  }

  /** A shot's first touch: into the ground it thumps (masonry, timber and water have their own sounds). */
  landed(x: number, y: number, z: number, weapon: WeaponKind | null) {
    // Only a touch at the ground itself: a ball that first meets a man has its thud already.
    if (y - valleyHeight(x, z) > 0.45 || this.material(x, y, z) !== "earth") return;
    const s = weapon === "swivel" ? 0.3 : weapon === "chainShot" ? 0.6 : weapon === "mortar" ? 0.7 : 0.85;
    this.sound.earthHit(x, y, z, s);
  }

  /** Per sim frame: who marches near the camera, who fights, and the new blows (pikes meeting). */
  frame(f: FrameData, ear: Listener) {
    const M = f.minions;
    let w = 0, wx = 0, wy = 0, wz = 0;
    let n = 0, fx = 0, fy = 0, fz = 0;
    let clashes = 0;
    this.fighters.length = 0;
    const seen = new Set<number>();
    const groups = new Map<number, { n: number; x: number; y: number; z: number }>();
    let marching = 0, mx = 0, my = 0, mz = 0;
    for (let i = 0; i < f.minionCount; i++) {
      const o = i * MINION_STRIDE;
      const id = M[o] | 0;
      const x = M[o + 1], y = M[o + 2], z = M[o + 3];
      const action = M[o + 7] | 0, act = M[o + 8];
      const dx = x - ear.x, dy = y - ear.y, dz = z - ear.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (action === WALK && (M[o + 9] | 0) !== MASON && d2 < 140 * 140) {
        // A marching group: men of a team within a 10 m cell.
        const key = ((Math.floor(x / 10) + 200) * 4096 + Math.floor(z / 10) + 2000) * 2 + ((M[o + 6] | 0) & 1);
        const g = groups.get(key);
        if (g) {
          g.n++;
          g.x += x;
          g.y += y;
          g.z += z;
        } else groups.set(key, { n: 1, x, y, z });
        if (d2 < 80 * 80) {
          marching++;
          mx += x;
          my += y;
          mz += z;
        }
      }
      if (action === WALK) {
        // Near ranks count most: a quarter at 14 m.
        const k = 1 / (1 + d2 / (14 * 14) * 3);
        w += k;
        wx += x * k;
        wy += y * k;
        wz += z * k;
      } else if (action === FIGHT) {
        seen.add(id);
        n++;
        fx += x;
        fy += y;
        fz += z;
        if (this.fighters.length < 48) this.fighters.push(x, y + 1.4, z);
        const prev = this.lastAct.get(id);
        this.lastAct.set(id, act);
        if (prev !== undefined && act < prev && clashes < CLASHES && d2 < 90 * 90) {
          clashes++;
          this.sound.clash(x, y + 1.3, z);
        }
      }
    }
    // Forget those no longer fighting.
    if (this.lastAct.size > seen.size + 64) for (const id of this.lastAct.keys()) if (!seen.has(id)) this.lastAct.delete(id);
    this.walk = w > 0 ? { w, x: wx / w, y: wy / w, z: wz / w } : { w: 0, x: 0, y: 0, z: 0 };
    this.fight = n > 0 ? { n, x: fx / n, y: fy / n, z: fz / n } : { n: 0, x: 0, y: 0, z: 0 };
    this.march(groups, marching, mx, my, mz, ear);
    this.meetings(f, ear);
    this.events(f, ear);
    this.plots(f, ear);
    this.kegsSet(f);
  }

  /** True at most once in `gap` seconds for a kind of sound. */
  private every(key: string, gap: number): boolean {
    if (this.t - (this.last.get(key) ?? -99) < gap) return false;
    this.last.set(key, this.t);
    return true;
  }

  /** The two nearest marching groups carry a drum; the tramp bed grows with the men marching near. */
  private march(groups: Map<number, { n: number; x: number; y: number; z: number }>, n: number, x: number, y: number, z: number, ear: Listener) {
    const near: Array<{ d: number; x: number; y: number; z: number }> = [];
    for (const g of groups.values()) {
      if (g.n < 3) continue;
      const gx = g.x / g.n, gy = g.y / g.n, gz = g.z / g.n;
      const d = Math.hypot(gx - ear.x, gy - ear.y, gz - ear.z);
      if (d < 60) near.push({ d, x: gx, y: gy + 1.2, z: gz });
    }
    near.sort((a, b) => a.d - b.d);
    for (let i = 0; i < 2; i++) this.drums[i] = near[i] ?? null;
    if (n > 0) this.sound.setTramp(Math.min(1, n / 36), x / n, y / n, z / n);
    else this.sound.setTramp(0, 0, 0, 0);
  }

  /** A fight starting where none was within 20 m for 5 s: a war cry as the lines meet (one every 4 s). */
  private meetings(f: FrameData, ear: Listener) {
    const M = f.minions;
    for (const p of this.fights) if (this.t - p.t > 5) p.t = -99;
    let k = 0;
    for (let i = 0; i < f.minionCount && k < 96; i++) {
      const o = i * MINION_STRIDE;
      if ((M[o + 7] | 0) !== FIGHT) continue;
      k++;
      const x = M[o + 1], z = M[o + 3];
      let known = false;
      for (const p of this.fights) {
        if (p.t < 0 || (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) > 400) continue;
        known = true;
        p.t = this.t;
        break;
      }
      if (known) continue;
      let slot = this.fights.find((p) => p.t < 0);
      if (!slot) {
        if (this.fights.length >= 48) continue;
        slot = { x, z, t: this.t };
        this.fights.push(slot);
      }
      slot.x = x;
      slot.z = z;
      slot.t = this.t;
      if (Math.hypot(x - ear.x, z - ear.z) < 160 && this.every("warcry", 4)) this.sound.warCry(x, M[o + 2] + 1.4, z);
    }
  }

  /** The sim's events that sound here: men knocked down, the chain's sweep, a stone's lift. */
  private events(f: FrameData, ear: Listener) {
    for (let k = 0; k < f.eventCount; k++) {
      const o = k * EVENT_STRIDE;
      const kind = f.events[o];
      const a = f.events[o + 1], b = f.events[o + 2], c = f.events[o + 3], d = f.events[o + 4];
      if (kind === EventKind.Blood) {
        const dist = Math.hypot(a - ear.x, b - ear.y, c - ear.z);
        // A hard strike (a ball, a blast) keeps the body's thud; every man down cries and falls.
        if (d > 0.5 && this.every("thud", 0.16)) this.sound.thud(a, b, c, d);
        if (dist < 90) {
          if (this.every("cry", 1 / 3)) this.sound.cry(a, b, c);
          if (this.every("fall", 0.25)) this.sound.bodyFall(a, b - 0.9, c);
        }
      } else if (kind === EventKind.Swept) {
        if (this.every("swish", 0.3)) this.sound.swish(b, c, d);
      } else if (kind === EventKind.Laid) {
        this.lift(a | 0);
      }
    }
  }

  /** A stone goes up the hoist: the rope and pulley at the gin pole (at most two at once). */
  private lift(id: number) {
    this.creaks = this.creaks.filter((e) => e > this.t);
    if (this.creaks.length >= 2) return;
    const s = this.layout.stones[id];
    if (!s) return;
    this.creaks.push(this.t + LIFT);
    this.sound.creak(s.x, Math.max(3, s.y), s.z, LIFT);
  }

  /** Plots: a buy of yours going through, buildings rising (sawing) and wrecked (a crash). */
  private plots(f: FrameData, ear: Listener) {
    for (let i = 0; i < f.plotCount; i++) {
      const o = i * PLOT_STRIDE;
      const castle = f.plots[o] | 0, plot = f.plots[o + 1] | 0, state = f.plots[o + 3] | 0;
      const key = castle * 8 + plot;
      const was = this.plotState.get(key);
      this.plotState.set(key, state);
      if (was === undefined || was === state) continue;
      const pc = plotCentre(castle, plot);
      if (state === RISING && was !== STANDING && castle === this.me) this.sound.purchase(pc.x, 1.5, pc.z);
      else if (state === RUINED && (was === STANDING || was === RISING) && this.every("crash", 0.5)) this.sound.crash(pc.x, 2, pc.z);
    }
    // One saw voice for each rising building, the nearest two.
    const rising: Array<{ key: number; d: number; x: number; z: number }> = [];
    for (const [key, st] of this.plotState) {
      if (st !== RISING) continue;
      const pc = plotCentre(key >> 3, key & 7);
      rising.push({ key, d: Math.hypot(pc.x - ear.x, pc.z - ear.z), x: pc.x, z: pc.z });
    }
    rising.sort((a, b) => a.d - b.d);
    this.sawing = rising.slice(0, 2);
  }

  /** A keg newly set at your wall: a short shrill whistle. */
  private kegsSet(f: FrameData) {
    const now = new Set<string>();
    for (let i = 0; i < f.kegCount; i++) {
      const o = i * KEG_STRIDE;
      const x = f.kegs[o], z = f.kegs[o + 2];
      const key = `${Math.round(x * 2)},${Math.round(z * 2)}`;
      now.add(key);
      if (this.kegs.has(key)) continue;
      if (Math.abs(z - this.layout.castleZ[this.me]) < 30 && this.every("alarm-keg", 20)) this.sound.alarm("keg");
    }
    this.kegs = now;
  }

  /**
   * The match as it is reported (each sim frame): waves setting out, blows on
   * your gate, ladders on your wall. `me` and `foe` are the castle indices.
   */
  match(info: MatchView, me: number, foe: number) {
    if (this.me !== me || this.foe !== foe || !this.keepsSet) {
      this.me = me;
      this.foe = foe;
      this.keepsSet = true;
      this.sound.setKeeps(this.keep(me), this.keep(foe));
    }
    const prev = this.prevMatch;
    this.prevMatch = { waves: [info.waves[0], info.waves[1]], standing: [info.standing[0], info.standing[1]], gateHits: [info.gateHits[0], info.gateHits[1]], ladders: [info.ladders[0], info.ladders[1]] };
    if (!prev || info.result) return;
    for (const c of [me, foe]) {
      // A wave set out: the count rose and more men stand than before.
      if (info.waves[c] > prev.waves[c] && info.standing[c] > prev.standing[c] && this.every(`wave${c}`, 2)) {
        const g = this.gate(c);
        this.sound.drumFlourish(g.x, 3, g.z);
        if (c === foe) this.sound.hornCall(g.x, 8, g.z, 0.3);
      }
    }
    // Alarms for your castle, each at most once every 20 s.
    if (info.gateHits[me] > prev.gateHits[me]) {
      const quiet = this.t - this.lastGateBlow > 20;
      this.lastGateBlow = this.t;
      if (quiet && this.every("alarm-gate", 20)) this.sound.alarm("gate");
    }
    if (info.ladders[me] > prev.ladders[me] && this.every("alarm-ladder", 20)) this.sound.alarm("ladder");
  }

  /** A castle's keep, where its bell hangs. */
  private keep(c: number): { x: number; z: number } {
    let n = 0, x = 0, z = 0;
    for (const s of this.layout.stones) {
      if (s.part !== "keep" || Math.abs(s.z - this.layout.castleZ[c]) > 30) continue;
      n++;
      x += s.x;
      z += s.z;
    }
    return n ? { x: x / n, z: z / n } : { x: 0, z: this.layout.castleZ[c] };
  }

  /** The middle of a castle's gate. */
  private gate(c: number): { x: number; z: number } {
    let n = 0, x = 0, z = 0;
    for (const g of this.gates) {
      if (Math.abs(g[2] - this.layout.castleZ[c]) > 40) continue;
      n++;
      x += g[0];
      z += g[2];
    }
    return n ? { x: x / n, z: z / n } : { x: 0, z: this.layout.castleZ[c] };
  }

  /** A gun bought or upgraded in a slot of yours: coins and the first mallet there. */
  purchase(x: number, y: number, z: number) {
    this.sound.purchase(x, y, z);
  }

  private aimPrev: { yaw: number; pitch: number; weapon: WeaponKind | null } = { yaw: 0, pitch: 0, weapon: null };
  private reloadFor: WeaponKind | null = null;
  private reloadHeard = true;

  /** The gun you ride (every rendered frame): its carriage grinds as it turns. `riding` is false away from the sight. */
  gun(weapon: WeaponKind, yaw: number, pitch: number, yawRate: number, dt: number, riding: boolean) {
    const p = this.aimPrev;
    let speed = 0;
    if (riding && p.weapon === weapon && dt > 0) speed = Math.hypot(yaw - p.yaw, pitch - p.pitch) / dt / yawRate;
    this.aimPrev = { yaw, pitch, weapon };
    const heavy = weapon === "longGun" ? 1 : weapon === "mortar" ? 0.85 : weapon === "chainShot" ? 0.7 : 0.25;
    this.sound.traverse(riding ? speed : 0, heavy, dt);
  }

  /** The reload of the gun you ride (each sim frame): the crew is heard at work a little past halfway. */
  reload(weapon: WeaponKind, left: number, total: number, riding: boolean) {
    if (weapon !== this.reloadFor) {
      this.reloadFor = weapon;
      this.reloadHeard = true;
      return;
    }
    if (left <= 0) {
      this.reloadHeard = true;
      return;
    }
    if (left > total * 0.9) this.reloadHeard = false;
    if (!this.reloadHeard && left < total * 0.45) {
      this.reloadHeard = true;
      if (riding) this.sound.reloadWork(weapon);
    }
  }

  /** The marching drums' beats and the saws' strokes. */
  private beats(dt: number) {
    for (let i = 0; i < 2; i++) {
      const d = this.drums[i];
      if (!d) {
        this.drumIn[i] = 0;
        continue;
      }
      this.drumIn[i] -= dt;
      if (this.drumIn[i] <= 0) {
        this.drumIn[i] = Math.max(0, this.drumIn[i]) + 0.52;
        this.sound.marchDrum(d.x, d.y, d.z, this.drumCount[i]++ % 2 === 0);
      }
    }
    const live = new Set<number>();
    for (const w of this.sawing) {
      live.add(w.key);
      const left = (this.sawIn.get(w.key) ?? Math.random() * 0.6) - dt;
      if (left <= 0) {
        this.sound.saw(w.x, 2, w.z);
        this.sawIn.set(w.key, 0.85 + Math.random() * 0.4);
      } else this.sawIn.set(w.key, left);
    }
    for (const key of this.sawIn.keys()) if (!live.has(key)) this.sawIn.delete(key);
  }

  /** Per rendered frame: footfalls, shouts, the beds (stream, fighting) and the crows. */
  update(dt: number, ear: Listener) {
    const s = this.sound;
    this.t += dt;
    this.beats(dt);
    // Footfalls of the ranks nearest the camera, spread around where they are.
    const walk = this.walk;
    if (walk.w > 0.02) {
      this.stepDebt += Math.min(16, walk.w * STEPS_PER_MAN) * dt;
      let k = 0;
      while (this.stepDebt >= 1 && k < 4) {
        this.stepDebt -= 1;
        k++;
        const j = 2 + 3 * Math.random();
        const a = Math.random() * Math.PI * 2;
        s.footstep(walk.x + Math.cos(a) * j, walk.y, walk.z + Math.sin(a) * j, Math.min(1, 0.35 + walk.w * 0.12));
      }
      if (this.stepDebt > 3) this.stepDebt = 3;
    } else this.stepDebt = 0;
    // Shouting where the fighting is: more men, more voices.
    const fight = this.fight;
    if (fight.n > 0 && this.fighters.length) {
      this.shoutDebt += Math.min(2.4, 0.2 + fight.n * 0.12) * dt;
      while (this.shoutDebt >= 1) {
        this.shoutDebt -= 1 + Math.random() * 0.5;
        const k = Math.floor(Math.random() * (this.fighters.length / 3)) * 3;
        s.shout(this.fighters[k], this.fighters[k + 1], this.fighters[k + 2], 0.6 + 0.4 * Math.random());
      }
    } else this.shoutDebt = 0;
    // The stream's murmur near the water (less from high up), and the roar of the fighting.
    const dz = Math.abs(ear.z - (MID_Z + streamOffset(ear.x))) - streamWidth(ear.x) / 2;
    const near = 1 - Math.min(1, Math.max(0, dz) / 45);
    const high = 1 - 0.75 * Math.min(1, Math.max(0, ear.y - 3) / 60);
    s.setBeds(near * high, Math.min(1, fight.n / 14), fight.x, fight.y + 1, fight.z);
    // A crow now and then over the woods, when the valley is quiet.
    this.crowIn -= dt;
    if (this.crowIn <= 0) {
      this.crowIn = 22 + Math.random() * 48;
      if (fight.n < 6) {
        const a = Math.random() * Math.PI * 2, r = 70 + Math.random() * 70;
        s.crow(ear.x + Math.cos(a) * r, 18 + Math.random() * 10, ear.z + Math.sin(a) * r);
      }
    }
  }
}
