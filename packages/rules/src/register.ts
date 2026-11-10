// Range and register (phase 3 milestone 3.2): each team's marks and its fire
// for effect. CONTRACT (the master's): the types and the public surface below
// are fixed; the executor building the rules fills in the behaviour.
//
// - A mark is made by the input { kind: "mark", emplacement } within
//   REGISTER.window ticks after a shot fired by hand from that emplacement of
//   the team came down (the world's `landings`, auto false). It is the landing
//   point with REGISTER.radius. A team holds REGISTER.max marks in numbered
//   places 1 to 6: a new mark takes the lowest free place, or the oldest
//   mark's place. A mark fades REGISTER.life ticks after it was made; a shot
//   by hand of the team landing inside it refreshes it.
// - Fire for effect: { kind: "salvo", mark, mortar? } (mark 1 to 6). Every gun
//   of the team that is armed, loaded, standing (mounts.up) and can reach the
//   mark without hitting its own castle (solveAim, clearOfCastle) fires one
//   shot at it with the error of a gun nobody mans times REGISTER.errScale
//   (drawn from the register's own Rng stream "register"), one after another
//   over REGISTER.salvoSpan ticks from the gun nearest the mark outwards. The
//   mortar joins only when `mortar` is true. One salvo per team every
//   REGISTER.salvoEvery ticks; a salvo at a mark with no gun to fire is
//   refused and does not start the 20 s.
// - Marks are the team's alone: the match never tells the other side (the
//   page shows only its own team's).
//
// The Practice range uses the same class on its SandboxSim (one team, its four
// guns), so nothing here may depend on Match.

import { REGISTER } from "@keepfall/content";
import type { Emplacement } from "@keepfall/content";
import type { SandboxSim } from "@keepfall/sim";

export interface Mark {
  /** Its place, 1 to 6 (what the page shows and a salvo names). */
  n: number;
  /** The landing point. */
  x: number;
  y: number;
  z: number;
  /** The emplacement whose shot made it. */
  emplacement: number;
  /** Tick it was made (the oldest is replaced first), and tick it fades (refreshed by a shot landing inside). */
  made: number;
  fades: number;
}

/** A team's last shot by hand that came down, per emplacement: where and when (for marking within the window). */
export interface Landing {
  x: number;
  y: number;
  z: number;
  tick: number;
}

/** A shot of a salvo waiting for its tick. */
export interface SalvoShot {
  tick: number;
  team: number;
  emplacement: number;
  mark: number;
}

export interface RegisterHost {
  world: SandboxSim;
  emplacements: Emplacement[];
  /** The team an emplacement belongs to (-1: none). */
  owner(emplacement: number): number;
  /** The emplacement each team rides now (-1: none). */
  manned(team: number): number;
  /** Reloads as a share of each weapon's own now (sudden death). */
  reloadScale(): number;
}

export class Register {
  /** Per team, places 1 to 6 (index n - 1): a mark or null. */
  readonly marks: [Array<Mark | null>, Array<Mark | null>] = [new Array(REGISTER.max).fill(null), new Array(REGISTER.max).fill(null)];
  /** Per emplacement: its last shot by hand that came down (null: none yet). */
  readonly landings: Array<Landing | null>;
  /** Per team: the tick of its last salvo (-1e9: none). */
  readonly salvoAt: [number, number] = [-1e9, -1e9];
  /** Salvo shots waiting for their tick, in the order they fire. */
  readonly queued: SalvoShot[] = [];

  constructor(
    protected host: RegisterHost,
    seed: number,
  ) {
    this.landings = host.emplacements.map(() => null);
    void seed;
  }

  /** The team's mark at place n (1 to 6), or null. */
  mark(team: number, n: number): Mark | null {
    return this.marks[team]?.[n - 1] ?? null;
  }

  /** The team's marks that stand, oldest first. */
  list(team: number): Mark[] {
    return this.marks[team].filter((m): m is Mark => m !== null).sort((a, b) => a.made - b.made || a.n - b.n);
  }

  /** May the team mark the last landing of this emplacement now (its own gun, a shot by hand, within the window)? */
  canMark(team: number, emplacement: number, tick: number): boolean {
    void team;
    void emplacement;
    void tick;
    return false;
  }

  /** The input { kind: "mark" }: make the mark (true) or refuse it (false). */
  makeMark(team: number, emplacement: number, tick: number): boolean {
    void team;
    void emplacement;
    void tick;
    return false;
  }

  /** The guns of the team that would fire in a salvo at mark n now, nearest first (empty: none bears, or no such mark). */
  bearing(team: number, n: number, mortar: boolean): number[] {
    void team;
    void n;
    void mortar;
    return [];
  }

  /** The input { kind: "salvo" }: queue it (true) or refuse it (false). */
  salvo(team: number, n: number, mortar: boolean, tick: number): boolean {
    void team;
    void n;
    void mortar;
    void tick;
    return false;
  }

  /** Is a point inside one of the team's marks? (Guns nobody mans read this when they lay on a man.) */
  onMark(team: number, x: number, z: number): boolean {
    void team;
    void x;
    void z;
    return false;
  }

  /** Before the world steps: fade marks, fire the salvo shots due this tick (queued into the world). */
  beforeStep(tick: number) {
    void tick;
  }

  /** After the world steps: read its landings (remember shots by hand, refresh marks they land in). */
  afterStep(tick: number) {
    void tick;
  }

  /** Everything above, into the match's hash. */
  hashInto(out: number[]) {
    void out;
  }
}
