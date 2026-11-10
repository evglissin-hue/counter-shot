// Braziers on the castles (look round L3.4), the logic without three: which
// stones carry them, and when one goes out. A brazier rides its stone: if the
// stone falls or is moved more than half a metre, the fire goes out for the
// rest of the match (resetWorld lights them again).

import type { CastleLayout, Stone } from "@keepfall/content";

/** A stone that has moved this far (m) from where it was built takes its brazier down with it. */
export const OUT_DISTANCE = 0.5;

export interface BrazierSpot {
  stone: number;
  castle: 0 | 1;
  /** The top of the stone, where the basket stands. */
  x: number;
  y: number;
  z: number;
  /** Which part of the castle: the gatehouse or a tower. */
  where: "gate" | "tower";
}

/**
 * Three braziers per castle: one on the wall's top either side of the gate
 * (the gatehouse) and one on the rim of the tower on the gate's side that
 * stands farthest out.
 */
export function pickBraziers(layout: CastleLayout): BrazierSpot[] {
  const out: BrazierSpot[] = [];
  for (const castle of [0, 1] as const) {
    const mine = layout.stones.filter((s) => s.castle === castle);
    const gates = mine.filter((s) => s.part === "gate");
    const towers = mine.filter((s) => s.part === "tower");
    if (!gates.length || !towers.length) continue;
    let cx = 0, cz = 0;
    for (const t of towers) {
      cx += t.x;
      cz += t.z;
    }
    cx /= towers.length;
    cz /= towers.length;
    let gx = 0, gz = 0;
    for (const g of gates) {
      gx += g.x;
      gz += g.z;
    }
    gx /= gates.length;
    gz /= gates.length;
    const merlons = mine.filter((s) => s.part === "merlon");
    const top = (s: Stone): BrazierSpot["y"] => s.y + s.hy;
    // The gate wall's merlons within a few metres of the gate (the towers stand 15 m off), one nearest each side of it.
    const gateWall = merlons.filter((s) => Math.abs(s.z - gz) < 1.6 && Math.hypot(s.x - gx, s.z - gz) < 8);
    const near = (a: Stone, b: Stone) => Math.hypot(a.x - gx, a.z - gz) - Math.hypot(b.x - gx, b.z - gz) || a.id - b.id;
    const left = gateWall.filter((s) => s.x < gx).sort(near);
    const right = gateWall.filter((s) => s.x >= gx).sort(near);
    for (const side of [left, right]) {
      const s = side[0];
      if (s) out.push({ stone: s.id, castle, x: s.x, y: top(s), z: s.z, where: "gate" });
    }
    // A tower rim on the gate's side of the castle, the merlon farthest from the middle.
    const towerTop = Math.max(...towers.map((s) => s.y));
    const rim = merlons.filter((s) => s.y > towerTop - 0.2 && (s.z - cz) * (gz - cz) > 0);
    rim.sort((a, b) => Math.hypot(b.x - cx, b.z - cz) - Math.hypot(a.x - cx, a.z - cz) || a.id - b.id);
    if (rim.length) out.push({ stone: rim[0].id, castle, x: rim[0].x, y: top(rim[0]), z: rim[0].z, where: "tower" });
  }
  return out;
}

/** Which braziers burn: they go out when their stone moves, and stay out until reset. */
export class BrazierFires {
  readonly lit: boolean[];
  private byStone = new Map<number, number[]>();

  constructor(readonly spots: BrazierSpot[], private layout: CastleLayout) {
    this.lit = spots.map(() => true);
    spots.forEach((s, i) => {
      const l = this.byStone.get(s.stone);
      if (l) l.push(i);
      else this.byStone.set(s.stone, [i]);
    });
  }

  /** Stone poses from a frame: [id, x, y, z, qx, qy, qz, qw] * count. Returns the braziers that just went out. */
  bodies(data: ArrayLike<number>, count: number, onOut?: (i: number) => void) {
    for (let k = 0; k < count; k++) {
      const o = k * 8;
      const list = this.byStone.get(data[o] | 0);
      if (!list) continue;
      const s = this.layout.stones[data[o] | 0];
      const d = Math.hypot(data[o + 1] - s.x, data[o + 2] - s.y, data[o + 3] - s.z);
      if (d <= OUT_DISTANCE) continue;
      for (const i of list) {
        if (!this.lit[i]) continue;
        this.lit[i] = false;
        onOut?.(i);
      }
    }
  }

  /** Light them all again (a new match). */
  relight() {
    this.lit.fill(true);
  }
}
