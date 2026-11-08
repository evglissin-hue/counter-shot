// The battle's sound from what the sim reports (cosmetic, page only): what
// each impact strikes (stone, timber, earth or water), the footfalls of
// marching ranks near the camera, pikes meeting where minions fight, men
// shouting and the low roar wherever the fighting is, the stream's murmur
// near the water, and crows over the woods when it is quiet. Sound.ts makes
// the sounds; this decides when and where.

import { BRIDGES, MID_Z, STREAM, streamOffset, streamWidth, valleyHeight, type CastleLayout, type WeaponKind } from "@keepfall/content";
import { MINION_STRIDE, type FrameData } from "@keepfall/sim";
import type { Listener } from "./render/api";
import type { Sound } from "./sound";

export type Material = "stone" | "wood" | "earth" | "water";

/** Upright actions (sim army.ts Action). */
const WALK = 0, FIGHT = 2;
/** Footfalls a second of one marching pikeman (two a stride of 1.4 m at about 1.6 m/s). */
const STEPS_PER_MAN = 2.3;
/** At most this many pike clashes start in one sim frame. */
const CLASHES = 3;

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

  /** An impact the sim reported: the sound of what it struck (masonry keeps the stone hit). */
  impact(x: number, y: number, z: number, strength: number) {
    switch (this.material(x, y, z)) {
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
    if (this.material(x, y, z) !== "earth") return;
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
    for (let i = 0; i < f.minionCount; i++) {
      const o = i * MINION_STRIDE;
      const id = M[o] | 0;
      const x = M[o + 1], y = M[o + 2], z = M[o + 3];
      const action = M[o + 7] | 0, act = M[o + 8];
      const dx = x - ear.x, dy = y - ear.y, dz = z - ear.z;
      const d2 = dx * dx + dy * dy + dz * dz;
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

  /** Per rendered frame: footfalls, shouts, the beds (stream, fighting) and the crows. */
  update(dt: number, ear: Listener) {
    const s = this.sound;
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
