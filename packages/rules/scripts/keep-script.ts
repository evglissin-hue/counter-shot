// Writes the keep match's script (session.ts MATCH_SCRIPT): in the match the
// test plays (seed 7, MATCH_OPTIONS: no waves, no plan, no masons), the player's mortar lays each
// shell on the floor under the enemy banner as soon as it is loaded (the
// nearest point it can reach), with one long gun shot at the keep early on,
// until the banner is down. Prints the inputs to paste.
// npx rolldown packages/rules/scripts/keep-script.ts --format esm --platform node -o node_modules/.scratch/keep-script.mjs && node node_modules/.scratch/keep-script.mjs
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, CASTLE_SHAPE, GAME_LAYOUT, KEEP_STOREYS } from "@keepfall/content";
import { solveAim, Spin, type Rapier } from "@keepfall/sim";
import { Match, MATCH_OPTIONS, Team, type MatchInput } from "@keepfall/rules";

await RD.init();
const R = RD as unknown as Rapier;
const m = new Match(R, buildLayout(1, GAME_LAYOUT), { ...MATCH_OPTIONS, seed: 7 });
const mo = m.emplacements[1];
const floors = KEEP_STOREYS.map((c) => c * CASTLE_SHAPE.course);
const lines: string[] = [];
const out: Array<[number, MatchInput]> = [];
const add = (t: number, input: MatchInput) => {
  out.push([t, input]);
  m.queue(t, Team.Player, input);
};
add(60, { kind: "fire", emplacement: 0, yaw: 0, pitch: 0.035, charge: 1, fuse: 0, spin: Spin.None });
for (let t = 0; t < 60 * 400 && !m.result; t++) {
  if (t >= 30 && m.world.reload[1] === 0 && t % 10 === 0) {
    const b = m.world.castle.bodies[m.world.castle.layout.bannerIds[0]].translation();
    let floor = floors[0];
    for (const y of floors) if (y <= b.y - 0.5) floor = y;
    let s = null;
    for (let back = 0; back <= 6 && !s; back += 0.5) s = solveAim(mo, b.x, floor - 0.3, b.z - back);
    if (s) add(t, { kind: "fire", emplacement: 1, yaw: +s.yaw.toFixed(4), pitch: +s.pitch.toFixed(4), charge: +s.charge.toFixed(4), fuse: 0, spin: Spin.None });
  }
  m.step();
}
console.log("result", JSON.stringify(m.result), "shots", m.shots);
for (const [t, i] of out) {
  const f = i as Extract<MatchInput, { kind: "fire" }>;
  lines.push(`  [${t}, Team.Player, fire(${f.emplacement}, ${f.yaw}, ${f.pitch}${f.charge !== 1 ? `, ${f.charge}` : ""})],`);
}
console.log(lines.join("\n"));
