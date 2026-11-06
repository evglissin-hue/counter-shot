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
  length,
  mix,
  mrt,
  normalView,
  output,
  pass,
  renderOutput,
  sample,
  screenCoordinate,
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
}

export const TIERS: Record<QualityTier, TierSettings> = {
  low: { pixelRatioCap: 1, pixelRatioScale: 0.75, shadowMap: 1024, shadowTaps: 4, softShadows: false, ao: "off", bloom: false, aa: "fxaa", halfTrees: true },
  medium: { pixelRatioCap: 1, pixelRatioScale: 1, shadowMap: 2048, shadowTaps: 8, softShadows: true, ao: "off", bloom: true, aa: "fxaa", halfTrees: false },
  high: { pixelRatioCap: 1.5, pixelRatioScale: 1, shadowMap: 2048, shadowTaps: 12, softShadows: true, ao: "half", bloom: true, aa: "smaa", halfTrees: false },
  ultra: { pixelRatioCap: 2, pixelRatioScale: 1, shadowMap: 4096, shadowTaps: 16, softShadows: true, ao: "full", bloom: true, aa: "smaa", halfTrees: false },
};

export class Post {
  readonly pipeline: THREE.RenderPipeline;
  private readonly u = {
    aoStrength: uniform(0.8),
    saturation: uniform(1),
    contrast: uniform(1),
    lift: uniform(new THREE.Vector3()),
    gain: uniform(new THREE.Vector3(1, 1, 1)),
    vignette: uniform(0),
    grain: uniform(0),
    time: uniform(0),
  };
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
    if (tier.ao !== "off") {
      scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }));
      const normalTex = scenePass.getTexture("normal");
      normalTex.type = THREE.UnsignedByteType;
      const sceneColor: N = scenePass.getTextureNode("output");
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
      colorNode = scenePass.getTextureNode("output");
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
    const u = this.u;
    const graded: N = Fn(() => {
      const c: N = aa.rgb.toVar();
      c.assign(c.mul(u.gain).add(u.lift.mul(float(1).sub(c))));
      const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c.assign(mix(vec3(l), c, u.saturation));
      c.assign(c.sub(0.5).mul(u.contrast).add(0.5));
      const p = screenUV.sub(0.5).mul(vec2(1.25, 1.0));
      const vig = float(1).sub(smoothstep(0.35, 0.95, length(p)).mul(u.vignette));
      c.mulAssign(vig);
      const g = hash(screenCoordinate.x.add(screenCoordinate.y.mul(4096.0)).add(u.time.mul(60.0).floor().mul(7919.0)).add(1.0)).sub(0.5);
      c.addAssign(g.mul(u.grain));
      return vec4(c.clamp(0.0, 1.0), 1.0);
    })();
    this.pipeline.outputColorTransform = false;
    this.pipeline.outputNode = graded;
    this.pipeline.needsUpdate = true;
    this.applyStyle(style);
  }

  /** Style values that are plain uniforms (no rebuild). */
  applyStyle(style: StylePreset) {
    const u = this.u;
    u.aoStrength.value = style.ao.strength;
    u.saturation.value = style.grade.saturation;
    u.contrast.value = style.grade.contrast;
    u.lift.value.set(...style.grade.lift);
    u.gain.value.set(...style.grade.gain);
    u.vignette.value = style.grade.vignette;
    u.grain.value = style.grade.grain;
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
    this.u.time.value = time;
    this.pipeline.render();
  }

  dispose() {
    for (const d of this.disposables) d.dispose?.();
    this.pipeline.dispose();
  }
}

