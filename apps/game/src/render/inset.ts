// The impact cam's second camera pass: the same scene from a second camera,
// drawn at a third of the main view's resolution into a rectangle of the
// screen after the main post pass. No ambient occlusion, bloom or edge
// smoothing (the downsample softens the edges); the same tone mapping and
// per-style grade. The sun's shadow map is the main pass's (the caller stops
// it re-rendering shadows while this draws).

import * as THREE from "three/webgpu";
import { pass, renderOutput, uv } from "three/tsl";
import type { InsetRect } from "./api";
import { Grade } from "./post";
import type { StylePreset } from "./styles";
import type { N } from "./tslUtils";

/** The inset's share of the main view's resolution (linear). */
export const INSET_SCALE = 1 / 3;
export const INSET_ASPECT = 16 / 9;

export class Inset {
  readonly camera = new THREE.PerspectiveCamera(45, INSET_ASPECT, 0.3, 9000);
  private readonly pipeline: THREE.RenderPipeline;
  private readonly grade = new Grade();
  private readonly scenePass: N;
  private width = 320;
  private height = 180;

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    style: StylePreset,
  ) {
    const scenePass: N = pass(scene, this.camera);
    this.scenePass = scenePass;
    // The pass sizes its target from the drawing buffer each frame; this one keeps the inset's own 16 by 9 shape.
    const setSize = scenePass.setSize.bind(scenePass) as (w: number, h: number) => void;
    scenePass.setSize = () => setSize(this.width, this.height);
    this.grade.apply(style);
    const toned: N = renderOutput(scenePass.getTextureNode("output"));
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false;
    this.pipeline.outputNode = this.grade.node(toned, uv());
    // The blit lands on top of the main view: it neither clears nor depth-tests.
    const material = (this.pipeline as unknown as { _quadMesh: { material: THREE.Material } })._quadMesh.material;
    material.depthTest = false;
    material.depthWrite = false;
  }

  /** Draw the scene from `camera` into `rect` of the canvas (`canvasW` by `canvasH` CSS pixels). */
  draw(rect: InsetRect, canvasW: number, canvasH: number, time: number) {
    const r = this.renderer;
    const buf = r.getDrawingBufferSize(new THREE.Vector2());
    this.width = Math.max(96, Math.round(buf.width * INSET_SCALE));
    this.height = Math.round(this.width / INSET_ASPECT);
    this.grade.u.time.value = time;
    const clear = r.autoClear;
    r.autoClear = false;
    r.setViewport(rect.x, rect.y, rect.w, rect.h);
    this.pipeline.render();
    r.setViewport(0, 0, canvasW, canvasH);
    r.autoClear = clear;
  }

  dispose() {
    this.scenePass.dispose?.();
    this.pipeline.dispose();
  }
}
