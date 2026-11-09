// Camera control for the poses the page asks for: the weapon sight (position
// and aim follow at once, only the field of view eases), a free orbit
// overview of both castles, a chase camera behind a projectile, and a free
// camera the page places itself (the mortar's spotter and its ride).

import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CameraPose } from "./api";

/** Midpoint between the castles: the overview orbits around it. */
const OVERVIEW_TARGET = new THREE.Vector3(0, 2, -75);
/** From over the player's left flank: both castles, the stream and its three bridges, the valley sides. */
const OVERVIEW_START = new THREE.Vector3(128, 96, -142);
/** Where the overview may look: the valley and a margin round it. */
const TARGET_BOX = { x0: -120, x1: 120, y0: -2, y1: 40, z0: -260, z1: 110 };
const OVERVIEW_FOV = 45;
const FOLLOW_FOV = 55;

export type HeightFn = (x: number, z: number) => number;

export class Views {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  mode: CameraPose["mode"] = "overview";
  private height: HeightFn;
  private fovTarget = OVERVIEW_FOV;
  /** The user's orbit, kept while the camera is elsewhere. */
  private orbitPos = OVERVIEW_START.clone();
  private orbitTarget = OVERVIEW_TARGET.clone();
  /** Chase camera: offsets from the projectile, eased towards their targets. */
  private follow = { at: new THREE.Vector3(), off: new THREE.Vector3(), look: new THREE.Vector3(), wantOff: new THREE.Vector3(), wantLook: new THREE.Vector3(), primed: false };
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, height: HeightFn) {
    this.height = height;
    this.camera = new THREE.PerspectiveCamera(OVERVIEW_FOV, 16 / 9, 0.3, 9000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 420;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.zoomSpeed = 0.8;
    this.controls.rotateSpeed = 0.6;
    this.controls.panSpeed = 0.7;
    this.controls.target.copy(OVERVIEW_TARGET);
    this.camera.position.copy(OVERVIEW_START);
    this.camera.lookAt(OVERVIEW_TARGET);
    this.controls.update();
  }

  /**
   * M5: whose castle the overview starts behind: team 1's (the castle at
   * z = -150, the default) or team 0's, the same view turned through the
   * middle of the field (the valley is point symmetric). Resets the orbit.
   */
  setSide(team: 0 | 1) {
    const s = OVERVIEW_START;
    if (team === 1) this.orbitPos.copy(s);
    else this.orbitPos.set(-s.x, s.y, -150 - s.z);
    this.orbitTarget.copy(OVERVIEW_TARGET);
    if (this.mode === "overview") {
      this.camera.position.copy(this.orbitPos);
      this.controls.target.copy(this.orbitTarget);
      this.camera.lookAt(this.orbitTarget);
      this.controls.update();
    }
  }

  setPose(pose: CameraPose) {
    const cam = this.camera;
    const was = this.mode;
    if (was === "overview" && pose.mode !== "overview") {
      this.orbitPos.copy(cam.position);
      this.orbitTarget.copy(this.controls.target);
    }
    this.mode = pose.mode;
    this.controls.enabled = pose.mode === "overview";
    if (pose.mode === "sight") {
      // Aim is rate limited by the page already: follow it exactly, ease the zoom only.
      this.fovTarget = pose.fov;
      if (was !== "sight") this.setFov(pose.fov);
      cam.position.set(pose.x, pose.y, pose.z);
      const cp = Math.cos(pose.pitch);
      this.tmp.set(pose.x + Math.sin(pose.yaw) * cp, pose.y + Math.sin(pose.pitch), pose.z + Math.cos(pose.yaw) * cp);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.tmp);
    } else if (pose.mode === "free") {
      // The page places and smooths this camera itself; only the zoom eases here.
      this.fovTarget = pose.fov;
      if (was !== "free" && was !== "sight") this.setFov(pose.fov);
      cam.position.set(pose.x, pose.y, pose.z);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.tmp.set(pose.tx, pose.ty, pose.tz));
    } else if (pose.mode === "overview") {
      this.fovTarget = OVERVIEW_FOV;
      if (was !== "overview") {
        this.setFov(OVERVIEW_FOV);
        cam.position.copy(this.orbitPos);
        this.controls.target.copy(this.orbitTarget);
        cam.lookAt(this.orbitTarget);
        this.controls.update();
      }
    } else {
      this.fovTarget = FOLLOW_FOV;
      const f = this.follow;
      // Behind and above the projectile, looking along its flight.
      const v = this.tmp.set(pose.vx, pose.vy, pose.vz);
      const speed = v.length();
      if (speed > 0.01) v.multiplyScalar(1 / speed);
      else v.set(0, 0, 1);
      const back = Math.min(9, 4 + speed * 0.05);
      const want = this.tmp2.set(pose.x - v.x * back, pose.y - v.y * back + 2.2, pose.z - v.z * back);
      const ground = this.height(want.x, want.z) + 0.8;
      if (want.y < ground) want.y = ground;
      f.at.set(pose.x, pose.y, pose.z);
      f.wantOff.copy(want).sub(f.at);
      f.wantLook.set(v.x * 6, v.y * 6, v.z * 6);
      if (was !== "follow" || !f.primed) {
        // Start from where the camera is, so the switch eases in.
        f.off.copy(cam.position).sub(f.at);
        cam.getWorldDirection(this.tmp2);
        f.look.copy(cam.position).addScaledVector(this.tmp2, 20).sub(f.at);
        f.primed = true;
      }
    }
  }

  private setFov(fov: number) {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number) {
    const cam = this.camera;
    if (Math.abs(cam.fov - this.fovTarget) > 0.01) {
      const k = 1 - Math.exp(-dt * 8);
      this.setFov(cam.fov + (this.fovTarget - cam.fov) * k);
    }
    if (this.mode === "overview") {
      // Keep the orbit's centre over the valley, however far it is panned.
      const t = this.controls.target, b = TARGET_BOX;
      const cx = Math.min(b.x1, Math.max(b.x0, t.x)), cy = Math.min(b.y1, Math.max(b.y0, t.y)), cz = Math.min(b.z1, Math.max(b.z0, t.z));
      if (cx !== t.x || cy !== t.y || cz !== t.z) {
        cam.position.x += cx - t.x;
        cam.position.y += cy - t.y;
        cam.position.z += cz - t.z;
        t.set(cx, cy, cz);
      }
      this.controls.update();
      // Never below the ground.
      const p = cam.position;
      const g = this.height(p.x, p.z) + 1.5;
      if (p.y < g) {
        p.y = g;
        cam.lookAt(this.controls.target);
      }
    } else if (this.mode === "follow") {
      const f = this.follow;
      if (f.primed) {
        const k = 1 - Math.exp(-dt * 6);
        f.off.lerp(f.wantOff, k);
        f.look.lerp(f.wantLook, 1 - Math.exp(-dt * 8));
        cam.position.copy(f.at).add(f.off);
        const g = this.height(cam.position.x, cam.position.z) + 0.6;
        if (cam.position.y < g) cam.position.y = g;
        cam.up.set(0, 1, 0);
        cam.lookAt(this.tmp.copy(f.at).add(f.look));
      }
    }
    if (this.mode !== "follow") this.follow.primed = false;
  }

  dispose() {
    this.controls.dispose();
  }
}
