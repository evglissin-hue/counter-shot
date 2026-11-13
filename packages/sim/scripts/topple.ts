// How does a keep or a tower fall (3.4)? Cuts a whole keep along one face and the third of each side (a topple), a tower on its
// outer side, and a keep evenly all round (a crush), each from a fresh world, and prints per second the bodies moving, the
// brittle ghosts flying and the step times, then when the Strain, the Topple (or Crush), the release and the banner came.
// npx rolldown packages/sim/scripts/topple.ts --format esm --platform node -o node_modules/.scratch/topple.mjs && node node_modules/.scratch/topple.mjs
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout, GAME_LAYOUT, structureList } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, SandboxSim, type Rapier } from "@keepfall/sim";

await RD.init();
const R = RD as unknown as Rapier;
const layout = buildLayout(1, GAME_LAYOUT);
const L = structureList(layout);

const rel = (si: number, id: number) => ({ x: layout.stones[id].x - L[si].cx, z: layout.stones[id].z - L[si].cz, c: layout.stones[id].course, part: layout.stones[id].part });

function faceCut(): number[] {
  return L[0].stones.filter((id) => {
    const p = rel(0, id);
    return p.part === "keep" && p.c >= 2 && p.c <= 4 && (p.z < -3 || (Math.abs(p.x) > 3 && p.z < -5 + 10 / 3));
  });
}

function evenCut(): number[] {
  const faces = new Map<string, Array<{ id: number; pos: number }>>();
  for (const id of L[0].stones) {
    const p = rel(0, id);
    if (p.part !== "keep" || p.c !== 2 || (Math.abs(p.x) > 4 && Math.abs(p.z) > 3)) continue;
    const key = Math.abs(p.z) > 3 ? (p.z < 0 ? "n" : "s") : p.x < 0 ? "w" : "e";
    const list = faces.get(key) ?? faces.set(key, []).get(key)!;
    list.push({ id, pos: key === "n" || key === "s" ? p.x : p.z });
  }
  const out: number[] = [];
  for (const key of [...faces.keys()].sort()) {
    faces.get(key)!.sort((a, b) => a.pos - b.pos).forEach((e, k) => {
      if (Math.floor((k + 1) * 0.8 + 0.5) > Math.floor(k * 0.8 + 0.5)) out.push(e.id);
    });
  }
  return out;
}

function towerCut(): number[] {
  const d = L[1];
  const target = Math.atan2(-1, -1);
  const w = d.stones
    .filter((id) => layout.stones[id].part === "tower" && layout.stones[id].course === 2)
    .map((id) => ({ id, a: Math.abs(Math.atan2(Math.sin(Math.atan2(layout.stones[id].z - d.cz, layout.stones[id].x - d.cx) - target), Math.cos(Math.atan2(layout.stones[id].z - d.cz, layout.stones[id].x - d.cx) - target))) }));
  w.sort((p, q) => p.a - q.a || p.id - q.id);
  return w.slice(0, Math.round(w.length * 0.45)).map((x) => x.id);
}

function scenario(name: string, si: number, ids: number[], seconds: number) {
  const sim = new SandboxSim(R, layout, { seed: 7, minions: 0 });
  const st = sim.statics!;
  // Time the statics pass on its own.
  let own = 0, ownWorst = 0;
  const step = st.step.bind(st);
  st.step = (t: number) => {
    const a = performance.now();
    step(t);
    const d = performance.now() - a;
    own += d;
    if (d > ownWorst) ownWorst = d;
  };
  for (const id of ids) sim.castle.dust(id);
  sim.castle.supportNow();
  console.log(`\n== ${name}: ${ids.length} pieces cut, structure ${si} (${L[si].name}), ${L[si].stones.length} pieces ==`);
  console.log("  sec  moving  ghosts  worst ms  mean ms");
  const marks: string[] = [];
  let banner = -1;
  let allWorst = 0, allSum = 0, mostMoving = 0, mostGhosts = 0;
  const names: Record<number, string> = { [EventKind.Strain]: "Strain", [EventKind.Saved]: "Saved", [EventKind.Topple]: "Topple", [EventKind.Crush]: "Crush", [EventKind.Released]: "Released" };
  for (let s = 0; s < seconds; s++) {
    let worst = 0, sum = 0, moving = 0, ghosts = 0;
    for (let k = 0; k < 60; k++) {
      const t = s * 60 + k + 1;
      const a = performance.now();
      sim.step();
      const ms = performance.now() - a;
      sum += ms;
      if (ms > worst) worst = ms;
      const f = sim.collect();
      for (let i = 0; i < f.eventCount; i++) {
        const e = f.events.slice(i * EVENT_STRIDE, (i + 1) * EVENT_STRIDE);
        if (names[e[0]] && e[1] === si) marks.push(`${names[e[0]]} ${(t / 60).toFixed(2)} s`);
      }
      if (banner < 0 && sim.castle.toppled[0]) banner = t;
      const aw = sim.castle.awakeCount();
      if (aw > moving) moving = aw;
      if (st.ghostCount() > ghosts) ghosts = st.ghostCount();
    }
    if (worst > allWorst) allWorst = worst;
    allSum += sum;
    if (moving > mostMoving) mostMoving = moving;
    if (ghosts > mostGhosts) mostGhosts = ghosts;
    console.log(`  ${String(s + 1).padStart(3)}  ${String(moving).padStart(6)}  ${String(ghosts).padStart(6)}  ${worst.toFixed(1).padStart(8)}  ${(sum / 60).toFixed(2).padStart(7)}`);
  }
  const rr = st.lastRelease[si];
  console.log(`  events: ${marks.join(", ")}; banner down ${banner < 0 ? "never" : (banner / 60).toFixed(2) + " s"}`);
  if (rr) console.log(`  let go at ${((rr.theta * 180) / Math.PI).toFixed(1)} degrees, by ${["", "the tip angle", "a probe", "the time"][rr.why]}`);
  console.log(`  most moving ${mostMoving}, most ghosts ${mostGhosts}, worst step ${allWorst.toFixed(1)} ms, mean ${(allSum / (seconds * 60)).toFixed(2)} ms`);
  console.log(`  the statics pass alone: worst ${ownWorst.toFixed(2)} ms, mean ${(own / (seconds * 60)).toFixed(3)} ms`);
  sim.free();
}

scenario("a keep toppled (one face and a third of each side, courses 2 to 4)", 0, faceCut(), 14);
scenario("a tower toppled (45% of a course on its outer side)", 1, towerCut(), 10);
scenario("a keep crushed (80% of course 2 evenly, corners left)", 0, evenCut(), 14);
