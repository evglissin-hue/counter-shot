// How long does the enemy keep stand against a perfect gunner? The player's
// long gun fires at the keep's face just under the floor the banner stands
// on (left, middle, right in turn) and the mortar drops shells on the banner,
// each as soon as it is loaded, with nobody else on the field (masons on or
// off). Prints when the banner came down and the shots it took.
// npx rolldown packages/rules/scripts/siege.ts --format esm --platform node -o node_modules/.scratch/siege.mjs && node node_modules/.scratch/siege.mjs [masons] [seeds]
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, CASTLE_SHAPE, GAME_LAYOUT, type KeepOptions } from "@keepfall/content";
import { solveAim, Spin, type Rapier } from "@keepfall/sim";
import { Match, Team } from "@keepfall/rules";

await RD.init();
const R = RD as unknown as Rapier;
// Keep variants: old (the M4 keep), or thick=, hard=, hits= (default: the match keep).
const arg = (k: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1];
const keep: KeepOptions | undefined = process.argv.includes("old")
  ? undefined
  : { thick: Number(arg("thick") ?? GAME_LAYOUT.keep?.thick ?? 1.4), hard: Number(arg("hard") ?? GAME_LAYOUT.keep?.hard ?? 1), storeyHits: Number(arg("hits") ?? GAME_LAYOUT.keep?.storeyHits ?? 1) };
const layout = buildLayout(1, { ...GAME_LAYOUT, keep });
console.log("keep", JSON.stringify(keep ?? "old"));
const masons = process.argv.includes("masons");
const seeds = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 3);
const MAX = 60 * Number(arg("secs") ?? 360);
const face = CASTLE_SHAPE.keepZ - CASTLE_SHAPE.keepHalf; // the enemy keep's face towards the player

for (let seed = 1; seed <= seeds; seed++) {
  const m = new Match(R, layout, { seed, barracks: false, garrison: false, masons, gunnery: false, plan: false });
  const lg = m.emplacements[0], mo = m.emplacements[1];
  let lgShots = 0, moShots = 0;
  const floors: string[] = [];
  let lastFloor = 99;
  const t0 = performance.now();
  for (let t = 0; t < MAX && !m.result; t++) {
    const b = m.world.castle.bodies[layout.bannerIds[0]].translation();
    const floor = b.y > 17 ? 3 : b.y > 10.5 ? 2 : b.y > 4 ? 1 : 0;
    if (floor < lastFloor) {
      if (lastFloor !== 99) floors.push(`${floor}@${(t / 60).toFixed(0)}s(${lgShots}lg,${moShots}mo)`);
      lastFloor = floor;
    }
    if (m.world.reload[0] === 0 && t % 6 === 0) {
      const x = [-2.6, 0, 2.6][lgShots % 3];
      const s = solveAim(lg, x, b.y - 1.6, face);
      if (s) {
        m.queue(t, Team.Player, { kind: "fire", emplacement: 0, yaw: s.yaw, pitch: s.pitch, charge: 1, fuse: 0, spin: Spin.None });
        lgShots++;
      }
    }
    if (m.world.reload[1] === 0 && t % 6 === 3) {
      // The keep's middle is beyond the mortar's reach: the nearest point towards the player that is not.
      let s = null;
      for (let dz = 0; dz < 8 && !s; dz += 0.25) s = solveAim(mo, b.x, b.y - 0.3, b.z - dz);
      if (s) {
        m.queue(t, Team.Player, { kind: "fire", emplacement: 1, yaw: s.yaw, pitch: s.pitch, charge: s.charge, fuse: 0, spin: Spin.None });
        moShots++;
      }
    }
    m.step();
  }
  const r = m.result;
  console.log(`seed ${seed}: ${r ? `keep down at ${(r.tick / 60).toFixed(1)} s` : "still standing"} after ${lgShots} long gun and ${moShots} mortar shots; enemy keep pieces down ${m.masonryDown(0)}; floors ${floors.join(" ")}; gold spent ${m.spent[0]}; ${((performance.now() - t0) / 1000).toFixed(1)} s wall`);
  m.free();
}
