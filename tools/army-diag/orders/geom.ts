import { BRIDGES, holdMarker, ROUTE_NAMES, MUSTER, streamOffset, streamWidth, MID_Z } from "@keepfall/content";
for (const t of [0, 1] as const) for (const r of ROUTE_NAMES) console.log(t, r, JSON.stringify(holdMarker(t, r)));
for (const b of BRIDGES) console.log(JSON.stringify(b));
for (let x = -60; x <= 60; x += 6) console.log(x, (MID_Z + streamOffset(x)).toFixed(1), streamWidth(x).toFixed(1));
