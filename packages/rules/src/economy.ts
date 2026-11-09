// Gold (phase 2 M3): what each team earns besides spending it. Income comes
// in through one function (the keep and the working Powder Mills; M4's sudden
// death doubles it there). After every world step the match hands this the
// world's records: every minion knocked down pays its killer's side a bounty;
// enemy masonry brought down pays a gold for every few pieces; and shots a
// gunner fired himself can pay trick-shot bonuses (a ricochet kill, a
// collapse kill, a multi-kill, a keep hit). Every earning is listed for the
// page, with where it happened, so the gold can be seen coming in.
//
// Deterministic: integer gold (fractions are carried in accumulators of
// exactly representable steps), records read in the order the world wrote
// them, shot tallies closed in id order.

import { BUILDINGS, Earn, GOLD, isKeepPiece, MATCH, type CastleLayout } from "@keepfall/content";
import { Cause, type SandboxSim } from "@keepfall/sim";

export interface Earning {
  team: number;
  amount: number;
  kind: Earn;
  /** Where it happened (for the page's rising numbers). */
  x: number;
  y: number;
  z: number;
}

interface Tally {
  team: number;
  /** Knockdowns that make it a multi-kill for the gun that fired it. */
  min: number;
  kills: number;
  last: number;
  x: number;
  y: number;
  z: number;
}

export class Economy {
  /** Gold each team earned in all (income included) and spent. */
  readonly earned: [number, number] = [0, 0];
  readonly spent: [number, number] = [0, 0];
  /** Trick shots each team has made, by kind (Earn.Ricochet .. Earn.KeepHit). */
  readonly tricks: [number[], number[]] = [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]];
  /** After M5: enemy guns each team has knocked out. */
  readonly silenced: [number, number] = [0, 0];
  /** Earnings since the page last looked (the worker drains it). */
  feed: Earning[] = [];
  private incomeAcc: [number, number] = [0, 0];
  private masonryAcc: [number, number] = [0, 0];
  /** Open multi-kill tallies per shot id (manned shots only). */
  private tallies = new Map<number, Tally>();
  private layout: CastleLayout;

  constructor(
    private world: SandboxSim,
    private gold: [number, number],
    /** The team an emplacement belongs to. */
    private teamOfEmp: (emp: number) => number,
  ) {
    this.layout = world.castle.layout;
    world.minions.recordDowns = true;
    world.castle.recordFalls = true;
  }

  /**
   * Gold a second a team earns as income now: its keep, and each Powder Mill
   * of its that works. The one place income is worked out (sudden death
   * doubles it here after the merge with M4).
   */
  incomeRate(mills: number): number {
    return MATCH.keepIncome + mills * BUILDINGS.mill.income;
  }

  /** One income tick (every MATCH.incomeEvery ticks): a second's income, whole gold paid, the fraction carried. */
  payIncome(team: number, rate: number) {
    this.incomeAcc[team] += rate;
    const whole = Math.floor(this.incomeAcc[team]);
    this.incomeAcc[team] -= whole;
    if (whole > 0) this.earn(team, whole, Earn.Income, 0, -1000, 0);
  }

  /** Spend gold if there is enough. */
  pay(team: number, cost: number): boolean {
    if (cost < 0 || this.gold[team] < cost) return false;
    this.gold[team] -= cost;
    this.spent[team] += cost;
    return true;
  }

  earn(team: number, amount: number, kind: Earn, x: number, y: number, z: number) {
    if (amount <= 0) return;
    this.gold[team] += amount;
    this.earned[team] += amount;
    if (kind >= Earn.Ricochet && kind <= Earn.KeepHit) this.tricks[team][kind]++;
    this.feed.push({ team, amount, kind, x, y, z });
  }

  /** After the world's step: bounties, masonry and trick shots from what it recorded this tick. */
  step(tick: number) {
    const w = this.world;
    const G = GOLD, T = GOLD.trick;
    // Knockdowns: [minion, cause, shot, stone].
    const downs = w.minions.downs;
    for (let k = 0; k + 3 < downs.length; k += 4) {
      const m = w.minions.list[downs[k]];
      if (!m || m.wave < 0) continue;
      const cause = downs[k + 1], shot = downs[k + 2], stone = downs[k + 3];
      const team = 1 - m.team;
      const y = m.y + 1.6;
      this.earn(team, G.bounty, Earn.Bounty, m.x, y, m.z);
      if ((cause === Cause.Ball || cause === Cause.Burst) && shot >= 0) {
        const info = w.shotInfo.get(shot);
        if (!info || info.auto || this.teamOfEmp(info.emplacement) !== team) continue;
        if (cause === Cause.Ball && info.glanced) this.earn(team, T.ricochet, Earn.Ricochet, m.x, y, m.z);
        let t = this.tallies.get(shot);
        if (!t) {
          const gun = w.emplacements[info.emplacement];
          t = { team, min: gun && !gun.empty ? T.multiMin[gun.weapon] : T.multiMin.longGun, kills: 0, last: tick, x: m.x, y, z: m.z };
          this.tallies.set(shot, t);
        }
        t.kills++;
        t.last = tick;
      } else if (cause === Cause.Masonry && stone >= 0) {
        // His own castle's masonry, brought down on him by the other side.
        const s = this.layout.stones[stone];
        if (s && s.castle === m.team) this.earn(team, T.collapse, Earn.Collapse, m.x, y, m.z);
      }
    }
    downs.length = 0;
    // Multi-kills: a shot's tally closes a moment after its last knockdown.
    if (this.tallies.size) {
      const ids = [...this.tallies.keys()].sort((a, b) => a - b);
      for (const id of ids) {
        const t = this.tallies.get(id)!;
        if (tick - t.last < T.multiWait) continue;
        this.tallies.delete(id);
        if (t.kills >= t.min) this.earn(t.team, t.kills * T.multiPer, Earn.MultiKill, t.x, t.y + 1, t.z);
      }
    }
    // Masonry brought down: each castle's pays the other side.
    const fell = w.castle.fell;
    if (fell.length) {
      const sx = [0, 0], sy = [0, 0], sz = [0, 0], n = [0, 0];
      for (const id of fell) {
        const s = this.layout.stones[id];
        if (s.castle > 1) continue;
        const team = 1 - s.castle;
        this.masonryAcc[team] += isKeepPiece(s) ? G.keepWeight : 1;
        sx[team] += s.x;
        sy[team] += s.y;
        sz[team] += s.z;
        n[team]++;
      }
      fell.length = 0;
      for (const team of [0, 1]) {
        const whole = Math.floor(this.masonryAcc[team] / G.masonryPer);
        if (whole <= 0) continue;
        this.masonryAcc[team] -= whole * G.masonryPer;
        const c = n[team] || 1;
        this.earn(team, whole, Earn.Masonry, sx[team] / c, sy[team] / c + 1.5, sz[team] / c);
      }
    }
    // Keep hits: [shot, castle].
    const hits = w.keepHits;
    for (let k = 0; k + 1 < hits.length; k += 2) {
      const info = w.shotInfo.get(hits[k]);
      const team = 1 - hits[k + 1];
      if (!info || info.auto || this.teamOfEmp(info.emplacement) !== team) continue;
      const kz = this.layout.castleZ[hits[k + 1]];
      this.earn(team, T.keep, Earn.KeepHit, 0, 21, kz + (hits[k + 1] === 0 ? 4 : -4));
    }
    hits.length = 0;
    // After M5: an enemy gun knocked out pays its silencer's side, whatever did it (as masonry does).
    const outs = w.mounts.outs;
    for (let k = 0; k + 2 < outs.length; k += 3) {
      const e = w.emplacements[outs[k]];
      const owner = this.teamOfEmp(outs[k]);
      if (!e || owner < 0) continue;
      this.silenced[1 - owner]++;
      this.earn(1 - owner, G.silenced, Earn.Silenced, e.x, e.y + 1.5, e.z);
    }
  }

  hashInto(out: number[]) {
    out.push(this.earned[0], this.earned[1], this.spent[0], this.spent[1], this.incomeAcc[0], this.incomeAcc[1], this.masonryAcc[0], this.masonryAcc[1], this.silenced[0], this.silenced[1]);
    for (const id of [...this.tallies.keys()].sort((a, b) => a - b)) {
      const t = this.tallies.get(id)!;
      out.push(id, t.team, t.kills, t.last);
    }
  }
}
