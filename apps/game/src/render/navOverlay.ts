// Debug overlay of the nav grid (N): one flat tile per square metre at its
// walking height. Cold green where a minion can walk from your gate, amber
// where it could walk but is cut off, blue water, red where something blocks
// the way, and dim brown slopes too steep to climb. When a bridge goes, its
// deck turns blue and, once every crossing is down, the far bank turns amber.

import * as THREE from "three/webgpu";
import { NavKind, NAV_GRID, NAV_STEP, navCell } from "@keepfall/sim";

const COLORS: Record<number, [number, number, number, number]> = {
  // r, g, b (0..1), opacity weight
  [NavKind.Ground]: [0.42, 0.78, 0.5, 0.2],
  [NavKind.Raised]: [0.55, 0.92, 0.62, 0.5],
  [NavKind.Water]: [0.3, 0.55, 0.9, 0.45],
  [NavKind.Steep]: [0.48, 0.4, 0.32, 0.2],
  [NavKind.Blocked]: [0.86, 0.32, 0.27, 0.55],
};
const CUT_OFF: [number, number, number, number] = [0.9, 0.66, 0.26, 0.4];

export class NavOverlay {
  readonly mesh: THREE.Mesh;
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;
  private seen: Uint8Array;
  private queue: Int32Array;
  /** Where reachability is measured from: in front of your own gate. */
  private start = navCell(0.3, -126);

  constructor() {
    const { nx, nz, x0, z0, cell } = NAV_GRID;
    const n = nx * nz;
    const pos = new Float32Array(n * 4 * 3);
    const col = new Float32Array(n * 4 * 4);
    const idx = new Uint32Array(n * 6);
    const m = 0; // seamless: hairlines turn into moire at a distance
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        const xa = x0 + i * cell + m, xb = x0 + (i + 1) * cell - m;
        const za = z0 + j * cell + m, zb = z0 + (j + 1) * cell - m;
        pos.set([xa, 0, za, xb, 0, za, xa, 0, zb, xb, 0, zb], c * 12);
        const v = c * 4;
        idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], c * 6);
      }
    }
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(pos, 3);
    this.col = new THREE.BufferAttribute(col, 4);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", this.pos);
    g.setAttribute("color", this.col);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.vertexColors = true;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.fog = false;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = "nav-overlay";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.mesh.visible = false;
    this.seen = new Uint8Array(n);
    this.queue = new Int32Array(n);
  }

  /** Redraw from the worker's grid: kind and walking height per cell. */
  update(kind: Uint8Array, floor: Float32Array) {
    const { nx, nz } = NAV_GRID;
    const n = nx * nz;
    if (kind.length !== n) return;
    // Reach from your gate: 4-neighbour steps up or down at most a step.
    const seen = this.seen, q = this.queue;
    seen.fill(0);
    let head = 0, tail = 0;
    const walk = (k: number) => k === NavKind.Ground || k === NavKind.Raised;
    if (this.start >= 0 && walk(kind[this.start])) {
      seen[this.start] = 1;
      q[tail++] = this.start;
    }
    while (head < tail) {
      const c = q[head++];
      const i = c % nx, j = (c - i) / nx;
      const f = floor[c];
      const visit = (nc: number) => {
        if (seen[nc] || !walk(kind[nc])) return;
        const d = floor[nc] - f;
        if (d > NAV_STEP || d < -NAV_STEP) return;
        seen[nc] = 1;
        q[tail++] = nc;
      };
      if (i > 0) visit(c - 1);
      if (i < nx - 1) visit(c + 1);
      if (j > 0) visit(c - nx);
      if (j < nz - 1) visit(c + nx);
    }
    const p = this.pos.array as Float32Array, col = this.col.array as Float32Array;
    for (let c = 0; c < n; c++) {
      const k = kind[c];
      const y = floor[c] + (k === NavKind.Water ? 0.02 : 0.07);
      const o = c * 12;
      p[o + 1] = p[o + 4] = p[o + 7] = p[o + 10] = y;
      const rgba = walk(k) && !seen[c] ? CUT_OFF : COLORS[k] ?? COLORS[NavKind.Blocked];
      // Far up the valley sides nothing walks: keep those faint.
      const faint = k === NavKind.Steep || (walk(k) && !seen[c] && floor[c] > 6) ? 0.5 : 1;
      for (let v = 0; v < 4; v++) col.set([rgba[0], rgba[1], rgba[2], rgba[3] * faint], c * 16 + v * 4);
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
