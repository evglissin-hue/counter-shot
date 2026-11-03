// Camera views: the first-person cannon view, an orbit view around the enemy
// castle, and a deterministic flyover loop for the benchmark.

import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CastleLayout } from "../core/castle";
import { dcos, dsin } from "../core/detmath";
import { groundHeight } from "./terrain";

export type ViewMode = "cannon" | "orbit" | "flyover";

export const FLYOVER_PERIOD = 12;
const FLY_R = 45;
const FLY_H = 16;
const TARGET = new THREE.Vector3(0, 6, 0);

export class Views {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  mode: ViewMode = "cannon";
  private layout: CastleLayout | null = null;
  private flyT = 0;
  /** Field of view of the cannon sight; the page zooms it with the scroll wheel. */
  private cannonFov = 30;

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 9000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 190;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.target.copy(TARGET);
    this.controls.zoomSpeed = 0.8;
    this.controls.rotateSpeed = 0.6;
    this.camera.position.set(-38, 24, -50);
    this.camera.lookAt(TARGET);
  }

  setLayout(layout: CastleLayout) {
    this.layout = layout;
    if (this.mode === "cannon") this.applyCannon();
  }

  setMode(mode: ViewMode) {
    this.mode = mode;
    this.controls.enabled = mode === "orbit";
    if (mode === "cannon") this.applyCannon();
    else if (mode === "orbit") {
      this.camera.fov = 50;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(36, 21, -46);
      this.controls.target.copy(TARGET);
      this.controls.update();
    } else this.setFlyoverTime(this.flyT);
  }

  private applyCannon() {
    const c = this.layout ? this.layout.cannon : { x: 0, y: 9.7, z: -133.6 };
    this.camera.fov = this.cannonFov;
    this.camera.updateProjectionMatrix();
    // Over the right shoulder, so the shot's arc reads as a curve.
    this.camera.position.set(c.x - 3.0, c.y + 2.6, c.z - 6.0);
    this.camera.lookAt(0, 6.5, 0);
  }

  /** Zoom the cannon sight: factor below 1 zooms in. */
  zoomCannon(factor: number) {
    this.cannonFov = Math.max(12, Math.min(55, this.cannonFov * factor));
    if (this.mode === "cannon") {
      this.camera.fov = this.cannonFov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Smooth closed loop (period 12 s) around the enemy castle. Same t, same camera. */
  setFlyoverTime(t: number) {
    this.flyT = t;
    if (this.mode !== "flyover") return;
    const a = ((t % FLYOVER_PERIOD) / FLYOVER_PERIOD) * 2 * Math.PI;
    const x = -FLY_R * dsin(a);
    const z = -FLY_R * dcos(a);
    const y = FLY_H + 2.5 * dsin(2 * a + 0.6);
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 7, 0);
  }

  update() {
    if (this.mode === "orbit") {
      this.controls.update();
      // Never below the ground.
      const p = this.camera.position;
      const g = groundHeight(p.x, p.z) + 1.5;
      if (p.y < g) {
        p.y = g;
        this.camera.lookAt(this.controls.target);
      }
    }
  }

  dispose() {
    this.controls.dispose();
  }
}
