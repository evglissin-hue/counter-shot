// The physics ground: a height grid over the valley, split into tiles of
// height-field colliders so a crater rebuilds only the tiles it touches.
// Below the grid a slab catches anything that falls through or leaves it.
// Heights start as the valley's (content's valleyGrid: the same bits on every
// machine). Deterministic: heights are changed only by + - * / and
// comparisons, and tiles rebuild in a fixed order.

import { NO_DIG, valleyGrid } from "@keepfall/content";
import { dsqrt } from "@keepfall/core";
import type { Rapier } from "./castleSim";
import { TERRAIN_GRID, type TerrainPatch } from "./frame";

type World = InstanceType<Rapier["World"]>;
type Collider = ReturnType<World["createCollider"]>;

const TILE = 16; // cells per tile side
/** Craters never dig below this. */
const MIN_H = -6;
/** Top of the catch slab under the grid. */
const SLAB_TOP = -8;

export { NO_DIG };

export class Terrain {
  readonly h: Float32Array;
  readonly nx = TERRAIN_GRID.nx;
  readonly nz = TERRAIN_GRID.nz;
  private tilesX: number;
  private tilesZ: number;
  private colliders: Collider[] = [];
  private body: ReturnType<World["createRigidBody"]>;
  /** Collider handles of the ground, for telling ground contacts apart. */
  readonly handles = new Set<number>();
  patches: TerrainPatch[] = [];
  /** Vertex rectangles [i0, j0, i1, j1] changed since the nav grid last looked (it empties this). */
  navDirty: number[] = [];
  private dirty = new Set<number>();

  constructor(private R: Rapier, private world: World) {
    this.h = valleyGrid().slice();
    this.tilesX = Math.ceil((this.nx - 1) / TILE);
    this.tilesZ = Math.ceil((this.nz - 1) / TILE);
    this.body = world.createRigidBody(R.RigidBodyDesc.fixed());
    // The catch slab below the grid, wide enough for shots that leave it.
    const G = TERRAIN_GRID;
    const cx = G.x0 + ((G.nx - 1) * G.cell) / 2, cz = G.z0 + ((G.nz - 1) * G.cell) / 2;
    const slab = world.createCollider(R.ColliderDesc.cuboid(((G.nx - 1) * G.cell) / 2 + 120, 1, ((G.nz - 1) * G.cell) / 2 + 120).setTranslation(cx, SLAB_TOP - 1, cz).setFriction(0.85), this.body);
    this.handles.add(slab.handle);
    for (let t = 0; t < this.tilesX * this.tilesZ; t++) this.colliders.push(this.buildTile(t));
  }

  private buildTile(t: number): Collider {
    const ti = t % this.tilesX, tj = (t - ti) / this.tilesX;
    const i0 = ti * TILE, j0 = tj * TILE;
    const ci = Math.min(TILE, this.nx - 1 - i0); // cells along x
    const cj = Math.min(TILE, this.nz - 1 - j0); // cells along z
    // Rapier: rows run along z, columns along x, column-major.
    const hs = new Float32Array((ci + 1) * (cj + 1));
    for (let i = 0; i <= ci; i++) for (let j = 0; j <= cj; j++) hs[i * (cj + 1) + j] = this.h[(j0 + j) * this.nx + (i0 + i)];
    const c = TERRAIN_GRID.cell;
    const cx = TERRAIN_GRID.x0 + (i0 + ci / 2) * c;
    const cz = TERRAIN_GRID.z0 + (j0 + cj / 2) * c;
    const desc = this.R.ColliderDesc.heightfield(cj, ci, hs, { x: ci * c, y: 1, z: cj * c })
      .setTranslation(cx, 0, cz)
      .setFriction(0.85);
    const col = this.world.createCollider(desc, this.body);
    this.handles.add(col.handle);
    return col;
  }

  /** Ground height at a point (bilinear over the grid; 0 outside it). */
  heightAt(x: number, z: number): number {
    const fx = (x - TERRAIN_GRID.x0) / TERRAIN_GRID.cell;
    const fz = (z - TERRAIN_GRID.z0) / TERRAIN_GRID.cell;
    if (fx < 0 || fz < 0 || fx >= this.nx - 1 || fz >= this.nz - 1) return 0;
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const a = this.h[j * this.nx + i], b = this.h[j * this.nx + i + 1];
    const c = this.h[(j + 1) * this.nx + i], d = this.h[(j + 1) * this.nx + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Dig a bowl with a low rim. Returns true if anything changed. */
  crater(x: number, z: number, radius: number, depth: number): boolean {
    for (const r of NO_DIG) if (x > r.x0 - radius && x < r.x1 + radius && z > r.z0 - radius && z < r.z1 + radius) return false;
    const c = TERRAIN_GRID.cell;
    const rim = radius * 1.35;
    const i0 = Math.max(0, Math.floor((x - rim - TERRAIN_GRID.x0) / c));
    const i1 = Math.min(this.nx - 1, Math.ceil((x + rim - TERRAIN_GRID.x0) / c));
    const j0 = Math.max(0, Math.floor((z - rim - TERRAIN_GRID.z0) / c));
    const j1 = Math.min(this.nz - 1, Math.ceil((z + rim - TERRAIN_GRID.z0) / c));
    if (i0 > i1 || j0 > j1) return false;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = TERRAIN_GRID.x0 + i * c, pz = TERRAIN_GRID.z0 + j * c;
        const d = dsqrt((px - x) * (px - x) + (pz - z) * (pz - z));
        const k = j * this.nx + i;
        if (d < radius) {
          const f = 1 - (d * d) / (radius * radius);
          const nh = this.h[k] - depth * f;
          this.h[k] = nh < MIN_H ? MIN_H : nh;
        } else if (d < rim) {
          const t = (d - radius) / (rim - radius); // 0 at the bowl edge, 1 outside
          this.h[k] += depth * 0.22 * (1 - t) * t * 4;
        }
      }
    }
    const patch = new Float32Array((i1 - i0 + 1) * (j1 - j0 + 1));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) patch[(j - j0) * (i1 - i0 + 1) + (i - i0)] = this.h[j * this.nx + i];
    this.patches.push({ i0, j0, ni: i1 - i0 + 1, nj: j1 - j0 + 1, h: patch });
    this.navDirty.push(i0, j0, i1, j1);
    // Every tile that holds a changed vertex (tiles share their edge vertices).
    for (let tj = Math.floor(Math.max(0, j0 - 1) / TILE); tj <= Math.min(this.tilesZ - 1, Math.floor(j1 / TILE)); tj++)
      for (let ti = Math.floor(Math.max(0, i0 - 1) / TILE); ti <= Math.min(this.tilesX - 1, Math.floor(i1 / TILE)); ti++) this.dirty.add(tj * this.tilesX + ti);
    return true;
  }

  /** Rebuild changed tiles, in tile order. Call once per tick, before the physics step. */
  rebuild() {
    if (!this.dirty.size) return;
    const list = [...this.dirty].sort((a, b) => a - b);
    this.dirty.clear();
    for (const t of list) {
      const old = this.colliders[t];
      this.handles.delete(old.handle);
      this.world.removeCollider(old, false);
      this.colliders[t] = this.buildTile(t);
    }
  }

  /** The whole grid as one patch (for a renderer that starts late). */
  fullPatch(): TerrainPatch {
    return { i0: 0, j0: 0, ni: this.nx, nj: this.nz, h: this.h.slice() };
  }
}
