// Nav kinds around castle 0's front (a fresh match): G ground, R raised, W water, S steep, B blocked, r rubble.
import { navCell } from "@keepfall/sim";
import { newMatch, arg } from "./common";
const m = newMatch({ seed: 1, barracks: false });
for (let i = 0; i < 20; i++) m.step();
const x0 = Number(arg("x0", "-40")), x1 = Number(arg("x1", "40")), z0 = Number(arg("z0", "-50")), z1 = Number(arg("z1", "-12"));
const ch = "GRWSBr";
for (let z = z1; z >= z0; z -= 1) {
  let row = "";
  for (let x = x0; x <= x1; x += 1) {
    const c = navCell(x + 0.25, z + 0.25);
    row += c < 0 ? " " : ch[m.world.nav.kind[c]];
  }
  console.log(`${String(z).padStart(4)} ${row}`);
}
console.log(`     x from ${x0} to ${x1}`);
m.free();
