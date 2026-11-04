// The sandbox renderer: Three.js WebGPU renderer (falls back to WebGL2), the
// Gritty look only (SPEC section 13), four quality tiers. It draws what the
// page tells it (see api.ts) and makes no game or physics decisions.
//
// Call order: init(), setLayout(), setQuality(), resize(), then applyFrame()
// and render(dt) every frame. Every call is safe before init() resolves.

import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import type { CastleLayout, Emplacement } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, type FrameData, type TerrainPatch } from "@keepfall/sim";
import type { CameraPose, GameRendererApi, QualityTier, RenderStats } from "./api";
import { Burst } from "./bursts";
import { ClearView } from "./clearview";
import { Decals } from "./decals";
import { Effects } from "./effects";
import { Flags } from "./flags";
import { Guns } from "./guns";
import { Minions } from "./minions";
import { getNoiseTexture } from "./noiseTexture";
import { Post, TIERS } from "./post";
import { Projectiles } from "./projectiles";
import { Scatter } from "./scatter";
import { fitShadowCamera, makeSoftShadowFilter } from "./shadows";
import { Sky } from "./sky";
import { SHADOW_LAYER, StoneSet } from "./stones";
import { GRITTY } from "./styles";
import { Terrain } from "./terrain";
import { Views } from "./views";

export type { CameraPose, GameRendererApi, QualityTier, RenderStats } from "./api";

const STYLE = GRITTY;

export class GameRenderer implements GameRendererApi {
  private canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGPURenderer;
  private backend: "WebGPU" | "WebGL2" = "WebGL2";
  private scene = new THREE.Scene();
  private views: Views;
  private hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  private fill = new THREE.DirectionalLight(0xffffff, 0.5);
  private suns = new Map<QualityTier, THREE.DirectionalLight>();
  private sun: THREE.DirectionalLight | null = null;
  /** One pooled light for muzzle flashes and explosions. */
  private flash = new THREE.PointLight(0xffa860, 0, 45, 2);
  private flashLevel = 0;
  private sky: Sky;
  private terrain: Terrain;
  private scatter: Scatter;
  private effects: Effects;
  private projectiles: Projectiles;
  private minions: Minions;
  private guns: Guns;
  private decals: Decals;
  private bursts: Record<"flash" | "fire" | "smoke" | "muzzleSmoke" | "dust" | "spray" | "trickle", Burst>;
  private clear = new ClearView();
  /** Per stone: last reported position and tick, and when it last shed dust (rule 5). */
  private prevPos = new Float32Array(0);
  private prevTick = new Int32Array(0);
  private lastTrickle = new Float32Array(0);
  private normal = [0, 0, 0];
  private marker: THREE.Group;
  private markerOn = false;
  private stones: StoneSet | null = null;
  private flags: Flags | null = null;
  private layout: CastleLayout | null = null;
  private post: Post | null = null;
  private noise: THREE.Texture;
  private time = uniform(0);
  private wind = uniform(new THREE.Vector2(0, 0));
  private now = 0;
  private gore = true;
  private tier: QualityTier = "high";
  private pixelRatio = 1;
  private gpuMs: number | null = null;
  private timingPending = false;
  private canTime = false;
  private framesSinceResolve = 0;
  private lastDraw = 0;
  private lastTris = 0;
  private initialized = false;
  private postDirty = true;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private seed = 1;

  onDeviceLost: ((message: string) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // Everything that does not need the GPU is built here, so every API call
    // is safe before init() resolves.
    this.noise = getNoiseTexture();
    this.sky = new Sky(this.noise);
    this.scene.add(this.sky.mesh);
    this.scene.add(this.hemi);
    this.fill.castShadow = false;
    this.scene.add(this.fill, this.fill.target);
    this.flash.castShadow = false;
    this.scene.add(this.flash);
    this.scene.fogNode = this.sky.fogNode();
    this.terrain = new Terrain(this.noise, this.sky, this.time);
    this.scene.add(this.terrain.ground, this.terrain.field, this.terrain.mountains, this.terrain.water);
    this.views = new Views(canvas, (x, z) => this.terrain.heightAt(x, z));
    this.scatter = new Scatter(this.noise, this.time, this.sky.sunDir);
    this.scene.add(this.scatter.root);
    this.effects = new Effects(this.time, this.sky.sunDir, this.noise);
    this.effects.clear = this.clear;
    this.scene.add(this.effects.root);
    this.projectiles = new Projectiles(STYLE, this.time, this.noise);
    this.scene.add(this.projectiles.root);
    this.minions = new Minions();
    this.scene.add(this.minions.root);
    this.guns = new Guns(this.noise);
    this.scene.add(this.guns.root);
    this.decals = new Decals(this.time, this.noise);
    this.scene.add(this.decals.mesh);
    const mk = (cfg: ConstructorParameters<typeof Burst>[0]) => {
      const b = new Burst(cfg, this.time, this.wind, this.sky.sunDir, this.noise, this.clear);
      this.scene.add(b.mesh);
      return b;
    };
    this.bursts = {
      flash: mk({ name: "flash", slots: 12, per: 8, life: [0.08, 0.18], color: 0xffd9a0, colorEnd: 0xff7a2a, additive: true, glow: 4, speed: [1, 5], size: [0.5, 1.3], grow: 12, gravity: 0, rise: 0, drag: 8, windScale: 0, spread: 0.6, opacity: 1, floor: false }),
      fire: mk({ name: "fire", slots: 8, per: 18, life: [0.35, 0.8], color: 0xffb060, colorEnd: 0x8a2a0a, additive: true, glow: 2.6, speed: [2, 7], size: [0.4, 1.2], grow: 4, gravity: 0, rise: 1.5, drag: 4, windScale: 0.2, spread: 1.2, opacity: 0.85, floor: true }),
      smoke: mk({ name: "smoke", slots: 10, per: 26, life: [4.5, 7.5], color: 0x232120, colorEnd: 0x383633, additive: false, glow: 1, speed: [1.5, 5], size: [0.6, 2.0], grow: 0.8, gravity: 0, rise: 1.0, drag: 1.6, windScale: 0.6, spread: 1.0, opacity: 0.85, floor: true, lighting: 0.3, clearAim: true }),
      muzzleSmoke: mk({ name: "muzzle", slots: 10, per: 18, life: [2.5, 4.5], color: 0x8f8c87, additive: false, glow: 1, speed: [3, 14], size: [0.4, 2.4], grow: 1.1, gravity: 0, rise: 0.5, drag: 2.2, windScale: 0.7, spread: 0.35, opacity: 0.42, floor: true, clearAim: true }),
      dust: mk({ name: "dust", slots: 16, per: 8, life: [1.2, 2.2], color: 0x7a6e5f, additive: false, glow: 1, speed: [0.5, 2], size: [0.2, 0.8], grow: 2, gravity: 0, rise: 0.3, drag: 3, windScale: 0.4, spread: 1, opacity: 0.55, floor: true, clearAim: true }),
      trickle: mk({ name: "trickle", slots: 32, per: 6, life: [1.2, 2.2], color: 0x8a8174, additive: false, glow: 1, speed: [0.1, 0.4], size: [0.06, 0.3], grow: 1.5, gravity: 0, rise: -1.6, drag: 2, windScale: 0.3, spread: 0.6, opacity: 0.5, floor: true, clearAim: true }),
      spray: mk({ name: "spray", slots: 24, per: 14, life: [0.5, 0.9], color: 0x2c0d0a, additive: false, glow: 0.6, speed: [1.5, 4.5], size: [0.06, 0.12], grow: 3, gravity: 9.8, rise: 0, drag: 1, windScale: 0, spread: 0.9, opacity: 0.95, floor: true }),
    };
    this.marker = this.buildMarker();
    this.scene.add(this.marker);
  }

  async init(opts: { forceWebGL?: boolean } = {}): Promise<{ backend: "WebGPU" | "WebGL2" }> {
    const renderer = new THREE.WebGPURenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      forceWebGL: opts.forceWebGL === true,
      trackTimestamp: true,
      powerPreference: "high-performance",
    } as ConstructorParameters<typeof THREE.WebGPURenderer>[0]);
    await renderer.init();
    // Tell the page when the graphics device is lost (driver reset, GPU switch) so it can offer WebGL2.
    renderer.onDeviceLost = (info: { message?: string }) => {
      this.onDeviceLost?.(info?.message || "unknown reason");
    };
    this.renderer = renderer;
    const backendAny = renderer.backend as unknown as { isWebGPUBackend?: boolean };
    this.backend = backendAny.isWebGPUBackend ? "WebGPU" : "WebGL2";
    this.canTime = renderer.hasFeature("timestamp-query");
    renderer.info.autoReset = false;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 1);
    this.post = new Post(renderer);
    this.initialized = true;
    this.applyQuality();
    this.applyLook();
    this.resize();
    return { backend: this.backend };
  }

  setLayout(layout: CastleLayout, emplacements: Emplacement[]): void {
    if (this.stones) {
      this.scene.remove(this.stones.root);
      this.stones.dispose();
    }
    if (this.flags) {
      this.scene.remove(this.flags.mesh);
      this.flags.dispose();
    }
    this.layout = layout;
    this.stones = new StoneSet(layout, this.noise);
    const n = layout.stones.length;
    this.prevPos = new Float32Array(n * 3);
    this.prevTick = new Int32Array(n).fill(-1);
    this.lastTrickle = new Float32Array(n).fill(-100);
    this.flags = new Flags(layout, this.time, this.noise);
    this.scene.add(this.stones.root, this.flags.mesh);
    this.stones.setStyle(STYLE);
    this.flags.setStyle(STYLE);
    this.guns.build(layout, emplacements);
  }

  setQuality(tier: QualityTier): void {
    if (!(tier in TIERS)) return;
    this.tier = tier;
    if (this.initialized) {
      this.applyQuality();
      this.applyLook();
      this.resize();
    }
  }

  setGore(on: boolean): void {
    this.gore = on;
    this.minions.setGore(on);
    this.decals.mesh.visible = on && (this.decals.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount > 0;
  }

  // --- per frame data ---------------------------------------------------------

  applyFrame(frame: FrameData): void {
    if (this.stones && frame.stoneCount > 0) {
      this.stones.updateBodies(frame.stones, frame.stoneCount);
      this.trickleDust(frame.stones, frame.stoneCount, frame.tick);
    }
    this.projectiles.update(frame.projectiles, frame.projectileCount, frame.chains, frame.chainCount);
    this.minions.update(frame.minions, frame.minionCount, frame.parts, frame.partCount);
    if (frame.terrain && frame.terrain.length > 0) this.terrain.applyPatches(frame.terrain);
    this.wind.value.set(frame.windX || 0, frame.windZ || 0);
    this.effects.wind.value.set(frame.windX || 0, frame.windZ || 0);
    this.flags?.setWind(frame.windX || 0, frame.windZ || 0);
    const ev = frame.events;
    for (let i = 0; i < frame.eventCount; i++) {
      const o = i * EVENT_STRIDE;
      const kind = ev[o];
      const x = ev[o + 1], y = ev[o + 2], z = ev[o + 3], v = ev[o + 4];
      if (kind === EventKind.Impact) this.spawnImpact(x, y, z, v);
      else if (kind === EventKind.Explosion) this.spawnExplosion(x, y, z, v);
      else if (kind === EventKind.Muzzle) this.spawnMuzzle(x | 0);
      else if (kind === EventKind.Blood) this.spawnBlood(x, y, z, v);
      // EventKind.Landed: the page handles the landing marker.
    }
  }

  applyTerrain(patches: TerrainPatch[]): void {
    this.terrain.applyPatches(patches);
  }

  resetWorld(): void {
    this.stones?.resetStones();
    this.prevTick.fill(-1);
    this.lastTrickle.fill(-100);
    this.terrain.resetHeights();
    this.decals.clear();
    this.minions.clear();
    for (const b of Object.values(this.bursts)) b.clear();
  }

  /** Readability rule 5: slow-moving masonry (settling, about to go) sheds a thin dust trickle. */
  private trickleDust(data: Float32Array, count: number, tick: number) {
    const layout = this.layout;
    if (!layout) return;
    const n = layout.stones.length;
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const o = i * 8;
      const id = data[o] | 0;
      if (id < 0 || id >= n) continue;
      const x = data[o + 1], y = data[o + 2], z = data[o + 3];
      const pt = this.prevTick[id];
      const k = id * 3;
      if (pt >= 0 && tick > pt && y > 0.8) {
        const dt = (tick - pt) / 60;
        const dx = x - this.prevPos[k], dy = y - this.prevPos[k + 1], dz = z - this.prevPos[k + 2];
        const speed = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
        if (speed > 0.03 && speed < 1.2 && this.now - this.lastTrickle[id] > 0.8 && spawned < 4) {
          this.lastTrickle[id] = this.now;
          spawned++;
          const s = layout.stones[id];
          this.bursts.trickle.spawn(this.now, x, y - s.hy * 0.9, z, 1, 0, -1, 0);
        }
      }
      this.prevPos[k] = x;
      this.prevPos[k + 1] = y;
      this.prevPos[k + 2] = z;
      this.prevTick[id] = tick;
    }
  }

  private spawnImpact(x: number, y: number, z: number, strength: number) {
    // Debris is thrown back towards the shooter (the player's castle).
    const cz = this.layout ? this.layout.castleZ[1] : -150;
    this.effects.bias.set(0 - x, 0, cz - z);
    this.effects.spawnImpact(x, y, z, strength);
  }

  private spawnExplosion(x: number, y: number, z: number, radius: number) {
    const r = Math.max(0.5, radius || 3);
    this.spawnImpact(x, y, z, 1);
    this.bursts.flash.spawn(this.now, x, y + 0.3, z, r * 0.9, 0, 0.4, 0);
    this.bursts.fire.spawn(this.now, x, y + 0.2, z, r * 0.45, 0, 0.6, 0);
    this.bursts.smoke.spawn(this.now, x, y + 0.3, z, r * 0.45, 0, 0.5, 0);
    this.pulseLight(x, y + 1.5, z, Math.min(3, r * 0.5), 0xffa860);
  }

  private spawnMuzzle(em: number) {
    const p = this.tmpA, d = this.tmpB;
    if (!this.guns.muzzle(em, p, d)) return;
    this.bursts.flash.spawn(this.now, p.x + d.x * 0.4, p.y + d.y * 0.4, p.z + d.z * 0.4, 1.2, d.x, d.y, d.z);
    this.bursts.muzzleSmoke.spawn(this.now, p.x + d.x * 0.6, p.y + d.y * 0.6, p.z + d.z * 0.6, 1, d.x, d.y, d.z);
    this.pulseLight(p.x + d.x, p.y + d.y, p.z + d.z, 1.4, 0xffb070);
  }

  private spawnBlood(x: number, y: number, z: number, strength: number) {
    const s = Math.max(0.1, Math.min(1, strength || 0.5));
    if (!this.gore) {
      // Gore off: blood becomes dust.
      this.bursts.dust.spawn(this.now, x, y, z, 0.6 + s * 0.6, 0, 0.5, 0);
      return;
    }
    this.bursts.spray.spawn(this.now, x, y, z, 0.6 + s * 0.8, 0, 0.6, 0);
    this.seed = (this.seed * 16807) % 2147483647;
    const r = this.seed / 2147483647;
    // Heavy hits on a ragdoll can take a limb off (cosmetic only).
    if (strength >= 0.8) this.minions.sever(x, y, z);
    // Masonry within reach takes a spray: the nearest stone face around the hit.
    if (this.stones && this.splashStone(x, y, z, s, r)) return;
    const gx = x + (r - 0.5) * 1.4, gz = z + (((r * 7.13) % 1) - 0.5) * 1.4;
    this.decals.add(this.now, gx, this.terrain.heightAt(gx, gz), gz, s, r);
    this.decals.mesh.visible = true;
  }

  /** Rays out from the hit (four sideways, one down, one up a little); a stone within 1.6 m gets the decal. */
  private splashStone(x: number, y: number, z: number, s: number, r: number): boolean {
    const stones = this.stones!;
    const reach = 1.6;
    const ground = y - this.terrain.heightAt(x, z);
    let best = reach, bid = -1, bdx = 0, bdy = 0, bdz = 0;
    const a0 = r * Math.PI * 2;
    const dirs: [number, number, number][] = [
      [Math.cos(a0), 0, Math.sin(a0)],
      [-Math.sin(a0), 0, Math.cos(a0)],
      [-Math.cos(a0), 0, -Math.sin(a0)],
      [Math.sin(a0), 0, -Math.cos(a0)],
      [0, -1, 0],
    ];
    for (const [dx, dy, dz] of dirs) {
      for (const c of [0, 1] as const) {
        const t = stones.raycast(x - dx * 0.05, y - dy * 0.05, z - dz * 0.05, dx, dy, dz, c);
        // Straight down, the ground wins if it is nearer.
        if (t >= 0 && t < best && !(dy < 0 && t > ground)) {
          best = t;
          bid = stones.lastHitId;
          bdx = dx;
          bdy = dy;
          bdz = dz;
        }
      }
    }
    if (bid < 0) return false;
    const hx = x + bdx * (best - 0.05), hy = y + bdy * (best - 0.05), hz = z + bdz * (best - 0.05);
    stones.faceNormal(bid, hx, hy, hz, bdx, bdy, bdz, this.normal);
    const [nx, ny, nz] = this.normal;
    this.decals.add(this.now, hx, hy, hz, s, r, nx, ny, nz, bid, stones);
    this.decals.mesh.visible = true;
    return true;
  }

  private pulseLight(x: number, y: number, z: number, level: number, hex: number) {
    this.flash.position.set(x, y, z);
    this.flash.color.setHex(hex);
    this.flashLevel = Math.max(this.flashLevel, level);
  }

  // --- weapons, camera, aim help --------------------------------------------

  setWeaponPose(emplacement: number, yaw: number, pitch: number, active: boolean): void {
    this.guns.setPose(emplacement, yaw, pitch, active);
  }

  setCamera(pose: CameraPose): void {
    this.views.setPose(pose);
    this.clear.crosshair.value = pose.mode === "sight" ? 1 : 0;
  }

  setAimArc(points: Float32Array | null): void {
    this.effects.setAimArc(points);
    this.clear.setArc(points);
  }

  setGhostTrail(points: Float32Array | null): void {
    this.effects.setGhostTrail(points);
  }

  setLandingMarker(p: { x: number; y: number; z: number } | null): void {
    this.markerOn = !!p;
    this.marker.visible = !!p;
    if (p) this.marker.position.set(p.x, Math.max(p.y, this.terrain.heightAt(p.x, p.z)) + 0.06, p.z);
  }

  /** Two flat rings: cold white over a dark outline (readability rule 4). */
  private buildMarker(): THREE.Group {
    const g = new THREE.Group();
    g.name = "landing-marker";
    const ring = (r0: number, r1: number, hex: number, order: number, opacity: number) => {
      const geo = new THREE.RingGeometry(r0, r1, 48, 1);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.MeshBasicNodeMaterial();
      m.color = new THREE.Color(hex);
      m.transparent = true;
      m.opacity = opacity;
      m.depthWrite = false;
      m.fog = false;
      m.polygonOffset = true;
      m.polygonOffsetFactor = -4;
      m.polygonOffsetUnits = -4;
      const mesh = new THREE.Mesh(geo, m);
      mesh.renderOrder = order;
      return mesh;
    };
    g.add(ring(0.72, 1.28, 0x07090b, 21, 0.75), ring(0.84, 1.16, 0xeef4ff, 22, 0.95));
    const dot = ring(0.0, 0.16, 0xeef4ff, 22, 0.95);
    g.add(dot);
    g.visible = false;
    return g;
  }

  pick(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const cam = this.views.camera;
    cam.updateMatrixWorld();
    this.ray.setFromCamera(this.ndc, cam);
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    let best = Infinity;
    if (this.stones) {
      for (const c of [0, 1] as const) {
        const t = this.stones.raycast(o.x, o.y, o.z, d.x, d.y, d.z, c);
        if (t >= 0 && t < best) best = t;
      }
    }
    const tg = this.pickGround(o, d, best);
    if (tg >= 0 && tg < best) best = tg;
    if (best === Infinity) return null;
    return { x: o.x + d.x * best, y: o.y + d.y * best, z: o.z + d.z * best };
  }

  private pickGround(o: THREE.Vector3, d: THREE.Vector3, maxT: number): number {
    const h = (x: number, z: number) => this.terrain.heightAt(x, z);
    const limit = Math.min(maxT, 2500);
    if (o.y - h(o.x, o.z) < 0) return 0;
    let t = 0;
    let prevT = 0;
    while (t < limit) {
      const step = Math.max(0.4, t * 0.015);
      t = Math.min(limit, t + step);
      const hy = o.y + d.y * t - h(o.x + d.x * t, o.z + d.z * t);
      if (hy < 0) {
        let a = prevT, b = t;
        for (let i = 0; i < 24; i++) {
          const m = (a + b) / 2;
          if (o.y + d.y * m - h(o.x + d.x * m, o.z + d.z * m) > 0) a = m;
          else b = m;
        }
        return (a + b) / 2;
      }
      prevT = t;
    }
    return -1;
  }

  // --- frame ---------------------------------------------------------------------

  resize(): void {
    if (!this.initialized) return;
    const w = Math.max(1, this.canvas.clientWidth || this.canvas.width || 1);
    const h = Math.max(1, this.canvas.clientHeight || this.canvas.height || 1);
    const t = TIERS[this.tier];
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    this.pixelRatio = Math.min(dpr, t.pixelRatioCap) * t.pixelRatioScale;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    const cam = this.views.camera;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }

  render(dtSeconds: number): void {
    if (!this.initialized) return;
    const dt = Math.max(0, Math.min(0.25, dtSeconds || 0));
    this.now += dt;
    this.time.value = this.now;
    this.sky.time.value = this.now;
    this.effects.setTime(this.now);
    this.views.update(dt);
    const cam = this.views.camera;
    cam.updateMatrixWorld();
    this.clear.update(cam);
    this.minions.step(dt, (x, z) => this.terrain.heightAt(x, z));
    this.decals.follow(this.stones, this.now);
    this.sky.follow(cam);
    if (this.stones) {
      this.stones.flush();
      this.flags?.update(this.stones, dt);
    }
    this.terrain.flush();
    this.guns.update(dt);
    // Flash light decays fast.
    this.flashLevel *= Math.exp(-dt * 14);
    if (this.flashLevel < 0.01) this.flashLevel = 0;
    this.flash.intensity = this.flashLevel * 900;
    if (this.markerOn) {
      // Keep the marker readable from far away.
      const dist = cam.position.distanceTo(this.marker.position);
      this.marker.scale.setScalar(Math.max(1, dist * 0.014));
    }
    const post = this.post!;
    if (this.postDirty) {
      post.build(this.scene, cam, TIERS[this.tier], STYLE);
      this.postDirty = false;
    }
    this.renderer.info.reset();
    post.render(this.now);
    this.lastDraw = this.renderer.info.render.drawCalls;
    this.lastTris = this.renderer.info.render.triangles;
    this.framesSinceResolve++;
    if (this.canTime && !this.timingPending) {
      this.timingPending = true;
      // The resolve covers every frame rendered since the last one: report the per-frame average.
      const frames = this.framesSinceResolve;
      this.framesSinceResolve = 0;
      this.renderer
        .resolveTimestampsAsync(THREE.TimestampQuery.RENDER)
        .then((ms) => {
          if (typeof ms === "number" && ms > 0) this.gpuMs = ms / Math.max(1, frames);
        })
        .catch(() => {})
        .finally(() => {
          this.timingPending = false;
        });
    }
  }

  getStats(): RenderStats {
    const size = this.renderer ? this.renderer.getDrawingBufferSize(new THREE.Vector2()) : new THREE.Vector2();
    return {
      backend: this.backend,
      gpuMs: this.canTime ? this.gpuMs : null,
      drawCalls: this.lastDraw,
      triangles: Math.round(this.lastTris),
      pixelRatio: this.pixelRatio,
      width: size.x,
      height: size.y,
    };
  }

  dispose(): void {
    this.post?.dispose();
    this.stones?.dispose();
    this.flags?.dispose();
    this.terrain.dispose();
    this.scatter.dispose();
    this.effects.dispose();
    this.projectiles.dispose();
    this.minions.dispose();
    this.guns.dispose();
    this.decals.dispose();
    for (const b of Object.values(this.bursts)) b.dispose();
    this.marker.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.views.dispose();
    for (const l of this.suns.values()) l.shadow.dispose();
    this.renderer?.dispose();
    this.initialized = false;
  }

  // --- internals ----------------------------------------------------------------

  private sunFor(tier: QualityTier): THREE.DirectionalLight {
    let l = this.suns.get(tier);
    if (l) return l;
    const t = TIERS[tier];
    l = new THREE.DirectionalLight(0xffffff, 3);
    l.name = `sun-${tier}`;
    l.castShadow = true;
    l.shadow.mapSize.set(t.shadowMap, t.shadowMap);
    l.shadow.bias = -0.00004;
    l.shadow.normalBias = t.shadowMap >= 4096 ? 0.035 : t.shadowMap >= 2048 ? 0.05 : 0.09;
    (l.shadow as unknown as { filterNode: unknown }).filterNode = makeSoftShadowFilter(t.shadowTaps);
    // Layer 0 (normal casters) plus the stones' shadow proxies.
    l.shadow.camera.layers.enable(0);
    l.shadow.camera.layers.enable(SHADOW_LAYER);
    this.suns.set(tier, l);
    return l;
  }

  private applyQuality() {
    const t = TIERS[this.tier];
    const l = this.sunFor(this.tier);
    if (this.sun !== l) {
      if (this.sun) {
        this.scene.remove(this.sun);
        this.scene.remove(this.sun.target);
      }
      this.sun = l;
      this.scene.add(l);
      this.scene.add(l.target);
    }
    this.scatter.setHalfDensity(t.halfTrees);
    this.postDirty = true;
  }

  /** Lights, tone mapping and materials of the Gritty look. */
  private applyLook() {
    const style = STYLE;
    const t = TIERS[this.tier];
    const r = this.renderer;
    r.toneMapping = style.toneMapping;
    r.toneMappingExposure = style.exposure;
    this.hemi.color.setHex(style.hemiSky);
    this.hemi.groundColor.setHex(style.hemiGround);
    this.hemi.intensity = style.hemiIntensity;
    // Fill from the opposite side of the sun, a little from above.
    this.fill.color.setHex(style.fillColor);
    this.fill.intensity = style.fillIntensity;
    this.fill.position.set(-style.sunDir[0] * 100, 60, -style.sunDir[2] * 100);
    this.fill.target.position.set(0, 0, 0);
    this.fill.target.updateMatrixWorld();
    const sun = this.sun!;
    sun.color.setHex(style.sunColor);
    sun.intensity = style.sunIntensity;
    const dir = new THREE.Vector3(...style.sunDir).normalize();
    fitShadowCamera(sun, dir);
    const scale = t.shadowMap / 2048;
    sun.shadow.radius = t.softShadows ? Math.max(1, style.shadowRadius * scale) : 1.0;
    (sun.shadow as unknown as { intensity: number }).intensity = style.shadowIntensity;
    this.sky.setStyle(style);
    this.terrain.setStyle(style);
    this.scatter.setStyle(style);
    this.effects.setStyle(style);
    this.stones?.setStyle(style);
    this.flags?.setStyle(style);
    this.postDirty = true;
  }
}
