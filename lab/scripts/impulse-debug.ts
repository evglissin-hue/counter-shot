// Does a freshly loosened stone get its mass and impulse right away?
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout } from "../src/core/castle";
import { CastleSim, DEFAULT_SIM, type Rapier } from "../src/physics/sim";

await RD.init();
const layout = buildLayout(1);
const sim = new CastleSim(RD as unknown as Rapier, layout, DEFAULT_SIM);
sim.world.step();
const id = layout.stones.findIndex((s) => s.part === "wall" && s.course === 6 && Math.abs(s.z + 15) < 0.1 && s.x > 3);
const body = sim.bodies[id];
console.log("before: type", body.bodyType(), "mass", body.mass());
body.setBodyType(RD.RigidBodyType.Dynamic, true);
console.log("after setBodyType: mass", body.mass());
body.recomputeMassPropertiesFromColliders();
console.log("after recompute: mass", body.mass());
body.applyImpulse({ x: 0, y: 0, z: 30000 }, true);
console.log("linvel after impulse", JSON.stringify(body.linvel()));
sim.world.step();
console.log("linvel after a step", JSON.stringify(body.linvel()), "pos", JSON.stringify(body.translation()));
