// The lab's 3D renderer: Three.js WebGPU renderer (falls back to WebGL2),
// three art styles on one scene and four quality tiers.
//
// Call order: init(), setLayout(), setStyle(), setQuality(), resize(), then
// render(dt) every frame. setStyle/setQuality may be called at any time.

import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import type { CastleLayout } from "../core/castle";
import { FIELD } from "../core/castle";
import { Effects } from "./effects";
import { Flags } from "./flags";
import { getNoiseTexture } from "./noiseTexture";
import { Post, TIERS, type QualityTier } from "./post";
import { Scatter } from "./scatter";
import { fitShadowCamera, makeSoftShadowFilter } from "./shadows";
import { Sky } from "./sky";
import { SHADOW_LAYER, StoneSet } from "./stones";
import { STYLES, type StyleName } from "./styles";
import { Terrain, groundHeight } from "./terrain";
import { Views, type ViewMode } from "./views";

export type { StyleName } from "./styles";
export type { QualityTier } from "./post";
export type { ViewMode } from "./views";

export interface RenderStats {
  backend: "WebGPU" | "WebGL2";
  gpuMs: number | null;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
  width: number;
  height: number;
}

export class LabRenderer {
  private canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGPURenderer;
  private backend: "WebGPU" | "WebGL2" = "WebGL2";
  private scene = new THREE.Scene();
  private views: Views;
  private hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  private fill = new THREE.DirectionalLight(0xffffff, 0.5);
  private suns = new Map<QualityTier, THREE.DirectionalLight>();
  private sun: THREE.DirectionalLight | null = null;
  private sky: Sky;
  private terrain: Terrain;
  private scatter: Scatter;
  private effects: Effects;
  private stones: StoneSet | null = null;
  private flags: Flags | null = null;
  private post: Post | null = null;
  private noise: THREE.Texture;
  private time = uniform(0);
  private now = 0;
  private styleName: StyleName = "warm";
  private tier: QualityTier = "high";
  private pixelRatio = 1;
  private gpuMs: number | null = null;
  private timingPending = false;
  private canTime = false;
  private lastDraw = 0;
  private lastTris = 0;
  private initialized = false;
  private postDirty = true;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // Everything that does not need the GPU is built here, so every API call
    // is safe before init() resolves.
    this.noise = getNoiseTexture();
    this.views = new Views(this.canvas);
    this.sky = new Sky(this.noise);
    this.scene.add(this.sky.mesh);
    this.scene.add(this.hemi);
    this.fill.castShadow = false;
    this.scene.add(this.fill, this.fill.target);
    this.scene.fogNode = this.sky.fogNode();
    this.terrain = new Terrain(this.noise, this.sky, this.time);
    this.scene.add(this.terrain.ground, this.terrain.mountains, this.terrain.water);
    this.scatter = new Scatter(this.noise, this.time, this.sky.sunDir);
    this.scene.add(this.scatter.root);
    this.effects = new Effects(this.time, this.sky.sunDir, this.noise);
    this.scene.add(this.effects.root);
  }

  /** Called if the graphics device is lost after init. */
  onDeviceLost: ((message: string) => void) | null = null;

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
    this.applyStyle();
    this.resize();
    return { backend: this.backend };
  }

  setLayout(layout: CastleLayout): void {
    if (this.stones) {
      this.scene.remove(this.stones.root);
      this.stones.dispose();
    }
    if (this.flags) {
      this.scene.remove(this.flags.mesh);
      this.flags.dispose();
    }
    this.stones = new StoneSet(layout, this.noise);
    this.flags = new Flags(layout, this.time, this.noise);
    this.scene.add(this.stones.root, this.flags.mesh);
    this.views.setLayout(layout);
    const c = layout.cannon;
    this.effects.bias.set(c.x, 0, c.z);
    const style = STYLES[this.styleName];
    this.stones.setStyle(style);
    this.flags.setStyle(style);
  }

  updateBodies(data: Float32Array, count: number): void {
    this.stones?.updateBodies(data, count);
  }

  resetStones(): void {
    this.stones?.resetStones();
  }

  setBalls(data: Float32Array, count: number): void {
    this.effects.setBalls(data, count);
  }

  spawnImpact(x: number, y: number, z: number, strength: number): void {
    // Debris is thrown back towards the shooter (the player's castle).
    const b = this.effects.bias;
    const cz = this.stones ? this.stones.layout.cannon.z : -133;
    b.set(0 - x, 0, cz - z);
    this.effects.spawnImpact(x, y, z, strength);
  }

  setAimArc(points: Float32Array | null): void {
    this.effects.setAimArc(points);
  }

  setGhostTrail(points: Float32Array | null): void {
    this.effects.setGhostTrail(points);
  }

  setStyle(style: StyleName): void {
    if (!(style in STYLES)) return;
    this.styleName = style;
    if (this.initialized) this.applyStyle();
  }

  setQuality(tier: QualityTier): void {
    if (!(tier in TIERS)) return;
    this.tier = tier;
    if (this.initialized) {
      this.applyQuality();
      this.applyStyle();
      this.resize();
    }
  }

  setView(mode: ViewMode): void {
    this.views.setMode(mode);
  }

  /** Zoom the cannon sight (factor below 1 zooms in). No effect in other views. */
  zoom(factor: number): void {
    this.views.zoomCannon(factor);
  }

  setFlyoverTime(t: number): void {
    this.views.setFlyoverTime(t);
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
      const t = this.stones.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 0);
      if (t >= 0) best = t;
    }
    const tg = this.pickGround(o, d, best);
    if (tg >= 0 && tg < best) best = tg;
    if (best === Infinity) return null;
    return { x: o.x + d.x * best, y: o.y + d.y * best, z: o.z + d.z * best };
  }

  private pickGround(o: THREE.Vector3, d: THREE.Vector3, maxT: number): number {
    // Flat field first.
    if (d.y < 0) {
      const t = -o.y / d.y;
      const x = o.x + d.x * t, z = o.z + d.z * t;
      if (x >= FIELD.x0 && x <= FIELD.x1 && z >= FIELD.z0 && z <= FIELD.z1 && o.y >= 0) return t;
    }
    // March the hills.
    const limit = Math.min(maxT, 2500);
    let t = 0;
    let prevT = 0;
    if (o.y - groundHeight(o.x, o.z) < 0) return 0;
    while (t < limit) {
      const step = Math.max(0.5, t * 0.02);
      t = Math.min(limit, t + step);
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const h = y - groundHeight(x, z);
      if (h < 0) {
        let a = prevT, b = t;
        for (let i = 0; i < 24; i++) {
          const m = (a + b) / 2;
          const hm = o.y + d.y * m - groundHeight(o.x + d.x * m, o.z + d.z * m);
          if (hm > 0) a = m;
          else b = m;
        }
        return (a + b) / 2;
      }
      prevT = t;
    }
    return -1;
  }

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
    this.views.update();
    const cam = this.views.camera;
    this.sky.follow(cam);
    if (this.stones) {
      this.stones.flush();
      this.flags?.update(this.stones);
    }
    const post = this.post!;
    if (this.postDirty) {
      post.build(this.scene, cam, TIERS[this.tier], STYLES[this.styleName]);
      this.postDirty = false;
    }
    this.renderer.info.reset();
    post.render(this.now);
    this.lastDraw = this.renderer.info.render.drawCalls;
    this.lastTris = this.renderer.info.render.triangles;
    if (this.canTime && !this.timingPending) {
      this.timingPending = true;
      this.renderer
        .resolveTimestampsAsync(THREE.TimestampQuery.RENDER)
        .then((ms) => {
          if (typeof ms === "number" && ms > 0) this.gpuMs = ms;
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
    this.terrain?.dispose();
    this.scatter?.dispose();
    this.effects?.dispose();
    this.views?.dispose();
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

  private applyStyle() {
    const style = STYLES[this.styleName];
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
