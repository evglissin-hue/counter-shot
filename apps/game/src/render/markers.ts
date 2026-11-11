// The midfield markers: a stake with a pennant in each team's colour where its
// waves stop on the Hold order, one per route, a few metres short of that
// route's bridge on the team's own side, beside the route so the files walk
// past it. Render only (the sim's hold lines are in @keepfall/content).

import * as THREE from "three/webgpu";
import { holdMarker, ROUTE_HALF, ROUTE_NAMES, valleyHeight } from "@keepfall/content";
import { TEAM_COLORS } from "./minions";
import { applyCloudShadow } from "./clouds";

export class Markers {
  readonly root = new THREE.Group();
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  constructor() {
    this.root.name = "midfield-markers";
    this.root.visible = false;
    const pole = new THREE.CylinderGeometry(0.035, 0.05, 2.6, 6, 1);
    pole.deleteAttribute("uv");
    pole.translate(0, 1.3, 0);
    // A swallow-tailed pennant off the top of the pole.
    const flag = new THREE.BufferGeometry();
    flag.setAttribute("position", new THREE.Float32BufferAttribute([0, 2.55, 0, 0.95, 2.48, 0, 0.62, 2.31, 0, 0, 2.55, 0, 0.62, 2.31, 0, 0.95, 2.14, 0, 0, 2.55, 0, 0.95, 2.14, 0, 0, 2.07, 0], 3));
    flag.computeVertexNormals();
    this.geos.push(pole, flag);
    const wood = new THREE.MeshStandardNodeMaterial();
    applyCloudShadow(wood);
    wood.color = new THREE.Color(0x4f4840);
    wood.roughness = 0.85;
    this.mats.push(wood);
    for (const team of [0, 1] as const) {
      const cloth = new THREE.MeshStandardNodeMaterial();
      applyCloudShadow(cloth);
      cloth.color = new THREE.Color(TEAM_COLORS[team]);
      cloth.roughness = 0.9;
      cloth.side = THREE.DoubleSide;
      this.mats.push(cloth);
      // Each team's marker stands on its own right of the route (team 1 faces +z, so its right is -x).
      const right = team === 1 ? -1 : 1;
      for (const r of ROUTE_NAMES) {
        const m = holdMarker(team, r);
        const x = m.x + right * (ROUTE_HALF[r] + 1.2);
        const g = new THREE.Group();
        g.name = `marker-${team}-${r}`;
        g.position.set(x, valleyHeight(x, m.z) - 0.05, m.z);
        // The pennant flies out across the route.
        g.rotation.y = team === 1 ? Math.PI : 0;
        const p = new THREE.Mesh(pole, wood);
        const f = new THREE.Mesh(flag, cloth);
        p.castShadow = f.castShadow = true;
        g.add(p, f);
        this.root.add(g);
      }
    }
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
