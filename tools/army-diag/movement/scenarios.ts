// Scripted movement scenarios in the sandbox (no guns, no garrison, no AI).
// npx rolldown tools/army-diag/movement/scenarios.ts --format esm --platform node -o node_modules/.scratch/diag-move-sc.mjs && node node_modules/.scratch/diag-move-sc.mjs sc=solo seed=7
// sc: solo | stack | meet | hold | push | blow-before | blow-deck | blow-crossed | all
import RD from "@dimforge/rapier3d-deterministic-compat";
import { BRIDGES, buildLayout, DECK_TOP, GAME_LAYOUT, MATCH_EMPLACEMENTS, ROUTE_NAMES } from "@keepfall/content";
import { Action, FLOW_INF, MinionState, Order, routeField, SandboxSim, type Rapier } from "@keepfall/sim";
import { Probe } from "./probe";

await RD.init();
const R = RD as unknown as Rapier;
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;
const seed = Number(arg("seed", "7"));
const which = arg("sc", "all");
const layout = buildLayout(1, GAME_LAYOUT);
const LEFT = 0, CENTRE = 1, RIGHT = 2;
const PIKES = [0, 0, 0, 0, 0, 0, 0, 0];

function world() {
  return new SandboxSim(R, layout, { seed, minions: 0, army: true, powder: false, emplacements: MATCH_EMPLACEMENTS });
}
function run(w: SandboxSim, p: Probe, secs: number, each?: (t: number) => void) {
  for (let i = 0; i < secs * 60; i++) {
    each?.(w.tick);
    w.step();
    p.tick();
  }
}
const up = (w: SandboxSim, team: number) => w.minions.list.filter((m) => m.team === team && m.state === MinionState.Upright && m.wave >= 0);

const scenarios: Record<string, () => void> = {
  // Three waves at once from team 1, one down each road, side by side as a match sends them (offsets 0, -5.5, +5.5). Unopposed.
  solo() {
    const w = world();
    const p = new Probe(w, `solo seed ${seed}: team 1, one pikemen wave per road, unopposed, 110 s`);
    w.army!.spawnMix(1, CENTRE, PIKES, 0);
    w.army!.spawnMix(1, LEFT, PIKES, -5.5);
    w.army!.spawnMix(1, RIGHT, PIKES, 5.5);
    run(w, p, 110);
    console.log(p.report());
    w.free();
  },
  // A barracks timer's worth: three pikemen waves on the centre road, two at once (two barracks side by side) then one 12 s later.
  stack() {
    const w = world();
    const p = new Probe(w, `stack seed ${seed}: team 1, 2 waves at once + 1 after 12 s, all centre, unopposed, 110 s`);
    w.army!.spawnMix(1, CENTRE, PIKES, 0);
    w.army!.spawnMix(1, CENTRE, PIKES, -5.5);
    run(w, p, 110, (t) => {
      if (t === 12 * 60) w.army!.spawnMix(1, CENTRE, PIKES, 0);
    });
    console.log(p.report());
    w.free();
  },
  // Two waves meet on the centre road (both sides 8 + 8 a little later).
  meet() {
    const w = world();
    const p = new Probe(w, `meet seed ${seed}: 16 v 16 on the centre road, 120 s`);
    w.army!.spawnMix(1, CENTRE, PIKES, 0);
    w.army!.spawnMix(0, CENTRE, PIKES, 0);
    run(w, p, 120, (t) => {
      if (t === 10 * 60) {
        w.army!.spawnMix(1, CENTRE, PIKES, 0);
        w.army!.spawnMix(0, CENTRE, PIKES, 0);
      }
    });
    console.log(p.report());
    console.log(`upright after: t1 ${up(w, 1).length} t0 ${up(w, 0).length}`);
    w.free();
  },
  // Hold: four waves on the centre road arrive at the marker; at 75 s Advance.
  hold() {
    const w = world();
    const p = new Probe(w, `hold seed ${seed}: team 1 Hold, 3 waves centre (0, 0, +12 s) + 1 left, Advance at 75 s, 110 s`);
    w.army!.setOrder(1, Order.Hold);
    w.army!.spawnMix(1, CENTRE, PIKES, 0);
    w.army!.spawnMix(1, CENTRE, PIKES, -5.5);
    w.army!.spawnMix(1, LEFT, PIKES, 5.5);
    let moving: string[] = [];
    run(w, p, 110, (t) => {
      if (t === 12 * 60) w.army!.spawnMix(1, CENTRE, PIKES, 0);
      if (t >= 40 * 60 && t < 75 * 60 && t % 300 === 0) {
        const team = up(w, 1);
        const walking = team.filter((m) => m.action === Action.Walk).length;
        const v = team.reduce((s, m) => s + Math.hypot(m.vx, m.vz), 0) / team.length;
        moving.push(`${t / 60}s walk ${walking}/${team.length} mean speed ${v.toFixed(2)}`);
      }
      if (t === 75 * 60) w.army!.setOrder(1, Order.Advance);
    });
    console.log(p.report());
    console.log("on hold: " + moving.join("; "));
    w.free();
  },
  // Push with no breach: as Advance.
  push() {
    const w = world();
    const p = new Probe(w, `push seed ${seed}: team 1 Push (no breach), 2 waves centre, 100 s`);
    w.army!.setOrder(1, Order.Push);
    w.army!.spawnMix(1, CENTRE, PIKES, 0);
    w.army!.spawnMix(1, LEFT, PIKES, -5.5);
    run(w, p, 100);
    console.log(p.report());
    w.free();
  },
};

/** Blow the centre bridge while a centre wave marches on it: when its front is 10 m short, when 3 men are on the deck, or when its middle is across. */
function blow(when: "before" | "deck" | "crossed") {
  const w = world();
  const p = new Probe(w, `blow-${when} seed ${seed}: team 1, 2 waves centre (one 6 s behind), centre bridge blown ${when}, 110 s`);
  const b = BRIDGES[1];
  w.army!.spawnMix(1, CENTRE, PIKES, 0);
  let blewAt = -1, topoAt = -1, rerouteAt = -1, freshAt = -1, moveAgain = -1, topo0 = -1;
  const timeline: string[] = [];
  const army = w.army!;
  const waveRoute = () => Array.from((army as any).waveRoute as Int8Array).slice(0, army.waves).map((r: number) => ROUTE_NAMES[r][0]).join("");
  run(w, p, 110, (t) => {
    if (t === 6 * 60) army.spawnMix(1, CENTRE, PIKES, 0);
    const team = up(w, 1);
    if (blewAt < 0) {
      const zs = b.z - b.length / 2, ze = b.z + b.length / 2;
      const front = Math.max(...team.map((m) => m.z));
      const onDeck = team.filter((m) => m.z > zs && m.z < ze && Math.abs(m.x - b.x) < 2.5).length;
      const mid = team.filter((m) => m.wave === 0).reduce((s, m) => s + m.z, 0) / Math.max(1, team.filter((m) => m.wave === 0).length);
      const go = when === "before" ? front > zs - 10 : when === "deck" ? onDeck >= 3 : mid > b.z + 2;
      if (go) {
        blewAt = t;
        topo0 = w.nav.topo;
        w.explode(b.x + 0.3, DECK_TOP - 0.4, b.z + 0.5);
        w.explode(b.x - 0.3, DECK_TOP - 0.4, b.z - 2.0);
        timeline.push(`${(t / 60).toFixed(1)}s BLOW (front z ${front.toFixed(1)}, on deck ${onDeck}, wave 0 middle z ${mid.toFixed(1)}; deck ${zs.toFixed(1)}..${ze.toFixed(1)}) routes ${waveRoute()}`);
      }
      return;
    }
    if (topoAt < 0 && w.nav.topo !== topo0) {
      topoAt = t;
      timeline.push(`${(t / 60).toFixed(1)}s nav topo changed; bridges open ${w.bridgesOpen().join(",")}`);
    }
    if (rerouteAt < 0 && waveRoute() !== "cc") {
      rerouteAt = t;
      timeline.push(`${(t / 60).toFixed(1)}s rerouted: ${waveRoute()}`);
    }
    if (rerouteAt >= 0 && freshAt < 0) {
      const fs = [0, 1, 2].map((r) => army.flow.built[routeField(1, r)] === w.nav.topo);
      if (fs.every(Boolean)) {
        freshAt = t;
        timeline.push(`${(t / 60).toFixed(1)}s team 1 route fields fresh`);
      }
    }
    if (t % 60 === 0 && t - blewAt <= 40 * 60) {
      const stand = team.filter((m) => m.action === Action.Stand).length;
      const walk = team.filter((m) => m.action === Action.Walk).length;
      const v = team.reduce((s, m) => s + Math.hypot(m.vx, m.vz), 0) / Math.max(1, team.length);
      const inf = team.filter((m) => army.flow.at(routeField(1, m.route), m.x, m.z) >= FLOW_INF).length;
      const bank = team.filter((m) => Math.abs(m.x - b.x) < 6 && m.z < b.z && m.z > b.z - b.length / 2 - 6).length;
      const far = team.filter((m) => m.z > b.z).length;
      timeline.push(`${(t / 60).toFixed(0)}s +${((t - blewAt) / 60).toFixed(0)}: up ${team.length} walk ${walk} stand ${stand} v ${v.toFixed(2)} cutoff ${inf} at near bank ${bank} across ${far} routes ${waveRoute()} stale ${army.flow.stale}`);
      if (moveAgain < 0 && t - blewAt > 60 && v > 1.0) moveAgain = t;
    }
  });
  console.log(p.report());
  console.log("timeline:\n  " + timeline.join("\n  "));
  console.log(`wave moving again (mean speed > 1 m/s) ${moveAgain >= 0 ? ((moveAgain - blewAt) / 60).toFixed(0) + " s after the blast" : "never"}`);
  const team = up(w, 1);
  console.log(`end: ${team.length} up: ${team.map((m) => `${m.id}:${ROUTE_NAMES[m.route][0]}(${m.x.toFixed(0)},${m.z.toFixed(0)})${["W", "S", "F", "B"][m.action] ?? m.action}`).join(" ")}`);
  w.free();
}
/** A road whose bridge is already down when its wave is sent: two men become a gang, the rest go round. Gang men walk straight lines. */
function gang(route: number) {
  const w = world();
  const army = w.army!;
  const name = ROUTE_NAMES[route];
  const b = BRIDGES.find((s) => s.name === name)!;
  const p = new Probe(w, `gang-${name} seed ${seed}: ${name} bridge blown, then a team 1 pikemen wave sent down the ${name} road, 120 s`);
  w.explode(b.x + 0.3, DECK_TOP - 0.4, b.z + 0.5);
  w.explode(b.x - 0.3, DECK_TOP - 0.4, b.z - 2.0);
  run(w, p, 6);
  console.log(`bridges open ${w.bridgesOpen().join(",")}`);
  army.spawnMix(1, route, PIKES, 0);
  const gl: string[] = [];
  run(w, p, 120, (t) => {
    if (t % 300 !== 0) return;
    const men = w.minions.list.filter((m) => m.team === 1 && m.wave >= 0);
    const g = men.filter((m) => m.role === 4);
    const st = w.gangs!.status();
    gl.push(`${(t / 60).toFixed(0)}s gang ${g.map((m) => `${m.id}(${m.x.toFixed(1)},${m.z.toFixed(1)} v${Math.hypot(m.vx, m.vz).toFixed(1)} ${m.state === 0 ? "up" : "down"})`).join(" ")} status ${st.map((s) => `state${s.state} ${(s.progress * 100).toFixed(0)}%`).join(",")} open ${w.bridgesOpen().map((o) => (o ? 1 : 0)).join("")}`);
  });
  console.log(p.report());
  console.log("gang:\n  " + gl.join("\n  "));
  w.free();
}
scenarios["gang-left"] = () => gang(LEFT);
scenarios["gang-centre"] = () => gang(CENTRE);
/** Push with a breach west of the enemy gate, waves sent down the left and right roads: do they keep their roads? */
scenarios["push-breach"] = () => {
  const w = world();
  for (const [k, x] of [[0, -8.5], [1, -7.5]] as const) w.queue(10 + k * 250, { kind: "fire", emplacement: 0, yaw: Math.atan2(x, 120), pitch: -0.022, charge: 1, fuse: 0, spin: 0 } as any);
  const p0 = new Probe(w, "warmup");
  run(w, p0, 14);
  const p = new Probe(w, `push-breach seed ${seed}: breach west of the gate, team 1 Push, waves on left and right roads, 100 s`);
  console.log(`breach field reachable from the muster: ${w.army!.flow.at(7, 0, -130) < FLOW_INF}`);
  w.army!.setOrder(1, Order.Push);
  w.army!.spawnMix(1, LEFT, PIKES, -5.5);
  w.army!.spawnMix(1, RIGHT, PIKES, 5.5);
  run(w, p, 100);
  console.log(p.report());
  w.free();
};
/** The centre deck's middle drops out under a wave (pieces knocked loose, no blast to knock the men down): at the bank, with men on it, with the wave half across. */
function drop(when: "bank" | "deck" | "split") {
  const w = world();
  const army = w.army!;
  const b = BRIDGES[1];
  const lb = w.castle.layout.bridges[1];
  const p = new Probe(w, `drop-${when} seed ${seed}: team 1, 2 waves centre (one 6 s behind), centre deck's middle knocked loose (${when}), 100 s`);
  army.spawnMix(1, CENTRE, PIKES, 0);
  let at = -1, moveAgain = -1, topo0 = -1;
  const tl: string[] = [];
  const waveRoute = () => Array.from((army as any).waveRoute as Int8Array).slice(0, army.waves).map((r: number) => ROUTE_NAMES[r][0]).join("");
  const zs = b.z - b.length / 2, ze = b.z + b.length / 2;
  run(w, p, 100, (t) => {
    if (t === 6 * 60) army.spawnMix(1, CENTRE, PIKES, 0);
    const team = up(w, 1);
    if (at < 0) {
      const front = Math.max(...team.map((m) => m.z));
      const onDeck = team.filter((m) => m.z > zs && m.z < ze && Math.abs(m.x - b.x) < 2.5).length;
      const w0 = team.filter((m) => m.wave === 0);
      const mid = w0.reduce((s, m) => s + m.z, 0) / Math.max(1, w0.length);
      const go = when === "bank" ? front > zs - 3 : when === "deck" ? onDeck >= 4 : mid > b.z - 1;
      if (!go) return;
      at = t;
      topo0 = w.nav.topo;
      let n = 0;
      for (let id = lb.first; id < lb.first + lb.count; id++) {
        const s = w.castle.layout.stones[id];
        if (Math.abs(s.z - b.z) < 4.5 && w.castle.knockLoose(id, 0, -0.5, 0)) n++;
      }
      tl.push(`${(t / 60).toFixed(1)}s DROP ${n} pieces (front z ${front.toFixed(1)}, on deck ${onDeck}, wave 0 middle ${mid.toFixed(1)}; deck ${zs.toFixed(1)}..${ze.toFixed(1)}, gap ${(b.z - 4.5).toFixed(1)}..${(b.z + 4.5).toFixed(1)}) routes ${waveRoute()}`);
      return;
    }
    if (t - at === 25 * 60) {
      for (const m of team) {
        if (m.action !== Action.Stand || Math.abs(m.x) > 3 || m.z < zs - 1 || m.z > ze + 1) continue;
        const f = routeField(1, m.route);
        const d: [number, number] = [0, 0];
        const ok = army.flow.dir(f, m.x, m.z, d);
        const c = army.cellAt(m.x, m.z);
        const nb: string[] = [];
        for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const n = c + di + dj * 192;
          nb.push(`(${di},${dj}) k${w.nav.kind[n]} fl ${w.nav.floor[n].toFixed(2)} cost ${army.flow.dist[f][n] >= FLOW_INF ? "INF" : army.flow.dist[f][n]} pass ${w.nav.passable(c, n) ? 1 : 0}`);
        }
        tl.push(`STUCK? man ${m.id} at (${m.x.toFixed(2)}, ${m.z.toFixed(2)}) cell k${w.nav.kind[c]} fl ${w.nav.floor[c].toFixed(2)} cost ${army.flow.dist[f][c]} dir ${ok ? `(${d[0].toFixed(2)}, ${d[1].toFixed(2)})` : "none"} canStep ahead ${army.canStep(c, m.x + d[0] * 0.03, m.z + d[1] * 0.03)} x ${army.canStep(c, m.x + d[0] * 0.03, m.z)} z ${army.canStep(c, m.x, m.z + d[1] * 0.03)}\n      ${nb.join("\n      ")}`);
      }
    }
    if (t - at === 20 * 60 || t - at === 60) {
      const K = "GRWSB#";
      const rows: string[] = [];
      for (let z = Math.floor(zs) - 1; z <= Math.ceil(ze) + 1; z++) {
        let r = "", fl = "";
        for (let x = -4; x <= 3; x++) {
          const c = w.army!.cellAt(x + 0.5, z + 0.5);
          r += K[w.nav.kind[c]];
          fl += w.nav.floor[c].toFixed(2).padStart(6);
        }
        rows.push(`    z ${z} ${r} ${fl}`);
      }
      tl.push(`nav at +${((t - at) / 60).toFixed(0)}s (x -4..3; G ground R raised W water S steep B blocked # rubble):\n${rows.join("\n")}`);
    }
    if (t % 60 === 0 && t - at <= 30 * 60) {
      const stand = team.filter((m) => m.action === Action.Stand).length;
      const v = team.reduce((s, m) => s + Math.hypot(m.vx, m.vz), 0) / Math.max(1, team.length);
      const onDeck = team.filter((m) => m.z > zs - 0.5 && m.z < ze + 0.5 && Math.abs(m.x - b.x) < 2.5).length;
      const far = team.filter((m) => m.z > b.z).length;
      tl.push(`+${((t - at) / 60).toFixed(0)}s: up ${team.length} stand ${stand} v ${v.toFixed(2)} on deck ends ${onDeck} across ${far} topo ${w.nav.topo !== topo0 ? "changed" : "same"} open ${w.bridgesOpen().map((o) => (o ? 1 : 0)).join("")} routes ${waveRoute()} stale ${army.flow.stale}${team.filter((m) => m.z > zs - 0.5 && m.z < ze + 0.5 && Math.abs(m.x) < 2.5).map((m) => ` [${m.id} (${m.x.toFixed(1)},${m.z.toFixed(1)}) ${["W", "S", "F", "B"][m.action]}]`).join("")}`);
      if (moveAgain < 0 && t - at > 60 && v > 1.0) moveAgain = t;
    }
  });
  console.log(p.report());
  console.log("timeline:\n  " + tl.join("\n  "));
  console.log(`moving again (mean speed > 1 m/s) ${moveAgain >= 0 ? ((moveAgain - at) / 60).toFixed(0) + " s after" : "never"}`);
  const team = up(w, 1);
  console.log(`end: ${team.length} up: ${team.map((m) => `${m.id}:${ROUTE_NAMES[m.route][0]}(${m.x.toFixed(0)},${m.z.toFixed(0)})${["W", "S", "F", "B"][m.action] ?? m.action}`).join(" ")}`);
  w.free();
}
scenarios["drop-bank"] = () => drop("bank");
scenarios["drop-deck"] = () => drop("deck");
scenarios["drop-split"] = () => drop("split");
scenarios["blow-before"] = () => blow("before");
scenarios["blow-deck"] = () => blow("deck");
scenarios["blow-crossed"] = () => blow("crossed");

const names = which === "all" ? Object.keys(scenarios) : which.split(",");
for (const n of names) {
  const t0 = Date.now();
  scenarios[n]();
  console.log(`(${n}: ${((Date.now() - t0) / 1000).toFixed(1)} s wall)\n`);
}
