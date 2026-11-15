// Fighting diagnosis probe (army pass): watches every upright army minion each
// tick after the match steps and measures who fights, who stands by, who walks
// past enemies, and how long a clash takes. Measures only; changes nothing.
import { inCourtyard, routeAt, MID_Z, UNIT_DEFS, UNITS, Unit } from "@keepfall/content";
import { Action, Cause, navCell, isWorker, MinionState, Role, routeField, climbing, type Minion } from "@keepfall/sim";
import type { Match } from "@keepfall/rules";

export const ROLE = ["March", "Garrison", "Defend", "Mason", "Gang", "Carrier"];
export const UNITN = ["pike", "mason", "ladder", "sapper", "musket", "boy"];
export const ACT = ["Walk", "Stand", "Fight", "Batter", "Work", "Carry", "Climb", "Raise"];

export function roadX(name: "left" | "centre" | "right", z: number): number {
  return routeAt(name, z - MID_Z)[0];
}

interface ManStats {
  id: number;
  team: number;
  role0: number;
  unit: number;
  up: number;
  /** Ticks with an enemy soldier within 8 m and no target (fighters only). */
  noTgt8: number;
  /** Ticks with an enemy soldier within 6 m and no target. */
  noTgt6: number;
  /** Ticks in Stand or Walk-without-moving with an enemy soldier within 4 m. */
  idle4: number;
  /** Ticks in Fight. */
  fight: number;
  blows: number;
  batter: number;
  batterIdle: number;
  wrongFace: number;
  chaseBlocked: number;
  /** Ticks closing on a target out of reach while another enemy he could walk to stands within his reach. */
  passInReach: number;
  /** Ticks with a target out of reach (closing), and the longest such spell. */
  closing: number;
  streakClose: number;
  maxClose: number;
  streakPass: number;
  /** Ticks with an enemy within 9 m (sight). */
  near9: number;
  streak8: number;
  streakIdle: number;
  streakChase: number;
  /** Resume after a fight: cost and tick when the last enemy left 9 m. */
  freeAt: number;
  freeCost: number;
  engaged: boolean;
}

export interface ProbeOpts {
  /** Log each streak event (default true). */
  log?: boolean;
  /** Streak thresholds (ticks). */
  ignore?: number;
  idle?: number;
  chase?: number;
}

export class Probe {
  men = new Map<number, ManStats>();
  events: string[] = [];
  firstNear = -1;
  firstFight = -1;
  firstBlow = -1;
  lastBlow = -1;
  blowsByTeam = [0, 0];
  downsByBlow = [0, 0]; // by the team of the one knocked down
  downs = [0, 0];
  resume: Array<{ id: number; team: number; ticks: number }> = [];
  noResume: Array<{ id: number; team: number; since: number }> = [];
  /** Per team: ticks with 3+ men targeting, their men-with-targets sum and distinct-targets sum. */
  focus = [0, 0].map(() => ({ ticks: 0, men: 0, distinct: 0, foes: 0 }));
  pileTicks = 0;
  pileTotal = 0;
  untargetedNear = 0;
  private prevState = new Map<number, number>();
  private ignoreFlagged = new Set<string>();
  constructor(private m: Match, private o: ProbeOpts = {}) {}

  private stats(n: Minion): ManStats {
    let s = this.men.get(n.id);
    if (!s) {
      s = { id: n.id, team: n.team, role0: n.role, unit: n.unit, up: 0, noTgt8: 0, noTgt6: 0, idle4: 0, fight: 0, blows: 0, batter: 0, batterIdle: 0, wrongFace: 0, chaseBlocked: 0, passInReach: 0, streakPass: 0, closing: 0, streakClose: 0, maxClose: 0, near9: 0, streak8: 0, streakIdle: 0, streakChase: 0, freeAt: -1, freeCost: 0, engaged: false };
      this.men.set(n.id, s);
    }
    return s;
  }

  log(t: number, text: string) {
    const line = `${(t / 60).toFixed(1)}s ${text}`;
    this.events.push(line);
    if (this.o.log !== false) console.log("  EV " + line);
  }

  desc(n: Minion): string {
    return `#${n.id} t${n.team} ${UNITN[n.unit]}/${ROLE[n.role]} ${ACT[n.action] ?? n.action} task${n.task} at (${n.x.toFixed(1)},${n.z.toFixed(1)}) y${n.y.toFixed(2)} tgt${n.target}`;
  }

  /** Call after each m.step(). */
  after() {
    const m = this.m;
    const t = m.tick;
    const army = m.army;
    const W = m.world;
    const list = W.minions.list;
    // Downs.
    for (const n of list) {
      if (n.wave < 0) continue;
      const p = this.prevState.get(n.id);
      if (p === MinionState.Upright && n.state !== MinionState.Upright) {
        this.downs[n.team]++;
        if (n.downCause === Cause.Blow) this.downsByBlow[n.team]++;
      }
      this.prevState.set(n.id, n.state);
    }
    const sold: Minion[] = [];
    for (const n of list) if (n.state === MinionState.Upright && n.wave >= 0 && !isWorker(n) && !climbing(n)) sold.push(n);
    const targeters = new Map<number, number>();
    for (const n of sold) if (n.target >= 0 && n.unit !== Unit.Musketeer) targeters.set(n.target, (targeters.get(n.target) ?? 0) + 1);
    for (const team of [0, 1]) {
      const ids = new Set<number>();
      let men = 0;
      for (const n of sold) if (n.team === team && n.target >= 0 && n.unit !== Unit.Musketeer && list[n.target].state === MinionState.Upright) {
        men++;
        ids.add(n.target);
      }
      if (men >= 3) {
        const F = this.focus[team];
        F.ticks++;
        F.men += men;
        F.distinct += ids.size;
        // Enemies within 9 m of any of these men.
        let foes = 0;
        for (const k of sold) if (k.team !== team && sold.some((n) => n.team === team && n.target >= 0 && Math.hypot(k.x - n.x, k.z - n.z) <= 9)) foes++;
        F.foes += foes;
      }
    }
    const ign = this.o.ignore ?? 120, idl = this.o.idle ?? 180, chs = this.o.chase ?? 120;
    for (const n of sold) {
      const s = this.stats(n);
      s.up++;
      // Nearest enemy soldier.
      let e: Minion | null = null, ed = Infinity;
      for (const k of sold) {
        if (k.team === n.team) continue;
        const d = Math.hypot(k.x - n.x, k.z - n.z);
        if (d < ed) {
          ed = d;
          e = k;
        }
      }
      if (ed <= 9 && this.firstNear < 0) this.firstNear = t;
      if (n.action === Action.Fight && this.firstFight < 0) this.firstFight = t;
      if (ed <= 9) s.near9++;
      const def = UNIT_DEFS[n.unit] ?? UNITS.pikeman;
      const fighter = def.sight > 0 && n.role !== Role.Gang && n.unit !== Unit.Musketeer && !(W.ladders && W.ladders.controls(n)) && !(W.specialists && W.specialists.busy(n));
      const tg = n.target >= 0 ? list[n.target] : null;
      const hasT = tg !== null && tg.state === MinionState.Upright;
      if (n.action === Action.Fight) {
        s.fight++;
        if (n.act === 1) {
          s.blows++;
          this.blowsByTeam[n.team]++;
          if (this.firstBlow < 0) this.firstBlow = t;
          this.lastBlow = t;
        }
        if (hasT) {
          const dx = tg!.x - n.x, dz = tg!.z - n.z, d = Math.hypot(dx, dz) + 1e-9;
          const cos = (Math.sin(n.yaw) * dx + Math.cos(n.yaw) * dz) / d;
          if (cos < 0.5) s.wrongFace++;
        }
      }
      if (n.action === Action.Batter) {
        s.batter++;
        if (n.act === 1) s.batterIdle += 0; // counted in blows below
      }
      if (n.action === Action.Batter && n.act === 1) s.batterIdle++; // misnamed: batter blows
      if (!fighter) continue;
      // Ignored enemy: no target with an enemy soldier within 8 m.
      if (!hasT && ed <= 8) {
        s.noTgt8++;
        if (ed <= 6) s.noTgt6++;
        s.streak8++;
        if (s.streak8 === ign) {
          const reach = army.walkLine(n.x, n.z, e!.x, e!.z);
          const would = (army as any).nearestEnemy(n, n.role === Role.Garrison || n.role === Role.Defend ? 16 : def.sight, n.role === Role.Garrison || n.role === Role.Defend ? n.home : -1) as Minion | null;
          const key = `${n.id}:${e!.id}`;
          if (!this.ignoreFlagged.has(key)) {
            this.ignoreFlagged.add(key);
            if (process.env.DIAG_LINE) this.log(t, "  line " + this.line(n.x, n.z, e!.x, e!.z));
            this.log(t, `IGNORE ${(ign / 60).toFixed(0)}s: ${this.desc(n)} enemy ${this.desc(e!)} d=${ed.toFixed(1)} walkLine=${reach} nearestEnemy=${would ? would.id : "none"} enemyInCourt0=${inCourtyard(0, e!.x, e!.z)} enemyInCourt1=${inCourtyard(1, e!.x, e!.z)} attackers=${army.attackers.join("/")}`);
          }
        }
      } else s.streak8 = 0;
      // Idle next to a fight.
      const still = n.action === Action.Stand || (n.action === Action.Walk && Math.hypot(n.vx, n.vz) < 0.15);
      if (still && ed <= 4) {
        s.idle4++;
        s.streakIdle++;
        if (s.streakIdle === idl) this.log(t, `IDLE ${(idl / 60).toFixed(0)}s within 4 m of an enemy: ${this.desc(n)} enemy ${this.desc(e!)} d=${ed.toFixed(1)}`);
      } else s.streakIdle = 0;
      // Chasing a target it cannot walk straight to (out of reach).
      if (hasT) {
        const d = Math.hypot(tg!.x - n.x, tg!.z - n.z);
        if (d > def.reach && !army.walkLine(n.x, n.z, tg!.x, tg!.z)) {
          s.chaseBlocked++;
          s.streakChase++;
          if (s.streakChase === chs) this.log(t, `CHASE-BLOCKED ${(chs / 60).toFixed(0)}s: ${this.desc(n)} target ${this.desc(tg!)} d=${d.toFixed(1)}`);
        } else s.streakChase = 0;
        if (d > def.reach) {
          s.closing++;
          s.streakClose++;
          if (s.streakClose > s.maxClose) s.maxClose = s.streakClose;
          if (s.streakClose === 300) this.log(t, `CLOSING 5s without reaching: ${this.desc(n)} target ${this.desc(tg!)} d=${d.toFixed(1)}`);
        } else s.streakClose = 0;
        // Walking past an enemy in reach to get at his own target.
        if (d > def.reach) {
          let other: Minion | null = null;
          for (const k of sold) if (k.team !== n.team && k !== tg && Math.hypot(k.x - n.x, k.z - n.z) <= def.reach && army.walkLine(n.x, n.z, k.x, k.z)) {
            other = k;
            break;
          }
          if (other) {
            s.passInReach++;
            s.streakPass++;
            if (s.streakPass === 60) this.log(t, `PASS-IN-REACH 1s: ${this.desc(n)} closes on ${this.desc(tg!)} d=${d.toFixed(1)} with ${this.desc(other)} in reach`);
          } else s.streakPass = 0;
        } else s.streakPass = 0;
        // Piling: his target has 3 or more on it while an enemy within his sight has none.
        if ((targeters.get(tg!.id) ?? 0) >= 3) {
          this.pileTotal++;
          for (const k of sold) {
            if (k.team === n.team || (targeters.get(k.id) ?? 0) > 0) continue;
            if (Math.hypot(k.x - n.x, k.z - n.z) <= def.sight && army.walkLine(n.x, n.z, k.x, k.z)) {
              this.pileTicks++;
              if (process.env.DIAG_V && (this.m.tick % 30 === 0)) this.log(t, `PILE ${this.desc(n)} on ${this.desc(tg!)} (${targeters.get(tg!.id)}) while ${this.desc(k)} free`);
              break;
            }
          }
        }
      } else {
        s.streakChase = 0;
        s.streakClose = 0;
      }
      // Resume the march after a fight (marchers only).
      if (n.role === Role.March) {
        const eng = hasT || ed <= 9;
        const cost = army.flow.at(routeField(n.team, n.route), n.x, n.z);
        if (eng) {
          s.engaged = true;
          s.freeAt = -1;
        } else if (s.engaged && s.freeAt < 0) {
          s.freeAt = t;
          s.freeCost = cost;
          s.engaged = false;
        }
        if (s.freeAt >= 0 && cost < s.freeCost - 30) {
          this.resume.push({ id: n.id, team: n.team, ticks: t - s.freeAt });
          s.freeAt = -1;
        }
      }
    }
    // Enemies with a fighter of the other side within 6 m and nobody on them.
    for (const k of sold) {
      if ((targeters.get(k.id) ?? 0) > 0) continue;
      for (const n of sold) if (n.team !== k.team && n.unit !== Unit.Musketeer && n.role !== Role.Gang && Math.hypot(k.x - n.x, k.z - n.z) <= 6 && this.m.army.walkLine(n.x, n.z, k.x, k.z)) {
        this.untargetedNear++;
        if (process.env.DIAG_V && (this.m.tick % 60 === 0)) this.log(t, `UNTARGETED ${this.desc(k)} foe ${this.desc(n)}`);
        break;
      }
    }
  }

  /** The nav cells along a straight line: kind and floor, marking the first impassable step. */
  line(ax: number, az: number, bx: number, bz: number): string {
    const nav = this.m.world.nav;
    const dx = bx - ax, dz = bz - az;
    const steps = Math.ceil(Math.hypot(dx, dz) / 0.5);
    const out: string[] = [];
    let prev = navCell(ax, az);
    out.push(`[${nav.kind[prev]}:${nav.floor[prev].toFixed(2)}]`);
    for (let s = 1; s <= steps; s++) {
      const x = ax + (dx * s) / steps, z = az + (dz * s) / steps;
      const c = navCell(x, z);
      if (c === prev) continue;
      const ok = c >= 0 && nav.passable(prev, c);
      out.push(`${ok ? "" : "X"}(${x.toFixed(1)},${z.toFixed(1)})${nav.kind[c]}:${nav.floor[c].toFixed(2)}`);
      prev = c;
    }
    return out.join(" ");
  }

  /** At the end: men still waiting to resume. */
  finish() {
    const t = this.m.tick;
    const list = this.m.world.minions.list;
    for (const s of this.men.values()) if (s.freeAt >= 0 && list[s.id].state === MinionState.Upright) this.noResume.push({ id: s.id, team: s.team, since: t - s.freeAt });
  }

  summary(label: string): string {
    const out: string[] = [];
    const sec = (x: number) => (x / 60).toFixed(1);
    out.push(`== ${label}: near@${sec(this.firstNear)}s fight@${sec(this.firstFight)}s firstBlow@${sec(this.firstBlow)}s lastBlow@${sec(this.lastBlow)}s clash ${this.firstBlow >= 0 ? sec(this.lastBlow - this.firstBlow) : "-"}s; downs t0 ${this.downs[0]} (blow ${this.downsByBlow[0]}) t1 ${this.downs[1]} (blow ${this.downsByBlow[1]}); blows t0 ${this.blowsByTeam[0]} t1 ${this.blowsByTeam[1]}`);
    for (const team of [0, 1]) {
      const ms = [...this.men.values()].filter((s) => s.team === team && s.unit !== Unit.Mason && s.role0 !== Role.Carrier);
      const engaged = ms.filter((s) => s.near9 > 60);
      const noBlow = engaged.filter((s) => s.blows === 0 && s.batterIdle === 0).length;
      const tot = (f: (s: ManStats) => number) => ms.reduce((a, s) => a + f(s), 0);
      const max = (f: (s: ManStats) => number) => ms.reduce((a, s) => (f(s) > a ? f(s) : a), 0);
      out.push(
        `  team ${team}: ${ms.length} men (${engaged.length} with an enemy within 9 m >1 s, ${noBlow} of them never struck); ` +
          `noTarget<=8m ${sec(tot((s) => s.noTgt8))} man-s (max ${sec(max((s) => s.noTgt8))}), <=6m ${sec(tot((s) => s.noTgt6))}; ` +
          `idle<=4m ${sec(tot((s) => s.idle4))} man-s (max ${sec(max((s) => s.idle4))}); fight ${sec(tot((s) => s.fight))} man-s; blows ${tot((s) => s.blows)}; batter blows ${tot((s) => s.batterIdle)}; ` +
          `wrongFace ${sec(tot((s) => s.wrongFace))}; chaseBlocked ${sec(tot((s) => s.chaseBlocked))}; passInReach ${sec(tot((s) => s.passInReach))} man-s (max ${sec(max((s) => s.passInReach))}); closing ${sec(tot((s) => s.closing))} man-s (longest ${sec(max((s) => s.maxClose))})`,
      );
      const r = this.resume.filter((x) => x.team === team).map((x) => x.ticks).sort((a, b) => a - b);
      const nr = this.noResume.filter((x) => x.team === team);
      if (r.length || nr.length) out.push(`    resume march: ${r.length} men, median ${r.length ? sec(r[r.length >> 1]) : "-"}s, max ${r.length ? sec(r[r.length - 1]) : "-"}s; not resumed by the end: ${nr.length}${nr.length ? " (" + nr.map((x) => `#${x.id} ${sec(x.since)}s`).join(", ") + ")" : ""}`);
    }
    for (const team of [0, 1]) {
      const F = this.focus[team];
      if (F.ticks) out.push(`  focus t${team}: over ${sec(F.ticks)} s with 3+ men on targets, on average ${(F.men / F.ticks).toFixed(1)} men on ${(F.distinct / F.ticks).toFixed(1)} distinct targets, with ${(F.foes / F.ticks).toFixed(1)} enemies within 9 m of them`);
    }
    out.push(`  piling: ${this.pileTicks}/${this.pileTotal} man-ticks on a target with 3+ while a reachable enemy in sight had none; enemy-ticks untargeted with a foe within 6 m: ${sec(this.untargetedNear)} s`);
    return out.join("\n");
  }
}

/** Upright men of a team, by role. */
export function census(m: Match, team: number): string {
  const by = new Map<string, number>();
  for (const n of m.world.minions.list) {
    if (n.team !== team || n.state !== MinionState.Upright || n.wave < 0) continue;
    const k = `${UNITN[n.unit]}/${ROLE[n.role]}:${ACT[n.action] ?? n.action}`;
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  return [...by.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" ");
}
