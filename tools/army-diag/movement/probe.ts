// Movement probe for the army pass (diagnosis only, untracked). Watches every
// upright soldier tick by tick and second by second and counts what a player
// would read as dumb walking: men stuck with nothing to fight, heading
// reversals and jitter, facing flips, crowding and throughput at bridges,
// walking off the route, waves splitting, men falling off decks.
import { BRIDGES, inCourtyard, holdMarker, MID_Z, ROUTE_HALF, ROUTE_NAMES, routeDistance, Unit } from "@keepfall/content";
import { Action, Cause, FLOW_INF, MinionState, NavKind, navCell, NAV_GRID, NAV_STEP, Order, Role, breachField, routeField, type SandboxSim, type Minion } from "@keepfall/sim";

const TICK = 60;
export const STUCK_WIN = 10; // s
const ACTION_NAMES = ["walk", "stand", "fight", "batter", "work", "carry", "climb", "raise", "plant", "aim", "keg", "hoist"];

interface Sample {
  t: number;
  x: number;
  z: number;
  cost: number;
  ok: boolean; // walk/stand only, no target, marching, not holding, not at goal, during the whole second
}

interface Spell {
  id: number;
  team: number;
  unit: number;
  wave: number;
  route: string;
  start: number; // s
  len: number; // s
  x: number;
  z: number;
  where: string;
  why: string;
  cost: number;
}

export interface BridgeLog {
  /** per wave key `${wave}:${bridge}`: entries and exits (ticks) per man */
  enter: Map<string, Map<number, number>>;
  exit: Map<string, Map<number, number>>;
}

export class Probe {
  w: SandboxSim;
  label: string;
  t0: number;
  hist = new Map<number, Sample[]>();
  /** Per man: per-tick flags within the current second. */
  okTick = new Map<number, boolean>();
  /** Per man: ring of positions over the last 60 ticks, and yaws. */
  px = new Map<number, number[]>();
  pz = new Map<number, number[]>();
  yaw = new Map<number, number[]>();
  calm = new Map<number, number[]>(); // 1 when walk/stand and no target that tick
  spells: Spell[] = [];
  open = new Map<number, Spell>();
  // Oscillation.
  manSeconds = 0;
  reversals = 0;
  jitterSecs = 0;
  jitterBy = new Map<string, number>();
  flips = 0;
  flipsBy = new Map<string, number>();
  revBy = new Map<string, number>();
  // Route.
  offRoute = { n: 0, gt0: 0, gt3: 0, gt6: 0, gt10: 0, max: 0, maxAt: "" };
  wrongBridge: string[] = [];
  crossed = new Map<number, number>(); // man -> bridge index crossed (first)
  // Bridges.
  enter = new Map<string, Map<number, number>>();
  exit = new Map<string, Map<number, number>>();
  maxNear = [0, 0, 0];
  // Falls.
  falls: string[] = [];
  prevState = new Map<number, number>();
  // Cut off / stale.
  infSecs = 0;
  staleManSecs = 0;
  marchManSecs = 0;
  topoBumps = 0;
  topoTimes: number[] = [];
  offByU = new Map<string, number>();
  lastTopo = -1;
  staleSecs = 0;
  secs = 0;
  // Waves.
  waveSpread = new Map<number, { t: number; n: number; rms: number; costSpan: number; cx: number; cz: number }[]>();
  log: string[] = [];
  verbose: boolean;

  constructor(w: SandboxSim, label = "", verbose = false) {
    this.w = w;
    this.label = label;
    this.t0 = w.tick;
    this.verbose = verbose;
  }

  get army() {
    return this.w.army!;
  }

  /** The soldiers we judge: upright, in a marching wave (no workers, garrison, gang). */
  soldier(m: Minion): boolean {
    if (m.state !== MinionState.Upright || m.wave < 0) return false;
    if (m.role === Role.Mason || m.role === Role.Carrier || m.role === Role.Garrison || m.role === Role.Gang) return false;
    const crew = (this.army as any).waveCrew as Uint8Array;
    if (crew[m.wave]) return false;
    return true;
  }

  /** Field the man marches on now (as army.marchField), or -1 when holding. */
  marchField(m: Minion): number {
    const a = this.army;
    const order = a.order[m.team];
    const route = routeField(m.team, m.route);
    if (order === Order.Push) {
      const b = breachField(m.team);
      return a.flow.at(b, m.x, m.z) < FLOW_INF ? b : route;
    }
    if (order === Order.Hold) {
      const hz = holdMarker(m.team as 0 | 1, ROUTE_NAMES[m.route]).z;
      const past = m.team === 1 ? m.z - hz : hz - m.z;
      if (past > 1.5) return routeField(1 - m.team, m.route);
      if (past > -0.5) return -1;
    }
    return route;
  }

  /** Calm this tick: walking or standing, nothing to fight, on the march (not holding, not arrived, not climbing, not a busy specialist). */
  calmNow(m: Minion): boolean {
    if (m.action !== Action.Walk && m.action !== Action.Stand) return false;
    if (m.target >= 0) return false;
    if (m.role === Role.Defend) return false;
    if (m.task >= 10 && m.task <= 14) return false; // ladder steps
    if (m.unit === Unit.Ladder) return false; // crew carrying/raising
    if (this.w.specialists?.busy(m)) return false;
    const f = this.marchField(m);
    if (f < 0) return false;
    if (inCourtyard(1 - m.team, m.x, m.z)) return false; // arrived
    return true;
  }

  /** Walking or standing with nothing to fight, holding by order or arrived in the enemy courtyard. */
  looseNow(m: Minion): boolean {
    if (m.action !== Action.Walk && m.action !== Action.Stand) return false;
    if (m.target >= 0 || m.role === Role.Defend || (m.task >= 10 && m.task <= 14) || m.unit === Unit.Ladder) return false;
    if (this.w.specialists?.busy(m)) return false;
    return this.marchField(m) < 0 || inCourtyard(1 - m.team, m.x, m.z);
  }

  where(m: Minion): string {
    const a = this.army;
    const nav = this.w.nav;
    const f = this.marchField(m);
    const cost = f >= 0 ? a.flow.at(f, m.x, m.z) : 0;
    if (cost >= FLOW_INF) return "cutoff";
    if (inCourtyard(m.team, m.x, m.z)) return "own-courtyard";
    for (let k = 0; k < 3; k++) {
      const b = BRIDGES[k];
      if (Math.abs(m.x - b.x) < b.width / 2 + 1 && Math.abs(m.z - b.z) < b.length / 2 + 0.6) return "deck";
      if (Math.abs(m.x - b.x) < b.width / 2 + 4 && Math.abs(m.z - b.z) < b.length / 2 + 5) return "bridge-end";
    }
    const c = navCell(m.x, m.z);
    const myFloor = nav.floor[c];
    let water = 0, wall = 0, rubble = 0, steep = 0;
    for (let dj = -2; dj <= 2; dj++)
      for (let di = -2; di <= 2; di++) {
        const n = c + di + dj * NAV_GRID.nx;
        const k = nav.kind[n];
        if (k === NavKind.Water) water++;
        else if (k === NavKind.Blocked || ((k === NavKind.Raised) && nav.floor[n] - myFloor > NAV_STEP)) wall++;
        else if (k === NavKind.Rubble) rubble++;
        else if (k === NavKind.Steep) steep++;
      }
    let crowd = 0;
    for (const n of this.w.minions.list) {
      if (n === m || n.state !== MinionState.Upright) continue;
      const dx = n.x - m.x, dz = n.z - m.z;
      if (dx * dx + dz * dz < 1.2 * 1.2) crowd++;
    }
    const near = Math.abs(m.z) < 25 || Math.abs(m.z + 150) < 25 ? "castle-" : "";
    if (wall) return near + "masonry";
    if (water) return "bank";
    if (rubble) return "rubble";
    if (steep) return "steep";
    if (crowd >= 2) return near + "crowd";
    return near + "open";
  }

  why(m: Minion): string {
    const a = this.army;
    const f = this.marchField(m);
    if (f < 0) return "holding";
    const out: [number, number] = [0, 0];
    const stale = a.flow.built[f] !== this.w.nav.topo ? "+stale" : "";
    if (!a.flow.dir(f, m.x, m.z, out)) return "nodir" + stale;
    const c = navCell(m.x, m.z);
    const ux = out[0], uz = out[1];
    const ahead = a.canStep(c, m.x + ux * 0.25, m.z + uz * 0.25);
    const sx = a.canStep(c, m.x + ux * 0.25, m.z), sz = a.canStep(c, m.x, m.z + uz * 0.25);
    let crowd = 0;
    for (const n of this.w.minions.list) {
      if (n === m || n.state !== MinionState.Upright) continue;
      const dx = n.x - m.x, dz = n.z - m.z;
      if (dx * dx + dz * dz < 0.95 * 0.95) crowd++;
    }
    if (!ahead && !sx && !sz) return "blocked" + stale;
    if (!ahead) return "slide" + stale + (crowd ? "+crowd" : "");
    if (crowd) return "crowd" + stale;
    return "free" + stale;
  }

  /** Call after every world step. */
  tick() {
    const w = this.w;
    const a = this.army;
    const t = w.tick;
    if (w.nav.topo !== this.lastTopo) {
      if (this.lastTopo >= 0) {
        this.topoBumps++;
        if (this.topoTimes.length < 40) this.topoTimes.push(Math.round(t / 60));
      }
      this.lastTopo = w.nav.topo;
    }
    for (const m of w.minions.list) {
      const was = this.prevState.get(m.id) ?? m.state;
      if (was === MinionState.Upright && m.state !== MinionState.Upright && m.downCause === Cause.Fall) {
        const open = w.bridgesOpen().map((o) => (o ? 1 : 0)).join("");
        this.falls.push(`${(t / 60).toFixed(1)}s man ${m.id} t${m.team} fell at (${m.x.toFixed(1)}, ${m.z.toFixed(1)}) bridges ${open} ${this.where(m)}`);
      }
      this.prevState.set(m.id, m.state);
      if (!this.soldier(m)) continue;
      // Rings.
      let px = this.px.get(m.id), pz = this.pz.get(m.id), yw = this.yaw.get(m.id), cl = this.calm.get(m.id);
      if (!px) {
        this.px.set(m.id, (px = []));
        this.pz.set(m.id, (pz = []));
        this.yaw.set(m.id, (yw = []));
        this.calm.set(m.id, (cl = []));
      }
      const calm = this.calmNow(m);
      px.push(m.x);
      pz!.push(m.z);
      yw!.push(m.yaw);
      cl!.push(calm ? 1 : this.looseNow(m) ? 2 : 0);
      if (px.length > TICK + 1) {
        px.shift();
        pz!.shift();
        yw!.shift();
        cl!.shift();
      }
      const okSoFar = this.okTick.get(m.id);
      this.okTick.set(m.id, (okSoFar === undefined ? true : okSoFar) && calm);
      // Bridge crossings (by the deck's ends, either way).
      for (let k = 0; k < 3; k++) {
        const b = BRIDGES[k];
        if (Math.abs(m.x - b.x) > b.width / 2 + 3) continue;
        const z0 = b.z - b.length / 2, z1 = b.z + b.length / 2;
        const entryZ = m.team === 1 ? z0 : z1, exitZ = m.team === 1 ? z1 : z0;
        const past = (zz: number) => (m.team === 1 ? m.z >= zz : m.z <= zz);
        const key = `${m.wave}:${k}`;
        let en = this.enter.get(key), ex = this.exit.get(key);
        if (!en) {
          this.enter.set(key, (en = new Map()));
          this.exit.set(key, (ex = new Map()));
        }
        if (past(entryZ) && !en.has(m.id) && !past(exitZ)) en.set(m.id, t);
        if (past(exitZ) && en.has(m.id) && !ex!.has(m.id)) {
          ex!.set(m.id, t);
          if (!this.crossed.has(m.id)) {
            this.crossed.set(m.id, k);
            const route = ROUTE_NAMES[m.route];
            if (b.name !== route) this.wrongBridge.push(`${(t / 60).toFixed(1)}s man ${m.id} wave ${m.wave} route ${route} crossed ${b.name}`);
          }
        }
      }
    }
    // Bridge approach density: men within 6 m of either end of a deck.
    for (let k = 0; k < 3; k++) {
      const b = BRIDGES[k];
      let n = 0;
      for (const m of w.minions.list) {
        if (m.state !== MinionState.Upright || m.wave < 0) continue;
        if (Math.abs(m.x - b.x) < b.width / 2 + 4 && Math.abs(m.z - b.z) < b.length / 2 + 6) n++;
      }
      if (n > this.maxNear[k]) this.maxNear[k] = n;
    }
    // Every quarter second: heading reversals.
    if ((t - this.t0) % 15 === 0) {
      for (const m of w.minions.list) {
        if (!this.soldier(m)) continue;
        const px = this.px.get(m.id)!, pz = this.pz.get(m.id)!, cl = this.calm.get(m.id)!;
        const L = px.length;
        if (L < 31) continue;
        let calm = true, loose = false;
        for (let k = L - 31; k < L; k++) {
          if (!cl[k]) calm = false;
          if (cl[k] === 2) loose = true;
        }
        if (!calm) continue;
        const ax = px[L - 16] - px[L - 31], az = pz[L - 16] - pz[L - 31];
        const bx = px[L - 1] - px[L - 16], bz = pz[L - 1] - pz[L - 16];
        const la = Math.sqrt(ax * ax + az * az), lb = Math.sqrt(bx * bx + bz * bz);
        if (la > 0.06 && lb > 0.06 && ax * bx + az * bz < 0) {
          this.reversals++;
          const k = (loose ? "hold:" : "") + this.where(m);
          this.revBy.set(k, (this.revBy.get(k) ?? 0) + 1);
        }
      }
    }
    if ((t - this.t0) % TICK !== TICK - 1) return;
    // Once a second.
    this.secs++;
    if (a.flow.stale) this.staleSecs++;
    const counts = new Map<number, Minion[]>();
    for (const m of w.minions.list) {
      if (!this.soldier(m)) {
        this.okTick.delete(m.id);
        if (m.state !== MinionState.Upright) this.closeSpell(m.id);
        continue;
      }
      let g = counts.get(m.wave);
      if (!g) counts.set(m.wave, (g = []));
      g.push(m);
      const f = this.marchField(m);
      const cost = f >= 0 ? a.flow.at(f, m.x, m.z) : 0;
      const ok = this.okTick.get(m.id) ?? false;
      this.okTick.delete(m.id);
      let h = this.hist.get(m.id);
      if (!h) this.hist.set(m.id, (h = []));
      h.push({ t: t / 60, x: m.x, z: m.z, cost, ok });
      if (h.length > 120) h.shift();
      if (ok) {
        this.marchManSecs++;
        if (cost >= FLOW_INF) this.infSecs++;
        if (f >= 0 && a.flow.built[f] !== w.nav.topo) this.staleManSecs++;
      }
      // Route distance (marching on the route field, in the routed stretch).
      if (ok && f === routeField(m.team, m.route) && Math.abs(m.z - MID_Z) < 56) {
        const name = ROUTE_NAMES[m.route];
        const off = routeDistance(name, m.x, m.z) - ROUTE_HALF[name];
        const o = this.offRoute;
        o.n++;
        if (off > 0) o.gt0++;
        if (off > 3) {
          o.gt3++;
          const u = m.z - MID_Z;
          const key = `${name}:u${Math.floor(u / 10) * 10}`;
          this.offByU.set(key, (this.offByU.get(key) ?? 0) + 1);
        }
        if (off > 6) o.gt6++;
        if (off > 10) o.gt10++;
        if (off > o.max) {
          o.max = off;
          o.maxAt = `${(t / 60).toFixed(0)}s man ${m.id} ${name} at (${m.x.toFixed(1)}, ${m.z.toFixed(1)})`;
        }
      }
      // Jitter and facing flips over the last second (calm all the way).
      const px = this.px.get(m.id)!, pz = this.pz.get(m.id)!, yw = this.yaw.get(m.id)!, cl = this.calm.get(m.id)!;
      if (px.length === TICK + 1 && cl.every((v) => v >= 1)) {
        const loose = cl.some((v) => v === 2);
        this.manSeconds++;
        let path = 0;
        for (let k = 1; k < px.length; k++) path += Math.hypot(px[k] - px[k - 1], pz[k] - pz[k - 1]);
        const net = Math.hypot(px[px.length - 1] - px[0], pz[pz.length - 1] - pz[0]);
        if (path > 0.4 && net < 0.3 * path) {
          this.jitterSecs++;
          const k = (loose ? "hold:" : "") + this.where(m);
          this.jitterBy.set(k, (this.jitterBy.get(k) ?? 0) + 1);
        }
        // Largest yaw swing within the second.
        let lo = 0, hi = 0, acc = 0;
        for (let k = 1; k < yw.length; k++) {
          let d = yw[k] - yw[k - 1];
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          acc += d;
          if (acc < lo) lo = acc;
          if (acc > hi) hi = acc;
        }
        if (hi - lo > Math.PI / 2) {
          this.flips++;
          const k = (loose ? "hold:" : "") + this.where(m);
          this.flipsBy.set(k, (this.flipsBy.get(k) ?? 0) + 1);
        }
      }
      // Stuck: STUCK_WIN seconds calm with under 1 m moved and no fall in cost.
      const n = h.length;
      let stuck = false;
      if (n > STUCK_WIN) {
        const s0 = h[n - 1 - STUCK_WIN];
        let all = true;
        for (let k = n - STUCK_WIN; k < n; k++) if (!h[k].ok) all = false;
        const moved = Math.hypot(m.x - s0.x, m.z - s0.z);
        stuck = all && moved < 1 && !(cost < s0.cost - 10);
      }
      const sp = this.open.get(m.id);
      if (stuck && !sp) {
        const s: Spell = { id: m.id, team: m.team, unit: m.unit, wave: m.wave, route: ROUTE_NAMES[m.route], start: t / 60 - STUCK_WIN, len: STUCK_WIN, x: m.x, z: m.z, where: this.where(m), why: this.why(m), cost };
        this.open.set(m.id, s);
        this.spells.push(s);
        if (this.verbose && s.where === "cutoff" && this.details < 8) this.detail(m);
      } else if (stuck && sp) sp.len = t / 60 - sp.start;
      else if (!stuck && sp) this.open.delete(m.id);
    }
    // Waves.
    for (const [wave, g] of counts) {
      let cx = 0, cz = 0, cmin = Infinity, cmax = -Infinity;
      for (const m of g) {
        cx += m.x;
        cz += m.z;
        const c = a.flow.at(routeField(m.team, m.route), m.x, m.z);
        if (c < FLOW_INF) {
          if (c < cmin) cmin = c;
          if (c > cmax) cmax = c;
        }
      }
      cx /= g.length;
      cz /= g.length;
      let r2 = 0;
      for (const m of g) r2 += (m.x - cx) ** 2 + (m.z - cz) ** 2;
      let arr = this.waveSpread.get(wave);
      if (!arr) this.waveSpread.set(wave, (arr = []));
      arr.push({ t: t / 60, n: g.length, rms: Math.sqrt(r2 / g.length), costSpan: cmax > cmin ? (cmax - cmin) / 10 : 0, cx, cz });
    }
  }

  details = 0;
  lastDetail = -1e9;
  /** Print the nav grid around a cut-off man: kinds (G ground, R raised, W water, S steep, B blocked, # rubble), floors, the island he stands on. */
  detail(m: Minion) {
    const t = this.w.tick;
    if (t - this.lastDetail < 600) return;
    this.lastDetail = t;
    this.details++;
    const nav = this.w.nav, a = this.army;
    const out = new Uint8Array(nav.kind.length);
    const c0 = navCell(m.x, m.z);
    const island = nav.reach(c0, out);
    const f = this.marchField(m);
    const K = "GRWSB#";
    const L: string[] = [];
    L.push(`DETAIL ${(t / 60).toFixed(0)}s man ${m.id} t${m.team} at (${m.x.toFixed(1)}, ${m.z.toFixed(1)}) y ${m.y.toFixed(2)} cell kind ${K[nav.kind[c0]]} floor ${nav.floor[c0].toFixed(2)} ground ${nav.groundFloor(c0).toFixed(2)}; island ${island} cells; field ${f} built ${a.flow.built[f]} topo ${nav.topo}; order ${a.order[m.team]}`);
    const reachableGoal = (ff: number) => {
      let n = 0;
      const d = a.flow.dist[ff];
      for (let k = 0; k < d.length; k++) if (d[k] < FLOW_INF) n++;
      return n;
    };
    L.push(`  cells with a finite cost: route field ${reachableGoal(routeField(m.team, m.route))}, breach field ${reachableGoal(breachField(m.team))}; island cells with finite route cost: ${(() => { let n = 0; const d = a.flow.dist[routeField(m.team, m.route)]; for (let k = 0; k < d.length; k++) if (out[k] && d[k] < FLOW_INF) n++; return n; })()}`);
    const ci = c0 % NAV_GRID.nx, cj = (c0 - ci) / NAV_GRID.nx;
    for (let dj = 7; dj >= -7; dj--) {
      let row = "", fl = "";
      for (let di = -10; di <= 10; di++) {
        const c = (cj + dj) * NAV_GRID.nx + ci + di;
        const ch = K[nav.kind[c]];
        row += di === 0 && dj === 0 ? ch.toLowerCase() : out[c] ? ch : ch === "G" ? "." : ch;
        if (Math.abs(di) <= 3) fl += nav.floor[c].toFixed(1).padStart(5);
      }
      L.push(`  z ${(NAV_GRID.z0 + cj + dj).toString().padStart(4)} ${row}  ${fl}`);
    }
    L.push(`  (columns x ${NAV_GRID.x0 + ci - 10}..${NAV_GRID.x0 + ci + 10}; '.' ground not on his island; lower case: him)`);
    // The enemy gate: kinds, floors, costs (castle 0's gate at z -16, castle 1's at z -135; outside first).
    const foe = 1 - m.team, gz = foe === 0 ? -16 : -135, dir = foe === 0 ? 1 : -1;
    const d = a.flow.dist[routeField(m.team, m.route)];
    L.push(`  enemy gate (castle ${foe}), rows from outside in, x -6..5: kind floor cost`);
    for (let k = -4; k <= 5; k++) {
      const z = gz + dir * k;
      let row = "";
      for (let x = -6; x <= 5; x++) {
        const c = navCell(x + 0.5, z + 0.5);
        row += ` ${K[nav.kind[c]]}${nav.floor[c].toFixed(1).padStart(5)}${d[c] >= FLOW_INF ? "   inf" : String(d[c]).padStart(6)}`;
      }
      L.push(`    z ${z}${row}`);
    }
    const leaves = this.w.castle.layout.stones.filter((st) => st.castle === foe && st.part === "gate").map((st) => `${st.id}:${this.w.castle.dynamic[st.id] ? "loose" : "stands"}${this.w.castle.frozen[st.id] ? "/settled" : ""}`);
    L.push(`  gate leaves ${leaves.join(" ")}`);
    const settled = (nav as any).settled as Map<number, { cells: number[]; bottom: number; top: number }>;
    for (const st of this.w.castle.layout.stones) {
      if (st.castle !== foe || st.part !== "gate") continue;
      const b = this.w.castle.bodies[st.id];
      const tr = b.translation(), ro = b.rotation();
      const f = settled.get(st.id);
      L.push(`  leaf ${st.id} half ${st.hx.toFixed(2)},${st.hy.toFixed(2)},${st.hz.toFixed(2)} at (${tr.x.toFixed(2)}, ${tr.y.toFixed(2)}, ${tr.z.toFixed(2)}) quat (${ro.x.toFixed(2)}, ${ro.y.toFixed(2)}, ${ro.z.toFixed(2)}, ${ro.w.toFixed(2)}); indexed as rubble ${f ? `y ${f.bottom.toFixed(2)}..${f.top.toFixed(2)} over ${f.cells.length} cells` : "no"}`);
    }
    // Every settled piece indexed in the gateway cells (x -2..1 at the gate row).
    const at = (nav as any).settledAt as Map<number, number[]>;
    for (let x = -2; x <= 1; x++) {
      const c = navCell(x + 0.5, gz + 0.5);
      const ids = at.get(c) ?? [];
      L.push(`  gateway cell x ${x}: ${K[nav.kind[c]]} floor ${nav.floor[c].toFixed(2)}; settled here: ${ids.map((id) => { const f = settled.get(id)!; return `${id < this.w.castle.layout.stones.length ? this.w.castle.layout.stones[id].part : "body"}#${id} y ${f.bottom.toFixed(1)}..${f.top.toFixed(1)}`; }).join(", ")}`);
    }
    console.log(L.join("\n"));
  }

  closeSpell(id: number) {
    this.open.delete(id);
  }

  bridgeReport(): string[] {
    const out: string[] = [];
    for (const [key, en] of this.enter) {
      const ex = this.exit.get(key)!;
      if (!ex.size) continue;
      const [wave, k] = key.split(":").map(Number);
      let first = Infinity, last = -Infinity, sum = 0, max = 0;
      for (const [id, te] of en) {
        const tx = ex.get(id);
        if (tx === undefined) continue;
        if (te < first) first = te;
        if (tx > last) last = tx;
        sum += tx - te;
        if (tx - te > max) max = tx - te;
      }
      const n = ex.size;
      const L = BRIDGES[k].length;
      out.push(`wave ${wave} over ${BRIDGES[k].name} bridge (${L.toFixed(1)} m): ${n} crossed (${en.size} stepped on), first on ${(first / 60).toFixed(1)}s, last off ${(last / 60).toFixed(1)}s, ${(n / ((last - first) / 60)).toFixed(2)} men/s, transit mean ${(sum / n / 60).toFixed(1)}s max ${(max / 60).toFixed(1)}s (free walk ${(L / 1.6).toFixed(1)}s)`);
    }
    return out;
  }

  report(): string {
    const L: string[] = [];
    const p = (s: string) => L.push(s);
    p(`== ${this.label}: ${this.secs} s observed`);
    const byWhere = new Map<string, { n: number; secs: number; long: number }>();
    for (const s of this.spells) {
      const k = `${s.where} / ${s.why}`;
      const e = byWhere.get(k) ?? { n: 0, secs: 0, long: 0 };
      e.n++;
      e.secs += s.len;
      if (s.len >= 20) e.long++;
      byWhere.set(k, e);
    }
    const total = this.spells.reduce((a, s) => a + s.len, 0);
    p(`stuck spells (>= ${STUCK_WIN} s calm, < 1 m moved, cost not falling): ${this.spells.length} spells, ${this.spells.filter((s) => s.len >= 20).length} of 20 s+, ${total.toFixed(0)} man-s stuck of ${this.marchManSecs} calm marching man-s`);
    for (const [k, e] of [...byWhere].sort((a, b) => b[1].secs - a[1].secs)) p(`  ${k}: ${e.n} spells, ${e.secs.toFixed(0)} man-s, ${e.long} of 20 s+`);
    const longest = [...this.spells].sort((a, b) => b.len - a.len).slice(0, 12);
    for (const s of longest) p(`  - man ${s.id} t${s.team} unit ${s.unit} wave ${s.wave} ${s.route}: from ${s.start.toFixed(0)}s for ${s.len.toFixed(0)}s at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) ${s.where} / ${s.why} cost ${s.cost >= FLOW_INF ? "INF" : s.cost}`);
    p(`cut off (cost INF) calm man-s: ${this.infSecs}; on a stale field: ${this.staleManSecs} man-s; fields stale ${this.staleSecs}/${this.secs} s; topo bumps ${this.topoBumps}`);
    const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : "0") + "%";
    p(`heading reversals (0.25 s legs, calm): ${this.reversals} in ${this.manSeconds} calm man-s (${(this.reversals / Math.max(1, this.manSeconds)).toFixed(3)}/man-s) by place ${JSON.stringify(Object.fromEntries(this.revBy))}`);
    p(`jitter seconds (path > 0.4 m, net < 30%): ${this.jitterSecs} (${pct(this.jitterSecs, this.manSeconds)}) by place ${JSON.stringify(Object.fromEntries(this.jitterBy))}`);
    p(`facing swings > 90 deg within 1 s (calm): ${this.flips} (${pct(this.flips, this.manSeconds)}) by place ${JSON.stringify(Object.fromEntries(this.flipsBy))}`);
    const o = this.offRoute;
    p(`off route (beyond the worn half width, |u| < 56): ${pct(o.gt0, o.n)} of ${o.n} man-s; > 3 m ${pct(o.gt3, o.n)}; > 6 m ${pct(o.gt6, o.n)}; > 10 m ${pct(o.gt10, o.n)}; max ${o.max.toFixed(1)} m (${o.maxAt})`);
    p(`  off > 3 m by road and u (10 m bins, u = z - MID_Z, team 1 marches +u): ${JSON.stringify(Object.fromEntries([...this.offByU].sort()))}`);
    p(`topo bump times (s): ${this.topoTimes.join(",")}`);
    p(`wrong bridge: ${this.wrongBridge.length}${this.wrongBridge.length ? ": " + this.wrongBridge.slice(0, 6).join("; ") : ""}`);
    p(`max men near a bridge (within 6 m of the deck) right/centre/left: ${this.maxNear.join("/")}`);
    for (const s of this.bridgeReport()) p("  " + s);
    p(`falls (floor gone): ${this.falls.length}${this.falls.length ? "\n    " + this.falls.slice(0, 12).join("\n    ") : ""}`);
    for (const [wave, arr] of this.waveSpread) {
      if (arr.length < 5) continue;
      const maxR = arr.reduce((m, s) => (s.rms > m.rms ? s : m), arr[0]);
      const maxC = arr.reduce((m, s) => (s.costSpan > m.costSpan ? s : m), arr[0]);
      const pts = arr.filter((_, i) => i % 10 === 0).map((s) => `${s.t.toFixed(0)}s:${s.n}m r${s.rms.toFixed(1)} span${s.costSpan.toFixed(0)}`);
      p(`wave ${wave}: max rms ${maxR.rms.toFixed(1)} m at ${maxR.t.toFixed(0)}s; max length along route ${maxC.costSpan.toFixed(0)} m at ${maxC.t.toFixed(0)}s (${pts.join(" ")})`);
    }
    return L.join("\n");
  }
}

export const actionName = (a: number) => ACTION_NAMES[a] ?? String(a);
