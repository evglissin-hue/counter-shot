// dsqrt against Math.sqrt over a wide range.
import { dsqrt } from "../src/core/detmath";
let worst = 0, exact = 0, n = 0;
for (let e = -20; e <= 20; e += 0.37) for (let k = 0; k < 200; k++) { const x = Math.pow(10, e) * (1 + k / 97); const a = dsqrt(x), b = Math.sqrt(x); worst = Math.max(worst, Math.abs(a - b) / b); if (a === b) exact++; n++; }
console.log("relative error worst", worst, "exactly equal", exact, "of", n);
