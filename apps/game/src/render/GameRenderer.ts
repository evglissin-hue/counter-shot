// The sandbox renderer: Three.js WebGPU renderer (falls back to WebGL2), the
// Gritty look only (SPEC section 13), four quality tiers. It draws what the
// page tells it (see api.ts) and makes no game or physics decisions.
//
// Call order: init(), setLayout(), setQuality(), resize(), then applyFrame()
// and render(dt) every frame. Every call is safe before init() resolves.

import * as THREE from "three/webgpu";
import { float, uniform } from "three/tsl";
import type { CastleLayout, Emplacement } from "@keepfall/content";
import { EVENT_STRIDE, EventKind, type FrameData, type TerrainPatch } from "@keepfall/sim";
import { STREAM } from "@keepfall/content";
import type { CameraPose, GameRendererApi, InsetPose, InsetRect, Listener, PathHit, QualityTier, RenderStats } from "./api";
import { Burst, type FlashLight } from "./bursts";
import { Haze } from "./haze";
import { GroundMarks } from "./groundMarks";
import { ClearView } from "./clearview";
import { Decals, type DecalState } from "./decals";
import { Effects } from "./effects";
import { EstateView, type EstateState } from "./estate";
import { Flags } from "./flags";
import { Guns, type GunState } from "./guns";
import { Inset } from "./inset";
import { eventChance, frameBytes, roughBytes, type KeyframePart, type RenderKeyframe } from "./keyframe";
import { Ladders } from "./ladders";
import { Markers } from "./markers";
import { Chalk, type ChalkMark } from "./chalk";
import { Minions, type MinionsState } from "./minions";
import { MortarAim } from "./mortarAim";
import { NavOverlay } from "./navOverlay";
import { getNoiseTexture } from "./noiseTexture";
import { Post, TIERS } from "./post";
import { Projectiles } from "./projectiles";
import { Scatter } from "./scatter";
import { Shock } from "./shock";
import { Marks } from "./marks";
import { Splashes } from "./splashes";
import { fitShadowCamera, makeSoftShadowFilter } from "./shadows";
import { Sky } from "./sky";
import { SHADOW_LAYER, StoneSet } from "./stones";
import { StoneWear } from "./wear";
import { setWearChips } from "./wearShading";
import { Storm } from "./storm";
import { GRITTY } from "./styles";
import { Terrain } from "./terrain";
import { Views } from "./views";
import { CLOUDS, setCloudNoise, updateClouds } from "./clouds";
import { WindField } from "./windField";
import { GrassTufts } from "./grass";
import { Birds } from "./birds";
import { Braziers } from "./braziers";
import { Works, type WorksState } from "./works";

export type { CameraPose, GameRendererApi, InsetPose, InsetRect, Listener, PathHit, QualityTier, RenderStats } from "./api";
export type { KeyframePart, RenderKeyframe } from "./keyframe";

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
  private flash = new THREE.PointLight(0xffa860, 0, 60, 2);
  private flashLevel = 0;
  /** The flash as uniforms, so smoke and dust near it glow. */
  private flashPos = uniform(new THREE.Vector3(0, -100, 0));
  private flashGlow = uniform(0);
  /** How fast the flash light dies (1/s): fast for muzzles, slower for big bursts. */
  private flashDecay = 14;
  private sky: Sky;
  private terrain: Terrain;
  private scatter: Scatter;
  private effects: Effects;
  private projectiles: Projectiles;
  private minions: Minions;
  private guns: Guns;
  /** Where each team's waves stop on Hold. */
  private markers = new Markers();
  /** 3.2: your team's marks, as chalk crosses with their numbers. */
  private chalk = new Chalk();
  /** Ladders carried, raised and fallen (M4). */
  private ladders = new Ladders();
  /** Masons' hoists and the stones they put back (M4; built with the layout). */
  private works: Works | null = null;
  /** The ring on a courtyard being stormed (M4). */
  private storm = new Storm();
  private decals: Decals;
  private bursts: Record<"flash" | "fire" | "fireball" | "smoke" | "column" | "skirt" | "muzzleSmoke" | "dust" | "spray" | "trickle" | "chimney" | "spark" | "brazier", Burst>;
  /** M3: the plots' stakes, scaffolds and trades, set kegs; pieces rising into place (stone id -> when it started). */
  private estate = new EstateView();
  /** L3: grass tufts near the camera (High and up), crows, and braziers on the castles. */
  private grass!: GrassTufts;
  private birds!: Birds;
  private braziers!: Braziers;
  private raising = new Map<number, number>();
  private raiseBuf = new Float32Array(8);
  private shock: Shock;
  /** Water thrown up where things fall into the stream. */
  private splashes: Splashes;
  /** Team marks over minions in the overview. */
  private marks = new Marks();
  /** Slow motion for everything cosmetic (the camera keeps real time). */
  private timeScale = 1;
  /** Dynamic resolution: the share of the full resolution the scene is drawn at (the page sets it). */
  private renderScale = 1;
  private blastRing: THREE.Group;
  /** After M5: the mortar's bearing and charge ring. */
  private mortarAim = new MortarAim();
  /** The emplacements the guns were built for (where a knocked-out one falls to). */
  private emplacementList: Emplacement[] = [];
  /** Where minions can walk (debug overlay, N). */
  private navOverlay = new NavOverlay();
  /**
   * The first frames also draw, out of sight, the meshes that otherwise only
   * appear in a burst or a hit, so their shaders compile while loading rather
   * than stalling the player's first burst.
   */
  private primeFrames = 3;
  private clear = new ClearView();
  /** Per stone: last reported position and tick, and when it last shed dust (rule 5). */
  private prevPos = new Float32Array(0);
  private prevTick = new Int32Array(0);
  private lastTrickle = new Float32Array(0);
  private normal = [0, 0, 0];
  private marker: THREE.Group;
  private markerOn = false;
  private stones: StoneSet | null = null;
  /** L2: per-stone wear (fresh breaks, new stone, soot, cracks, dust). */
  private wear: StoneWear | null = null;
  private flags: Flags | null = null;
  private layout: CastleLayout | null = null;
  private post: Post | null = null;
  /** The impact cam's second pass, and what the page last asked of it (null pose: closed). */
  private inset: Inset | null = null;
  private insetPose: InsetPose | null = null;
  private insetRect: InsetRect = { x: 0, y: 0, w: 0, h: 0 };
  private insetSwapped = false;
  private readonly savedPose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 50 };
  private noise: THREE.Texture;
  private time = uniform(0);
  private wind = uniform(new THREE.Vector2(0, 0));
  /** L3: the game's wind over the land, with the coming gust's front (everything that sways reads it). */
  readonly windField: WindField;
  /** L2.5: dust that stays after a great collapse; L2.3 and L3.4: scorch, dust and trodden paths on the ground. */
  haze!: Haze;
  groundMarks!: GroundMarks;
  /** Called once per haze when it starts (x, y, z at the ground, radius, dust amount 0..1): the page wires it to the stone wear's dustAround. */
  onHazeSettle: ((x: number, y: number, z: number, radius: number, amount: number) => void) | null = null;
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
  /** S3: the parts a keyframe is made of (registration order), and the last frame applied (a keyframe re-applies it). */
  private keyParts = new Map<string, KeyframePart>();
  private lastFrame: FrameData | null = null;
  /** The tick of the frame being applied (what chance drawn from an event is keyed by). */
  private frameTick = 0;

  onDeviceLost: ((message: string) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // Everything that does not need the GPU is built here, so every API call
    // is safe before init() resolves.
    this.noise = getNoiseTexture();
    this.windField = new WindField(this.time, this.noise);
    setCloudNoise(this.noise);
    this.sky = new Sky(this.noise);
    this.scene.add(this.sky.mesh);
    this.scene.add(this.hemi);
    this.fill.castShadow = false;
    this.scene.add(this.fill, this.fill.target);
    this.flash.castShadow = false;
    this.scene.add(this.flash);
    this.scene.fogNode = this.sky.fogNode();
    this.terrain = new Terrain(this.noise, this.sky, this.time, this.windField);
    this.scene.add(this.terrain.ground, this.terrain.field, this.terrain.mountains, this.terrain.water);
    this.groundMarks = new GroundMarks(this.terrain);
    this.views = new Views(canvas, (x, z) => this.terrain.heightAt(x, z));
    this.scatter = new Scatter(this.noise, this.time, this.sky.sunDir, this.windField);
    this.scene.add(this.scatter.root);
    const glow: FlashLight = {
      at: (p) => {
        const d = (p as typeof this.flashPos).sub(this.flashPos).length();
        return this.flashGlow.div(float(1).add(d.mul(d).div(144)));
      },
    };
    this.effects = new Effects(this.time, this.sky.sunDir, this.noise);
    this.effects.clear = this.clear;
    this.effects.flash = glow;
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
      const b = new Burst(cfg, this.time, this.wind, this.sky.sunDir, this.noise, this.clear, glow);
      this.scene.add(b.mesh);
      return b;
    };
    this.bursts = {
      flash: mk({ name: "flash", slots: 12, per: 8, life: [0.08, 0.18], color: 0xffd9a0, colorEnd: 0xff7a2a, additive: true, glow: 4, speed: [1, 5], size: [0.5, 1.3], grow: 12, gravity: 0, rise: 0, drag: 8, windScale: 0, spread: 0.6, opacity: 1, floor: false }),
      fire: mk({ name: "fire", slots: 8, per: 18, life: [0.35, 0.8], color: 0xffb060, colorEnd: 0x8a2a0a, additive: true, glow: 2.6, speed: [2, 7], size: [0.4, 1.2], grow: 4, gravity: 0, rise: 1.5, drag: 4, windScale: 0.2, spread: 1.2, opacity: 0.85, floor: true }),
      // A powder burst's fireball: big, short, rolling upwards.
      fireball: mk({ name: "fireball", slots: 4, per: 18, life: [0.45, 1.0], color: 0xffd08a, colorEnd: 0x9a3010, additive: true, glow: 3.2, speed: [2, 8], size: [1.2, 3.4], grow: 5, gravity: 0, rise: 2.5, drag: 3.5, windScale: 0.1, spread: 1.0, opacity: 0.9, floor: true }),
      smoke: mk({ name: "smoke", slots: 10, per: 26, life: [4.5, 7.5], color: 0x232120, colorEnd: 0x383633, additive: false, glow: 1, speed: [1.5, 5], size: [0.6, 2.0], grow: 0.8, gravity: 0, rise: 1.0, drag: 1.6, windScale: 0.6, spread: 1.0, opacity: 0.85, floor: true, lighting: 0.3, clearAim: true }),
      // A tall column of dark smoke that leans with the wind and lingers.
      column: mk({ name: "column", slots: 4, per: 22, life: [6, 11], color: 0x1c1a18, colorEnd: 0x423e39, additive: false, glow: 1, speed: [1.5, 6], size: [1.0, 4.2], grow: 0.55, gravity: 0, rise: 3.2, drag: 1.0, windScale: 0.85, spread: 0.55, opacity: 0.82, floor: true, lighting: 0.35, clearAim: true }),
      // Dust thrown out along the ground by the blast.
      skirt: mk({ name: "skirt", slots: 4, per: 24, life: [2.2, 4.2], color: 0x857762, colorEnd: 0x9a8f80, additive: false, glow: 1, speed: [10, 22], size: [0.8, 3.2], grow: 1.4, gravity: 0, rise: 0.35, drag: 2.6, windScale: 0.5, spread: 1.0, opacity: 0.62, floor: true, lighting: 0.6, clearAim: true }),
      muzzleSmoke: mk({ name: "muzzle", slots: 10, per: 18, life: [2.5, 4.5], color: 0x8f8c87, additive: false, glow: 1, speed: [3, 14], size: [0.4, 2.4], grow: 1.1, gravity: 0, rise: 0.5, drag: 2.2, windScale: 0.7, spread: 0.35, opacity: 0.42, floor: true, clearAim: true }),
      dust: mk({ name: "dust", slots: 16, per: 8, life: [1.2, 2.2], color: 0x7a6e5f, additive: false, glow: 1, speed: [0.5, 2], size: [0.2, 0.8], grow: 2, gravity: 0, rise: 0.3, drag: 3, windScale: 0.4, spread: 1, opacity: 0.55, floor: true, clearAim: true }),
      trickle: mk({ name: "trickle", slots: 32, per: 6, life: [1.2, 2.2], color: 0x8a8174, additive: false, glow: 1, speed: [0.1, 0.4], size: [0.06, 0.3], grow: 1.5, gravity: 0, rise: -1.6, drag: 2, windScale: 0.3, spread: 0.6, opacity: 0.5, floor: true, clearAim: true }),
      spray: mk({ name: "spray", slots: 24, per: 14, life: [0.5, 0.9], color: 0x2c0d0a, additive: false, glow: 0.6, speed: [1.5, 4.5], size: [0.06, 0.12], grow: 3, gravity: 9.8, rise: 0, drag: 1, windScale: 0, spread: 0.9, opacity: 0.95, floor: true }),
      // M3: a Foundry's chimney smoke, and the sparks off a burning fuse.
      chimney: mk({ name: "chimney", slots: 40, per: 3, life: [3.5, 6], color: 0x2a2826, colorEnd: 0x56524c, additive: false, glow: 1, speed: [0.2, 0.6], size: [0.35, 1.8], grow: 0.7, gravity: 0, rise: 1.4, drag: 1.2, windScale: 0.9, spread: 0.5, opacity: 0.55, floor: true, lighting: 0.4, clearAim: true }),
      spark: mk({ name: "spark", slots: 32, per: 4, life: [0.12, 0.32], color: 0xffd28a, colorEnd: 0xff6a20, additive: true, glow: 3, speed: [0.8, 2.2], size: [0.03, 0.07], grow: 1, gravity: 4, rise: 0, drag: 2, windScale: 0, spread: 1.2, opacity: 1, floor: true }),
      // L3: a brazier's thin thread of smoke.
      brazier: mk({ name: "brazier", slots: 24, per: 2, life: [3, 5], color: 0x3a3836, colorEnd: 0x6a665f, additive: false, glow: 1, speed: [0.1, 0.3], size: [0.1, 0.9], grow: 0.6, gravity: 0, rise: 1.2, drag: 1.2, windScale: 0.9, spread: 0.3, opacity: 0.4, floor: true, lighting: 0.4, clearAim: true }),
    };
    this.haze = new Haze(this.noise, this.sky.sunDir, this.clear);
    this.haze.onSettle = (x, y, z, r, a) => {
      this.groundMarks.dust(x, z, r, a * 0.6);
      this.wear?.dustAround(x, y, z, r, a);
      this.onHazeSettle?.(x, y, z, r, a);
    };
    this.scene.add(this.haze.mesh);
    this.scene.add(this.estate.root);
    this.grass = new GrassTufts(this.windField, (x, z) => this.terrain.heightAt(x, z));
    this.birds = new Birds(this.time, this.clear);
    this.braziers = new Braziers(this.time);
    this.scene.add(this.grass.root, this.birds.root, this.braziers.root);
    this.shock = new Shock(this.noise);
    this.scene.add(this.shock.root);
    this.splashes = new Splashes(this.time, this.wind, this.sky.sunDir, this.noise, this.clear, glow);
    this.scene.add(this.splashes.root, this.marks.mesh);
    this.marker = this.buildMarker();
    this.scene.add(this.marker);
    this.blastRing = this.buildBlastRing();
    this.scene.add(this.blastRing);
    this.scene.add(this.mortarAim.root);
    this.scene.add(this.navOverlay.mesh);
    this.scene.add(this.markers.root);
    this.scene.add(this.chalk.root);
    this.scene.add(this.ladders.root, this.storm.root);
    this.registerBuiltInParts();
  }

  // --- keyframes (S3) ----------------------------------------------------------

  /** Another module's share of a keyframe (registered once; the order of registration is the order of apply). */
  registerKeyframePart(name: string, part: KeyframePart): void {
    this.keyParts.set(name, part);
  }

  /** A picture of the renderer's world: every part's state, and the last frame applied. */
  capture(): RenderKeyframe {
    const parts = new Map<string, unknown>();
    let bytes = this.lastFrame ? frameBytes(this.lastFrame) : 0;
    for (const [name, part] of this.keyParts) {
      const state = part.capture(this.now);
      parts.set(name, state);
      bytes += part.bytes(state);
    }
    return { tick: this.lastFrame ? this.lastFrame.tick : -1, parts, last: this.lastFrame, bytes };
  }

  /** Put the renderer exactly where a keyframe was taken: every part, then the last frame again (no events, no ground patches). */
  apply(k: RenderKeyframe): void {
    for (const [name, part] of this.keyParts) {
      if (k.parts.has(name)) part.apply(k.parts.get(name), this.now);
    }
    this.lastFrame = null;
    if (k.last) this.applyFrame({ ...k.last, eventCount: 0, terrain: [] });
    this.lastFrame = k.last;
    // The frame lays its own stones (exact, where the page had drawn them between frames) and places the masons' hoists
    // afresh (their ropes are drawn in render): put both back as they were taken, so capture() gives the keyframe again.
    for (const name of ["stones", "works"]) {
      const part = this.keyParts.get(name);
      if (part && k.parts.has(name)) part.apply(k.parts.get(name), this.now);
    }
  }

  /** The renderer's clock in seconds (what sky, water, flags and every effect's age are measured against). */
  get clock(): number {
    return this.now;
  }

  /**
   * Set the clock (S4): a replay sets it before it applies its keyframe, so the same clip draws the same picture each
   * time (sky, water and flags depend on it), and puts it back before it gives the live keyframe back.
   */
  setClock(seconds: number): void {
    this.now = seconds;
    this.time.value = seconds;
  }

  private registerBuiltInParts() {
    const part = <S,>(p: KeyframePart<S>) => p as KeyframePart;
    this.registerKeyframePart(
      "stones",
      part<{ moved: Float32Array; raising: Float64Array }>({
        capture: (now) => {
          const raising = new Float64Array(this.raising.size * 2);
          let i = 0;
          for (const [id, t0] of this.raising) raising.set([id, now - t0], i++ * 2);
          return { moved: this.stones ? this.stones.captureMoved() : new Float32Array(0), raising };
        },
        apply: (st, now) => {
          this.stones?.restoreMoved(st.moved);
          // The trickle memory starts again: the same frames from here shed the same dust.
          this.prevTick.fill(-1);
          this.prevPos.fill(0);
          this.lastTrickle.fill(-100);
          this.raising.clear();
          for (let i = 0; i < st.raising.length; i += 2) this.raising.set(st.raising[i], now - st.raising[i + 1]);
        },
        bytes: (st) => st.moved.byteLength + st.raising.byteLength + 32,
      }),
    );
    this.registerKeyframePart(
      "terrain",
      part<{ idx: Int32Array; h: Float32Array }>({
        capture: () => this.terrain.captureHeights(),
        apply: (st) => {
          this.terrain.restoreHeights(st.idx, st.h);
          this.grass.invalidate();
        },
        bytes: (st) => st.idx.byteLength + st.h.byteLength + 32,
      }),
    );
    this.registerKeyframePart(
      "minions",
      part<MinionsState>({
        capture: () => this.minions.captureState(),
        apply: (st) => this.minions.restoreState(st),
        bytes: (st) => roughBytes(st),
      }),
    );
    this.registerKeyframePart(
      "guns",
      part<GunState[]>({
        capture: () => this.guns.captureState(),
        apply: (st) => this.guns.restoreState(st),
        bytes: (st) => roughBytes(st),
      }),
    );
    this.registerKeyframePart(
      "estate",
      part<EstateState>({
        capture: (now) => this.estate.captureState(now),
        apply: (st, now) => this.estate.restoreState(st, now),
        bytes: (st) => st.views.byteLength + st.kegs.byteLength + 32,
      }),
    );
    this.registerKeyframePart(
      "works",
      part<WorksState | null>({
        capture: (now) => (this.works ? this.works.captureState(now) : null),
        apply: (st, now) => {
          if (st && this.works) this.works.restoreState(st, now);
        },
        bytes: (st) => (st ? roughBytes(st) : 0),
      }),
    );
    this.registerKeyframePart(
      "decals",
      part<DecalState>({
        capture: (now) => this.decals.captureState(now),
        apply: (st, now) => this.decals.restoreState(st, now, this.gore),
        bytes: (st) => roughBytes(st),
      }),
    );
    this.registerKeyframePart(
      "storm",
      part<Float64Array>({
        capture: () => this.storm.captureState(),
        apply: (st) => this.storm.restoreState(st),
        bytes: (st) => st.byteLength + 16,
      }),
    );
    // L2 and L3: what the stone, the ground and the air remember (wear.ts, groundMarks.ts, haze.ts own their state), and which braziers still burn.
    this.registerKeyframePart(
      "wear",
      part<Float32Array | null>({
        capture: () => (this.wear ? this.wear.capture() : null),
        apply: (st) => {
          if (st && this.wear) this.wear.apply(st);
          else this.wear?.clear();
        },
        bytes: (st) => (st ? st.byteLength + 16 : 0),
      }),
    );
    this.registerKeyframePart(
      "groundMarks",
      part<Float32Array>({
        capture: () => this.groundMarks.capture(),
        apply: (st) => this.groundMarks.apply(st),
        bytes: (st) => st.byteLength + 16,
      }),
    );
    this.registerKeyframePart(
      "haze",
      part<{ hazes: Float32Array; recent: number[] }>({
        capture: (now) => this.haze.capture(now),
        apply: (st, now) => this.haze.apply(st, now),
        bytes: (st) => st.hazes.byteLength + st.recent.length * 8 + 32,
      }),
    );
    this.registerKeyframePart(
      "braziers",
      part<Float32Array>({
        capture: () => this.braziers.capture(),
        apply: (st) => this.braziers.apply(st),
        bytes: (st) => st.byteLength + 16,
      }),
    );
    this.registerKeyframePart(
      "birds",
      part<ReturnType<Birds["capture"]>>({
        capture: (now) => this.birds.capture(now),
        apply: (st, now) => this.birds.apply(st, now),
        bytes: (st) => roughBytes(st),
      }),
    );
    // The wind's fronts and drift and the clouds' place build up frame by frame: kept, so a clip draws the same sky and grass each play.
    this.registerKeyframePart(
      "wind",
      part<{ state: Record<string, number | boolean>; clouds: [number, number, number, number] }>({
        capture: () => {
          const c = CLOUDS.offset.value, d = this.sky.cloudDrift.value;
          return { state: this.windField.state.capture(), clouds: [c.x, c.y, d.x, d.y] };
        },
        apply: (st) => {
          this.windField.state.apply(st.state);
          this.windField.sync();
          CLOUDS.offset.value.set(st.clouds[0], st.clouds[1]);
          this.sky.cloudDrift.value.set(st.clouds[2], st.clouds[3]);
        },
        bytes: (st) => roughBytes(st),
      }),
    );
    // What is in the air only: nothing is captured. Cleared, with every ring back at its first slot, so the frames that follow lay the same particles in the same slots.
    this.registerKeyframePart(
      "transient",
      part<null>({
        capture: () => null,
        apply: () => {
          for (const b of Object.values(this.bursts)) b.reset();
          this.effects.reset();
          this.shock.reset();
          this.splashes.reset();
          this.marks.clear();
          this.flashLevel = 0;
          this.flash.intensity = 0;
          this.flashGlow.value = 0;
        },
        bytes: () => 0,
      }),
    );
  }

  /** How far a courtyard's storm has gone (0..1, castle 0 the enemy's) and whether its attackers outnumber its defenders now. */
  setStorm(castle: number, progress: number, holding: boolean): void {
    this.storm.set(castle, progress, holding);
  }

  /** Show the first n emplacements' guns (a match has the enemy's too). */
  showEmplacements(n: number): void {
    this.guns.showN = n;
    this.guns.setShown(n);
  }

  /** M3: what each emplacement holds now (guns bought for empty slots appear). */
  /** M5: the castle this page plays (team 1 at z = -150, team 0 at the origin): where the overview starts and debris is thrown towards. */
  private side: 0 | 1 = 1;
  setSide(team: 0 | 1) {
    this.side = team;
    this.views.setSide(team);
  }

  setArms(emplacements: Emplacement[]): void {
    this.guns.arm(emplacements);
  }

  /** M3: a world point on screen (CSS pixels from the canvas's top left), or null behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    const cam = this.views.camera;
    this.tmpA.set(x, y, z).project(cam);
    if (this.tmpA.z > 1 || this.tmpA.z < -1) return null;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return { x: ((this.tmpA.x + 1) / 2) * w, y: ((1 - this.tmpA.y) / 2) * h };
  }

  /** M3: where an upright sapper or musketeer stood in the last frame (for a musket's report), or null. */
  minionAt(id: number): [number, number, number, number] | null {
    return this.minions.positionOf(id);
  }

  /** 3.2: draw your team's marks (none: clear them). */
  setChalk(marks: ChalkMark[]): void {
    this.chalk.set(marks, (x, z) => this.terrain.heightAt(x, z));
  }

  /** Show the midfield markers (a match). */
  setMarkers(on: boolean): void {
    this.markers.root.visible = on;
  }

  setNavOverlay(on: boolean): void {
    this.navOverlay.mesh.visible = on;
  }

  updateNav(kind: Uint8Array, floor: Float32Array): void {
    this.navOverlay.update(kind, floor);
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
    this.inset = new Inset(renderer, this.scene, STYLE);
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
    this.wear?.dispose();
    this.stones = new StoneSet(layout, this.noise);
    this.wear = new StoneWear(layout, this.stones);
    const n = layout.stones.length;
    this.prevPos = new Float32Array(n * 3);
    this.prevTick = new Int32Array(n).fill(-1);
    this.lastTrickle = new Float32Array(n).fill(-100);
    this.flags = new Flags(layout, this.time, this.noise);
    this.scene.add(this.stones.root, this.flags.mesh);
    this.stones.setStyle(STYLE);
    this.flags.setStyle(STYLE);
    this.braziers.build(layout);
    this.flags.setWindField(this.windField);
    this.guns.build(layout, emplacements);
    this.guns.setShown(this.guns.showN);
    this.emplacementList = emplacements;
    if (this.works) {
      this.scene.remove(this.works.root);
      this.works.dispose();
    }
    this.works = new Works(layout);
    this.scene.add(this.works.root);
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
    this.lastFrame = frame;
    this.frameTick = frame.tick;
    if (this.stones && frame.stoneCount > 0) {
      this.stones.updateBodies(frame.stones, frame.stoneCount);
      this.braziers.bodies(frame.stones, frame.stoneCount);
      this.trickleDust(frame.stones, frame.stoneCount, frame.tick);
    }
    this.minions.update(frame);
    this.marks.update(frame.minions, frame.minionCount);
    this.splashes.bodies(this.now, frame.parts, frame.partCount, (x, z) => this.terrain.heightAt(x, z));
    this.ladders.update(frame.ladders, frame.ladderCount);
    this.works?.update(frame.works, frame.worksCount);
    // M3: the plots and the kegs at the walls.
    if (frame.plots && frame.plotCount) this.estate.setPlots(frame.plots, frame.plotCount);
    if (frame.kegs) this.estate.setKegs(frame.kegs, frame.kegCount);
    if (frame.terrain && frame.terrain.length > 0) {
      this.terrain.applyPatches(frame.terrain);
      this.grass.invalidate();
    }
    this.wear?.setKegs(frame.kegs, frame.kegCount);
    this.wind.value.set(frame.windX || 0, frame.windZ || 0);
    this.effects.wind.value.set(frame.windX || 0, frame.windZ || 0);
    this.flags?.setWind(frame.windX || 0, frame.windZ || 0);
    this.windField.setFrame(frame.windX, frame.windZ, frame.gustX, frame.gustZ, frame.gustIn, frame.tick);
    const ev = frame.events;
    for (let i = 0; i < frame.eventCount; i++) {
      const o = i * EVENT_STRIDE;
      const kind = ev[o];
      const x = ev[o + 1], y = ev[o + 2], z = ev[o + 3], v = ev[o + 4];
      this.wear?.event(kind, x, y, z, v);
      if (kind === EventKind.Impact) this.spawnImpact(x, y, z, v);
      else if (kind === EventKind.Explosion) this.spawnExplosion(x, y, z, v);
      else if (kind === EventKind.Muzzle) this.spawnMuzzle(x | 0);
      else if (kind === EventKind.Blood) this.spawnBlood(x, y, z, v);
      else if (kind === EventKind.Laid) this.works?.laid(x | 0, this.now, y, z, v);
      else if (kind === EventKind.Cleared) this.works?.cleared(y, z, v);
      // M3: building pieces rising, rubble carried off a plot, musket shots, kegs set, buildings finished.
      else if (kind === EventKind.Raised) this.spawnRaised(x | 0, y, z, v);
      else if (kind === EventKind.Musket) this.spawnMusket(x | 0, y, z, v);
      else if (kind === EventKind.Keg) this.minions.kegSet(x | 0);
      else if (kind === EventKind.Built) this.spawnBuilt(x | 0, y | 0);
      // M5: a keep floor board cracked but held ([stone id, x, y, z]): splinters and a little dust where it lies.
      else if (kind === EventKind.Cracked) this.spawnImpact(y, z, v, 0.45, 0.35);
      // EventKind.Landed: the page handles the landing marker.
    }
    // L2/L3: scorch, dust and trodden paths on the ground, and the haze of a great collapse.
    this.groundMarks.frame(frame, this.groundHeight);
    this.haze.frame(frame, this.layout, this.now, this.groundHeight);
  }

  /** M3: a building's piece rose into its place (it eases up the last half metre and settles in a puff); id -1: rubble carried off. */
  private spawnRaised(id: number, x: number, y: number, z: number) {
    if (id < 0) {
      this.bursts.dust.spawn(this.now, x, y, z, 0.9, 0, 0.6, 0);
      return;
    }
    this.raising.set(id, this.now);
    const s = this.layout?.stones[id];
    if (s) this.bursts.dust.spawn(this.now, x, y - s.hy, z, 0.5 + Math.min(1, s.hx * 0.3), 0, 0.4, 0);
  }

  /** M3: a musketeer fired at (x, y, z): a flash and a puff of white smoke at his muzzle, a little dust where a miss lands. */
  private spawnMusket(shooter: number, x: number, y: number, z: number) {
    const p = this.minions.positionOf(shooter);
    if (!p) return;
    const dx = x - p[0], dz = z - p[2];
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d, uz = dz / d;
    const mx = p[0] + ux * 1.05 - uz * 0.1, my = p[1] + 1.45, mz = p[2] + uz * 1.05 + ux * 0.1;
    this.bursts.flash.spawn(this.now, mx, my, mz, 0.32, ux, 0, uz);
    this.bursts.muzzleSmoke.spawn(this.now, mx, my, mz, 0.4, ux, 0.1, uz);
    this.pulseLight(mx, my, mz, 0.6, 0xffb070, 18);
  }

  /** M3: a building finished: a settling puff of dust round its foot. */
  private spawnBuilt(castle: number, plot: number) {
    if (!this.layout) return;
    const r = this.layout.plots.find((p) => p.castle === castle && p.plot === plot);
    if (!r) return;
    const s = this.layout.stones[r.first];
    this.bursts.skirt.spawn(this.now, s.x, 0.3, s.z, 0.35, 0, -0.5, 0);
  }

  setProjectiles(proj: Float32Array, count: number, chains: Float32Array, chainCount: number): void {
    this.projectiles.update(proj, count, chains, chainCount);
    this.splashes.begin();
    this.splashes.projectiles(this.now, proj, count, (x, z) => this.terrain.heightAt(x, z));
  }

  setStones(data: Float32Array, count: number): void {
    this.stones?.updateBodies(data, count);
    const L = this.layout;
    if (L) this.splashes.stones(this.now, data, count, (id) => L.stones[id]?.hy ?? 0.3, (x, z) => this.terrain.heightAt(x, z));
  }

  /** The page's sound for a splash (something fell into the stream): where, and how big (0..1.5). */
  set onSplash(fn: ((x: number, y: number, z: number, size: number) => void) | null) {
    this.splashes.onSplash = fn;
  }

  applyTerrain(patches: TerrainPatch[]): void {
    this.terrain.applyPatches(patches);
    this.grass.invalidate();
  }

  resetWorld(): void {
    this.estate.clear();
    this.braziers.reset();
    this.birds.reset();
    this.grass.invalidate();
    this.raising.clear();
    this.stones?.resetStones();
    this.wear?.clear();
    this.prevTick.fill(-1);
    this.lastTrickle.fill(-100);
    this.terrain.resetHeights();
    this.groundMarks.clear();
    this.haze.clear();
    this.decals.clear();
    this.minions.clear();
    this.splashes.clear();
    this.marks.clear();
    this.ladders.clear();
    this.works?.clear();
    this.storm.clear();
    for (const b of Object.values(this.bursts)) b.clear();
    this.shock.clear();
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

  private spawnImpact(x: number, y: number, z: number, strength: number, dust = 1) {
    // Into the stream: water, not dust and chips.
    if (y < STREAM.level + 0.9 && Splashes.overWater(x, z, this.terrain.heightAt(x, z))) {
      this.splashes.spawn(this.now, x, z, Math.min(1.4, 0.3 + strength * 0.6), false);
      return;
    }
    // Debris is thrown back towards the shooter (this page's castle).
    const cz = this.layout ? this.layout.castleZ[this.side] : -150;
    this.effects.bias.set(0 - x, 0, cz - z);
    this.effects.spawnImpact(x, y, z, strength, dust);
  }

  /** A powder burst: fireball, a fountain of chips, dust thrown along the ground, a shock, a smoke column. */
  private spawnExplosion(x: number, y: number, z: number, radius: number) {
    const r = Math.max(0.5, radius || 3);
    this.birds.noise(x, y, z, this.now);
    const g = this.terrain.heightAt(x, z);
    const nearGround = y - g < 4;
    // A shell bursting in the stream throws up a column of water.
    const wet = y < STREAM.level + 2.5 && Splashes.overWater(x, z, g);
    if (wet) this.splashes.spawn(this.now, x, z, 2.6, false);
    // Two rings of chips: one thrown hard, one heavier and lower. The smoke and the ground dust
    // below carry most of the cloud, so the impact dust is thinner than a single hit's.
    this.spawnImpact(x, y, z, 2.2, 0.55);
    this.spawnImpact(x, y + 0.6, z, 1.5, 0);
    this.bursts.flash.spawn(this.now, x, y + 0.4, z, r * 0.6, 0, 0.4, 0);
    this.bursts.fireball.spawn(this.now, x, y + 0.5, z, r * 0.32, 0, 0.7, 0);
    this.bursts.fire.spawn(this.now, x, y + 0.2, z, r * 0.5, 0, 0.6, 0);
    this.bursts.smoke.spawn(this.now, x, y + 0.3, z, r * 0.5, 0, 0.5, 0);
    this.bursts.column.spawn(this.now, x, y + 1, z, r * 0.35, 0, 1, 0);
    if (nearGround && !wet) this.bursts.skirt.spawn(this.now, x, g + 0.3, z, r * 0.3, 0, -0.5, 0);
    this.shock.spawn(this.now, x, y, z, r, nearGround ? g : null);
    this.pulseLight(x, y + 2, z, Math.min(6, r * 1.2), 0xffa050, 5);
  }

  private spawnMuzzle(em: number) {
    const p = this.tmpA, d = this.tmpB;
    if (!this.guns.muzzle(em, p, d)) return;
    this.birds.noise(p.x, p.y, p.z, this.now);
    this.wear?.muzzle(p.x, p.y, p.z, d.x, d.y, d.z);
    this.bursts.flash.spawn(this.now, p.x + d.x * 0.4, p.y + d.y * 0.4, p.z + d.z * 0.4, 1.2, d.x, d.y, d.z);
    this.bursts.muzzleSmoke.spawn(this.now, p.x + d.x * 0.6, p.y + d.y * 0.6, p.z + d.z * 0.6, 1, d.x, d.y, d.z);
    this.pulseLight(p.x + d.x, p.y + d.y, p.z + d.z, 1.4, 0xffb070, 14);
  }

  private spawnBlood(x: number, y: number, z: number, strength: number) {
    const s = Math.max(0.1, Math.min(1, strength || 0.5));
    if (!this.gore) {
      // Gore off: blood becomes dust.
      this.bursts.dust.spawn(this.now, x, y, z, 0.6 + s * 0.6, 0, 0.5, 0);
      return;
    }
    this.bursts.spray.spawn(this.now, x, y, z, 0.6 + s * 0.8, 0, 0.6, 0);
    // Chance from the event's own tick and place, so a replay lays the same splat as the match did.
    const r = eventChance(this.frameTick, x, y, z);
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

  private pulseLight(x: number, y: number, z: number, level: number, hex: number, decay: number) {
    if (level < this.flashLevel * 0.5) return; // a small flash does not steal the light from a big one
    this.flash.position.set(x, y, z);
    this.flash.color.setHex(hex);
    this.flashLevel = Math.max(this.flashLevel, level);
    this.flashDecay = decay;
  }

  // --- weapons, camera, aim help --------------------------------------------

  setWeaponPose(emplacement: number, yaw: number, pitch: number, active: boolean): void {
    this.guns.setPose(emplacement, yaw, pitch, active);
    const em = active ? this.emplacementList.find((x) => x.id === emplacement) : undefined;
    if (em) this.windField.setAnchor(em.x, em.z);
  }

  setCamera(pose: CameraPose): void {
    this.views.setPose(pose);
    this.clear.crosshair.value = pose.mode === "sight" ? 1 : 0;
    this.marks.mesh.visible = pose.mode === "overview";
  }

  setAimArc(points: Float32Array | null): void {
    this.effects.setAimArc(points);
    this.clear.setArc(points);
  }

  setGhostTrail(points: Float32Array | null): void {
    this.effects.setGhostTrail(points);
  }

  setLandingMarker(p: { x: number; y: number; z: number; nx?: number; ny?: number; nz?: number } | null, blastRadius = 0): void {
    this.markerOn = !!p;
    this.marker.visible = !!p;
    this.blastRing.visible = !!p && blastRadius > 0;
    if (!p) return;
    const nx = p.nx ?? 0, ny = p.ny ?? 1, nz = p.nz ?? 0;
    const onGround = p.nx === undefined || p.y <= this.terrain.heightAt(p.x, p.z) + 0.05;
    const y = onGround ? Math.max(p.y, this.terrain.heightAt(p.x, p.z)) : p.y;
    // Lie on the surface it hits (a wall face, a roof slope), lifted a little off it.
    this.marker.position.set(p.x + nx * 0.06, y + ny * 0.06, p.z + nz * 0.06);
    this.tmpA.set(nx, ny, nz).normalize();
    this.marker.quaternion.setFromUnitVectors(this.tmpB.set(0, 1, 0), this.tmpA);
    if (blastRadius > 0) {
      this.blastRing.position.set(p.x, y + 0.1, p.z);
      this.blastRing.scale.setScalar(blastRadius);
    }
  }

  setMortarAim(bearing: { x: number; z: number; dx: number; dz: number; near: number; far: number } | null, ring: { x: number; y: number; z: number } | null, radius: number, soft: boolean): void {
    this.mortarAim.setBearing(bearing, this.groundHeight);
    this.mortarAim.setRing(ring, radius, soft);
  }

  groundAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }
  /** The ground's height, as one function (the mortar's marks ask for it every frame). */
  private readonly groundHeight = (x: number, z: number): number => this.terrain.heightAt(x, z);

  setGunOut(emplacement: number, out: boolean, fell = false): void {
    const e = this.emplacementList.find((x) => x.id === emplacement);
    this.guns.setOut(emplacement, out, fell, e ? this.terrain.heightAt(e.x, e.z) : 0);
  }

  castPath(points: Float32Array): PathHit | null {
    const n = Math.floor(points.length / 3);
    const stones = this.stones;
    const cz = this.layout ? this.layout.castleZ : [0, -150];
    for (let i = 1; i < n; i++) {
      const ax = points[i * 3 - 3], ay = points[i * 3 - 2], az = points[i * 3 - 1];
      const bx = points[i * 3], by = points[i * 3 + 1], bz = points[i * 3 + 2];
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-6) continue;
      const ux = dx / len, uy = dy / len, uz = dz / len;
      let best = len;
      let stone = -1;
      let hit = false;
      if (stones) {
        for (const c of [0, 1] as const) {
          // Only near a castle (its stones and the rubble around it).
          const z0 = cz[c] - 26, z1 = cz[c] + 26;
          if (Math.max(az, bz) < z0 || Math.min(az, bz) > z1 || Math.min(ax, bx) > 26 || Math.max(ax, bx) < -26 || Math.min(ay, by) > 27) continue;
          const t = stones.raycast(ax, ay, az, ux, uy, uz, c, best);
          if (t >= 0 && t < best) {
            best = t;
            stone = stones.lastHitId;
            hit = true;
          }
        }
        // The bridges, and the timber fallen around them.
        if (Math.min(ay, by) < 6 && this.layout) {
          for (const b of this.layout.bridges) {
            const s = b.site, rx = s.width / 2 + 7, rz = s.length / 2 + 7;
            if (Math.max(ax, bx) < s.x - rx || Math.min(ax, bx) > s.x + rx || Math.max(az, bz) < s.z - rz || Math.min(az, bz) > s.z + rz) continue;
            const t = stones.raycast(ax, ay, az, ux, uy, uz, 2, best);
            if (t >= 0 && t < best) {
              best = t;
              stone = stones.lastHitId;
              hit = true;
            }
            break;
          }
        }
      }
      const h = (x: number, z: number) => this.terrain.heightAt(x, z);
      if (by <= h(bx, bz)) {
        let lo = 0, hi = len;
        for (let k = 0; k < 22; k++) {
          const m = (lo + hi) / 2;
          if (ay + uy * m > h(ax + ux * m, az + uz * m)) lo = m;
          else hi = m;
        }
        const tg = (lo + hi) / 2;
        if (!hit || tg < best) {
          best = tg;
          stone = -1;
          hit = true;
        }
      }
      if (!hit) continue;
      const x = ax + ux * best, y = ay + uy * best, z = az + uz * best;
      let nx = 0, ny = 1, nz = 0;
      if (stone >= 0 && stones) {
        stones.faceNormal(stone, x, y, z, ux, uy, uz, this.normal);
        [nx, ny, nz] = this.normal;
      } else {
        const e = 0.6;
        const gx = (h(x + e, z) - h(x - e, z)) / (2 * e), gz = (h(x, z + e) - h(x, z - e)) / (2 * e);
        const l = Math.sqrt(gx * gx + 1 + gz * gz);
        nx = -gx / l;
        ny = 1 / l;
        nz = -gz / l;
      }
      return { index: i - 1, x, y, z, stone, nx, ny, nz };
    }
    return null;
  }

  setInset(pose: InsetPose | null, rect: InsetRect, swapped: boolean): void {
    this.insetPose = pose;
    this.insetRect = rect;
    this.insetSwapped = swapped;
  }

  /** Is the straight line between two points cut by masonry (any stone, standing or fallen)? */
  sightBlocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const stones = this.stones;
    if (!stones) return false;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return false;
    for (const c of [0, 1, 2] as const) if (stones.raycast(ax, ay, az, dx / len, dy / len, dz / len, c, len) >= 0) return true;
    return false;
  }

  setRenderScale(scale: number): void {
    this.renderScale = Math.max(0.4, Math.min(1, scale));
    this.post?.setScale(this.renderScale);
  }

  gpuTime(): number | null {
    return this.canTime ? this.gpuMs : null;
  }

  setTimeScale(scale: number): void {
    this.timeScale = Math.max(0.02, Math.min(1, scale));
  }

  /** The camera's field of view now (degrees), for photo mode to start from. */
  fov(): number {
    return this.views.camera.fov;
  }

  /** The canvas the game draws on (the film's composite and the photo read it right after a render). */
  get surface(): HTMLCanvasElement {
    return this.canvas;
  }

  listener(): Listener {
    const cam = this.views.camera;
    const e = cam.matrixWorld.elements;
    return { x: cam.position.x, y: cam.position.y, z: cam.position.z, rx: e[0], ry: e[1], rz: e[2], fx: -e[8], fy: -e[9], fz: -e[10] };
  }

  /** The area a burst reaches: a thin cold ring over a faint disc (readability rule 4). */
  private buildBlastRing(): THREE.Group {
    const g = new THREE.Group();
    g.name = "blast-ring";
    const mk = (geo: THREE.BufferGeometry, hex: number, opacity: number, order: number) => {
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.MeshBasicNodeMaterial();
      m.color = new THREE.Color(hex);
      m.transparent = true;
      m.opacity = opacity;
      m.depthWrite = false;
      m.fog = false;
      m.side = THREE.DoubleSide;
      m.polygonOffset = true;
      m.polygonOffsetFactor = -4;
      m.polygonOffsetUnits = -4;
      const mesh = new THREE.Mesh(geo, m);
      mesh.renderOrder = order;
      return mesh;
    };
    g.add(mk(new THREE.CircleGeometry(1, 64), 0xeef4ff, 0.07, 20), mk(new THREE.RingGeometry(0.965, 1.0, 96, 1), 0x07090b, 0.6, 21), mk(new THREE.RingGeometry(0.975, 0.99, 96, 1), 0xeef4ff, 0.75, 22));
    g.visible = false;
    return g;
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
      for (const c of [0, 1, 2] as const) {
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
    const real = Math.max(0, Math.min(0.25, dtSeconds || 0));
    const dt = real * this.timeScale;
    this.now += dt;
    this.time.value = this.now;
    this.sky.time.value = this.now;
    this.effects.setTime(this.now);
    this.windField.update(dt);
    updateClouds(this.windField.now.value.x, this.windField.now.value.y, dt);
    this.sky.driftClouds(this.windField.now.value.x, this.windField.now.value.y, dt);
    this.shock.update(this.now);
    this.views.update(real);
    const cam = this.views.camera;
    cam.updateMatrixWorld();
    // Impact cam swapped in: the main pass draws from the inset's view and the inset from the gun's, then the gun's is restored.
    const swapped = this.insetSwapped && !!this.insetPose && !!this.inset;
    if (swapped) {
      const sp = this.savedPose;
      sp.pos.copy(cam.position);
      sp.quat.copy(cam.quaternion);
      sp.fov = cam.fov;
      this.aimCamera(cam, this.insetPose!);
    }
    this.clear.update(cam);
    this.mortarAim.update(cam);
    this.chalk.face(cam);
    this.minions.step(dt, (x, z) => this.terrain.heightAt(x, z), cam);
    this.decals.follow(this.stones, this.now);
    this.sky.follow(cam);
    // M3: plots' trades at work, and building pieces easing into place.
    this.grass.update(cam.position.x, cam.position.z, this.now);
    this.birds.update(this.now, (x, z, out) => this.windField.sampleAt(x, z, out));
    this.braziers.update(dt, (x, y, z) => this.bursts.brazier.spawn(this.now, x, y, z, 0.4, 0, 0.6, 0));
    this.estate.update(dt, this.now, (kind, x, y, z, s) => this.bursts[kind === "smoke" ? "chimney" : kind === "spark" ? "spark" : "dust"].spawn(this.now, x, y, z, s, 0, 0.6, 0));
    if (this.raising.size && this.stones && this.layout) {
      for (const [id, t0] of this.raising) {
        const s = this.layout.stones[id];
        const t = (this.now - t0) / 0.45;
        const k = t >= 1 ? 0 : (1 - t) * (1 - t);
        this.raiseBuf.set([id, s.x, s.y - 0.55 * k, s.z, s.q[0], s.q[1], s.q[2], s.q[3]]);
        this.stones.updateBodies(this.raiseBuf, 1);
        if (t >= 1) this.raising.delete(id);
      }
    }
    if (this.stones) {
      // Stones the masons are putting back: on their way up the hoist and into place.
      if (this.works) {
        this.works.animate(this.now, this.stones);
        const p = this.works.puffs;
        for (let k = 0; k + 3 < p.length; k += 4) this.bursts.dust.spawn(this.now, p[k], p[k + 1], p[k + 2], p[k + 3], 0, 0.6, 0);
        p.length = 0;
      }
      this.wear?.update(this.now, dt);
      this.stones.flush();
      this.flags?.update(this.stones, dt);
    }
    this.storm.update(real, this.now);
    this.terrain.flush();
    this.groundMarks.update();
    this.haze.update(this.now, dt, (x, z, out) => this.windField.sampleAt(x, z, out));
    this.guns.update(dt);
    // Flash light decays fast.
    this.flashLevel *= Math.exp(-dt * this.flashDecay);
    if (this.flashLevel < 0.01) this.flashLevel = 0;
    this.flash.intensity = this.flashLevel * 900;
    this.flashPos.value.copy(this.flash.position);
    this.flashGlow.value = Math.min(1.4, this.flashLevel * 0.25);
    if (this.markerOn) {
      // Keep the marker readable from far away.
      const dist = cam.position.distanceTo(this.marker.position);
      this.marker.scale.setScalar(Math.max(1, dist * 0.014));
    }
    const post = this.post!;
    if (this.postDirty) {
      post.build(this.scene, cam, TIERS[this.tier], STYLE);
      post.setScale(this.renderScale);
      this.postDirty = false;
    }
    this.renderer.info.reset();
    const priming = this.primeFrames > 0 && !!this.stones;
    if (priming) {
      this.primeFrames--;
      this.shock.prime(true);
      this.projectiles.prime(true);
      this.decals.prime(true);
      this.minions.prime(true);
      this.ladders.prime(true);
      this.works?.prime(true);
      this.storm.prime(true);
    }
    post.render(this.now);
    // The impact cam: a second pass (while priming, a tiny one, so its shaders compile at load).
    if (this.inset && (this.insetPose || priming)) this.drawInset(swapped, priming);
    if (swapped) {
      const sp = this.savedPose;
      cam.position.copy(sp.pos);
      cam.quaternion.copy(sp.quat);
      if (cam.fov !== sp.fov) {
        cam.fov = sp.fov;
        cam.updateProjectionMatrix();
      }
      cam.updateMatrixWorld();
    }
    if (priming) {
      this.shock.prime(false);
      this.projectiles.prime(false);
      this.decals.prime(false);
      this.minions.prime(false);
      this.ladders.prime(false);
      this.works?.prime(false);
      this.storm.prime(false);
    }
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

  /** Point a camera at a pose: eye, the point it looks at, field of view. */
  private aimCamera(cam: THREE.PerspectiveCamera, p: InsetPose) {
    cam.position.set(p.x, p.y, p.z);
    cam.up.set(0, 1, 0);
    cam.lookAt(p.tx, p.ty, p.tz);
    if (cam.fov !== p.fov) {
      cam.fov = p.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  /**
   * The inset's pass. Everything the main frame did for its own camera is put right for this one:
   * the sky is centred on it, the aim help (arc, ghost trail, landing ring, mortar marks) is hidden
   * (it is laid out for the main view), the readability fade near the aim line is off, and the sun's
   * shadow map is not drawn again (it does not depend on the camera).
   */
  private drawInset(swapped: boolean, priming: boolean) {
    const inset = this.inset!;
    const ic = inset.camera;
    if (swapped) {
      const sp = this.savedPose;
      ic.position.copy(sp.pos);
      ic.quaternion.copy(sp.quat);
      if (ic.fov !== sp.fov) {
        ic.fov = sp.fov;
        ic.updateProjectionMatrix();
      }
      ic.updateMatrixWorld();
    } else if (this.insetPose) this.aimCamera(ic, this.insetPose);
    else this.aimCamera(ic, { x: 0, y: 40, z: -40, tx: 0, ty: 0, tz: -75, fov: 45 });
    this.sky.follow(ic);
    this.clear.suspend();
    const hide = [this.marker, this.blastRing, this.mortarAim.root, this.effects.root.getObjectByName("aim-arc"), this.effects.root.getObjectByName("ghost-trail")];
    const was = hide.map((o) => !!o && o.visible);
    for (const o of hide) if (o) o.visible = false;
    const shadow = this.sun?.shadow;
    const auto = shadow ? shadow.autoUpdate : true;
    if (shadow) shadow.autoUpdate = false;
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    inset.draw(priming && !this.insetPose ? { x: 0, y: 0, w: 16, h: 9 } : this.insetRect, w, h, this.now);
    if (shadow) shadow.autoUpdate = auto;
    hide.forEach((o, i) => {
      if (o) o.visible = was[i];
    });
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
    this.inset?.dispose();
    this.wear?.dispose();
    this.stones?.dispose();
    this.flags?.dispose();
    this.terrain.dispose();
    this.haze.dispose();
    this.scatter.dispose();
    this.effects.dispose();
    this.projectiles.dispose();
    this.minions.dispose();
    this.guns.dispose();
    this.markers.dispose();
    this.chalk.dispose();
    this.ladders.dispose();
    this.works?.dispose();
    this.storm.dispose();
    this.estate.dispose();
    this.grass.dispose();
    this.birds.dispose();
    this.braziers.dispose();
    this.decals.dispose();
    for (const b of Object.values(this.bursts)) b.dispose();
    this.shock.dispose();
    this.splashes.dispose();
    this.marks.dispose();
    for (const group of [this.marker, this.blastRing])
      group.traverse((o) => {
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
    this.grass.setEnabled(t.tufts);
    setWearChips(t.chips);
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
    this.grass.setStyle(style);
    this.effects.setStyle(style);
    this.stones?.setStyle(style);
    this.flags?.setStyle(style);
    this.postDirty = true;
  }
}
