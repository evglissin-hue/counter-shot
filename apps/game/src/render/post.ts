// Post processing per quality tier: GTAO (high, ultra), bloom (medium and
// up), tone mapping, anti-aliasing (FXAA on low and medium, SMAA on high and
// ultra) and a light per-style grade (saturation, contrast, lift and gain,
// vignette, grain) applied after tone mapping.

import * as THREE from "three/webgpu";
import {
  Fn,
  clamp,
  unpackRGBToNormal,
  packNormalToRGB,
  dot,
  float,
  hash,
  If,
  length,
  mix,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  sample,
  screenCoordinate,
  screenSize,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import type { StylePreset } from "./styles";
import type { N } from "./tslUtils";

export type QualityTier = "low" | "medium" | "high" | "ultra";

export interface TierSettings {
  pixelRatioCap: number;
  pixelRatioScale: number;
  shadowMap: number;
  shadowTaps: number;
  softShadows: boolean;
  ao: "off" | "half" | "full";
  bloom: boolean;
  aa: "fxaa" | "smaa";
  halfTrees: boolean;
  /** L3: grass in tufts near the camera. */
  tufts: boolean;
  /** L2: chipped edges on every block. */
  chips: boolean;
}

export const TIERS: Record<QualityTier, TierSettings> = {
  low: { pixelRatioCap: 1, pixelRatioScale: 0.75, shadowMap: 1024, shadowTaps: 4, softShadows: false, ao: "off", bloom: false, aa: "fxaa", halfTrees: true, tufts: false, chips: false },
  medium: { pixelRatioCap: 1, pixelRatioScale: 1, shadowMap: 2048, shadowTaps: 8, softShadows: true, ao: "off", bloom: true, aa: "fxaa", halfTrees: false, tufts: false, chips: false },
  high: { pixelRatioCap: 1.5, pixelRatioScale: 1, shadowMap: 2048, shadowTaps: 12, softShadows: true, ao: "half", bloom: true, aa: "smaa", halfTrees: false, tufts: true, chips: true },
  ultra: { pixelRatioCap: 2, pixelRatioScale: 1, shadowMap: 4096, shadowTaps: 16, softShadows: true, ao: "full", bloom: true, aa: "smaa", halfTrees: false, tufts: true, chips: true },
};

/**
 * The per-style grade (saturation, contrast, lift and gain, vignette, grain) applied after
 * tone mapping. `node` takes the uv to measure the vignette from: the screen's for the main
 * view, the quad's own for the impact cam's inset, which covers only part of the screen.
 */
export class Grade {
  readonly u = {
    saturation: uniform(1),
    contrast: uniform(1),
    lift: uniform(new THREE.Vector3()),
    gain: uniform(new THREE.Vector3(1, 1, 1)),
    vignette: uniform(0),
    grain: uniform(0),
    time: uniform(0),
    /** L1.6: the gunner's glass (0..1): a soft dark ring outside the sight's circle and a touch more contrast inside it. Only the main view sets it. */
    glass: uniform(0),
  };

  apply(style: StylePreset) {
    const u = this.u;
    u.saturation.value = style.grade.saturation;
    u.contrast.value = style.grade.contrast;
    u.lift.value.set(...style.grade.lift);
    u.gain.value.set(...style.grade.gain);
    u.vignette.value = style.grade.vignette;
    u.grain.value = style.grade.grain;
  }

  node(input: N, uvNode: N): N {
    const u = this.u;
    return Fn(() => {
      const c: N = input.rgb.toVar();
      c.assign(c.mul(u.gain).add(u.lift.mul(float(1).sub(c))));
      const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c.assign(mix(vec3(l), c, u.saturation));
      // The telescope's circle: r is the distance from the centre in half screen heights (1 at the top and bottom edges).
      const r = length(uvNode.sub(0.5).mul(vec2(screenSize.x.div(screenSize.y).mul(2.0), 2.0)));
      const inside = float(1).sub(smoothstep(0.85, 1.05, r));
      c.assign(c.sub(0.5).mul(u.contrast).mul(float(1).add(u.glass.mul(inside).mul(0.05))).add(0.5));
      const p = uvNode.sub(0.5).mul(vec2(1.25, 1.0));
      const vig = float(1).sub(smoothstep(0.35, 0.95, length(p)).mul(u.vignette));
      c.mulAssign(vig);
      // Outside the circle at most 45% darker, from r = 0.92 (the ring never touches the sight), never black.
      c.mulAssign(float(1).sub(smoothstep(0.92, 1.3, r).mul(u.glass).mul(0.45)));
      const g = hash(screenCoordinate.x.add(screenCoordinate.y.mul(4096.0)).add(u.time.mul(60.0).floor().mul(7919.0)).add(1.0)).sub(0.5);
      c.addAssign(g.mul(u.grain));
      return vec4(c.clamp(0.0, 1.0), 1.0);
    })();
  }
}

export class Post {
  readonly pipeline: THREE.RenderPipeline;
  private readonly u = { aoStrength: uniform(0.8) };
  private readonly grade = new Grade();
  private aoNode: N = null;
  private bloomNode: N = null;
  private scenePass: N = null;
  private aoBase = 1;
  private disposables: N[] = [];

  constructor(renderer: THREE.WebGPURenderer) {
    this.pipeline = new THREE.RenderPipeline(renderer);
  }

  build(scene: THREE.Scene, camera: THREE.Camera, tier: TierSettings, style: StylePreset) {
    for (const d of this.disposables) d.dispose?.();
    this.disposables = [];
    this.aoNode = null;
    this.bloomNode = null;

    const scenePass: N = pass(scene, camera);
    this.scenePass = scenePass;
    this.disposables.push(scenePass);
    let colorNode: N;
    // L1.6: the glass blurs the scene's edge a little (the rest of the pipeline reads this instead of the raw pass).
    const rawColor: N = scenePass.getTextureNode("output");
    const glassed: N = this.glassBlur(rawColor);
    if (tier.ao !== "off") {
      scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }));
      const normalTex = scenePass.getTexture("normal");
      normalTex.type = THREE.UnsignedByteType;
      const sceneColor: N = glassed;
      const normalNode: N = scenePass.getTextureNode("normal");
      const sceneNormal: N = sample((uvNode: N) => unpackRGBToNormal(normalNode.sample(uvNode)));
      const sceneDepth: N = scenePass.getTextureNode("depth");
      const aoPass: N = ao(sceneDepth, sceneNormal, camera);
      aoPass.resolutionScale = tier.ao === "half" ? 0.5 : 1;
      this.aoBase = aoPass.resolutionScale;
      aoPass.samples.value = tier.ao === "half" ? 12 : 16;
      this.aoNode = aoPass;
      this.disposables.push(aoPass);
      const aoTex: N = aoPass.getTextureNode();
      colorNode = vec4(sceneColor.rgb.mul(mix(float(1), aoTex.r, this.u.aoStrength)), sceneColor.a);
    } else {
      colorNode = glassed;
    }
    if (tier.bloom && style.bloom.strength > 0) {
      const b: N = bloom(colorNode, style.bloom.strength, style.bloom.radius, style.bloom.threshold);
      this.bloomNode = b;
      this.disposables.push(b);
      colorNode = colorNode.add(b);
    }
    const toned: N = renderOutput(colorNode);
    const aa: N = tier.aa === "smaa" ? smaa(toned) : fxaa(toned);
    this.disposables.push(aa);
    const graded: N = this.grade.node(aa, screenUV);
    this.pipeline.outputColorTransform = false;
    this.pipeline.outputNode = graded;
    this.pipeline.needsUpdate = true;
    this.applyStyle(style);
  }

  /**
   * The edge of the gunner's glass: four taps of the scene diagonally round each pixel, a radius that grows from the ring's inner
   * edge to about 3 px at the corners, all scaled by the glass. With no glass it is the pixel itself (and the taps are skipped).
   * It blurs the scene before the occlusion, bloom, tone map and anti-aliasing (the anti-aliased image cannot be sampled at offsets here).
   */
  private glassBlur(tex: N): N {
    const g = this.grade.u.glass;
    return Fn(() => {
      const c: N = vec4(tex).toVar();
      If(g.greaterThan(0.001), () => {
        const size = screenSize;
        const r = length(screenUV.sub(0.5).mul(vec2(size.x.div(size.y).mul(2.0), 2.0)));
        const px = smoothstep(0.92, 1.45, r).mul(g).mul(3.0);
        const o = vec2(px.div(size.x), px.div(size.y));
        const acc: N = c.mul(0.36).toVar();
        acc.addAssign(tex.sample(screenUV.add(vec2(o.x, o.y))).mul(0.16));
        acc.addAssign(tex.sample(screenUV.add(vec2(o.x.negate(), o.y))).mul(0.16));
        acc.addAssign(tex.sample(screenUV.add(vec2(o.x, o.y.negate()))).mul(0.16));
        acc.addAssign(tex.sample(screenUV.add(vec2(o.x.negate(), o.y.negate()))).mul(0.16));
        c.assign(acc);
      });
      return c;
    })();
  }

  /** L1.6: the gunner's glass for the main view (0..1). */
  setGlass(v: number) {
    this.grade.u.glass.value = v;
  }

  /** Style values that are plain uniforms (no rebuild). */
  applyStyle(style: StylePreset) {
    const u = this.u;
    u.aoStrength.value = style.ao.strength;
    this.grade.apply(style);
    if (this.aoNode) {
      this.aoNode.radius.value = style.ao.radius;
      this.aoNode.thickness.value = style.ao.thickness;
      this.aoNode.scale.value = style.ao.power;
    }
    if (this.bloomNode) {
      this.bloomNode.strength.value = style.bloom.strength;
      this.bloomNode.radius.value = style.bloom.radius;
      this.bloomNode.threshold.value = style.bloom.threshold;
    }
  }

  /**
   * Dynamic resolution: draw the scene (and its ambient occlusion) at this share
   * of the full resolution. Shadows, bloom, anti-aliasing and the grade are unchanged.
   */
  setScale(scale: number) {
    this.scenePass?.setResolutionScale(scale);
    if (this.aoNode) this.aoNode.resolutionScale = this.aoBase * scale;
  }

  render(time: number) {
    this.grade.u.time.value = time;
    this.pipeline.render();
  }

  dispose() {
    for (const d of this.disposables) d.dispose?.();
    this.pipeline.dispose();
  }
}

