// Materials for the instanced castle pieces: masonry (boxes and tower
// wedges), wood (gate leaves, keep platform), plaster (house walls), roofs and
// the banner poles. Every style builds its own set; the instancing code (custom
// position + quaternion attributes) is shared.

import * as THREE from "three/webgpu";
import {
  Fn,
  abs,
  attribute,
  clamp,
  color,
  float,
  floor,
  fract,
  hash,
  max,
  min,
  mix,
  normalGeometry,
  normalLocal,
  normalWorld,
  positionGeometry,
  positionWorld,
  cameraPosition,
  select,
  smoothstep,
  step,
  texture,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import type { WedgeSpec } from "../core/castle";
import type { StylePreset } from "./styles";
import { N, aaLine, boxUV, bumpNormal, median3, qrot } from "./tslUtils";

export type GroupKind = "stone" | "wedge" | "wood" | "plaster" | "roof" | "pole";

export interface InstanceNodes {
  local: N;
  vLocal: N;
  vN: N;
  vSize: N;
  vCol: N;
  vShade: N;
}

/**
 * Hook the custom instancing into a node material: per-instance position and
 * quaternion (dynamic) plus half extents, bevel radius and colour (static).
 */
export function applyInstancing(mat: THREE.NodeMaterial, isWedge: boolean, sharp = false): InstanceNodes {
  const iPS = attribute("iPosShade", "vec4");
  const iQ = attribute("iQuat", "vec4");
  const iSz = attribute("iSize", "vec4");
  const iCol = attribute("iColor", "vec4");
  const local: N = isWedge
    ? positionGeometry
    : sharp
      ? positionGeometry.mul((iSz as N).xyz)
      : positionGeometry.mul(max((iSz as N).xyz.sub((iSz as N).w), 0.0)).add(normalGeometry.mul((iSz as N).w));
  mat.positionNode = Fn(() => {
    normalLocal.assign(qrot(iQ, normalGeometry));
    return qrot(iQ, local).add((iPS as N).xyz);
  })();
  return {
    local,
    vLocal: varying(local, "vLocal"),
    vN: varying(normalGeometry, "vLocalN"),
    vSize: varying(iSz, "vSize"),
    vCol: varying(iCol, "vCol"),
    vShade: varying((iPS as N).w, "vShade"),
  };
}

function fadeByDistance(near: number, far: number): N {
  const d = positionWorld.sub(cameraPosition).length();
  return float(1).sub(smoothstep(near, far, d));
}

interface Ctx {
  style: StylePreset;
  wedge: WedgeSpec;
  noise: THREE.Texture;
}

function newMaterial(style: StylePreset): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.flatShading = style.geometry.flat;
  m.metalness = 0;
  return m;
}

function masonry(ctx: Ctx, isWedge: boolean): THREE.MeshStandardNodeMaterial {
  const { style, wedge, noise } = ctx;
  const S = style.stone;
  const mat = newMaterial(style);
  mat.name = isWedge ? `${style.name}-wedge` : `${style.name}-stone`;
  const I = applyInstancing(mat, isWedge);
  const p: N = I.vLocal;
  const n: N = I.vN;
  const shade: N = I.vShade;

  // Distance to the nearest edge of the current face, in metres.
  let edge: N;
  let relY: N;
  if (isWedge) {
    const sa = Math.sin(wedge.halfAngle);
    const ca = Math.cos(wedge.halfAngle);
    const zIn = wedge.rIn * ca - wedge.rc;
    const zOut = wedge.rOut * ca - wedge.rc;
    const ex = p.z.add(wedge.rc).mul(sa).sub(abs(p.x).mul(ca));
    const ey = float(wedge.hy).sub(abs(p.y));
    const ez = min(p.z.sub(zIn), float(zOut).sub(p.z));
    edge = median3(ex, ey, ez);
    relY = p.y.div(wedge.hy);
  } else {
    const e = I.vSize.xyz.sub(abs(p));
    edge = median3(e.x, e.y, e.z);
    relY = p.y.div(max(I.vSize.y, 0.05));
  }

  const uv: N = boxUV(p, n).add(vec2(shade.mul(37.13), fract(shade.mul(91.7)).mul(17.0)));
  const big: N = texture(noise, uv.mul(0.31));
  const fine: N = texture(noise, uv.mul(1.17).add(0.5));
  const detailFade = fadeByDistance(40, 160);

  const colorFn = Fn(() => {
    const c: N = I.vCol.rgb.toVar();
    if (S.detail > 0) {
      const d = big.r.sub(0.5).mul(S.detail * 1.2).add(fine.g.sub(0.5).mul(S.detail * 0.8 * 1)).mul(mix(0.4, 1.0, detailFade));
      c.mulAssign(float(1).add(d));
    }
    if (S.bump > 0) {
      // Cracks and pits from the cellular channel.
      const crack = float(1).sub(smoothstep(0.0, 0.05, big.b)).mul(detailFade);
      c.mulAssign(float(1).sub(crack.mul(0.22)));
      // Vertical weathering streaks running down the wall (world height).
      const streak = texture(noise, vec2(uv.x.mul(0.45), positionWorld.y.mul(0.035).add(shade.mul(0.2)))).r;
      c.mulAssign(float(1).sub(smoothstep(0.45, 0.75, streak).mul(0.3)));
      // Brown-green staining blotches.
      const stain = smoothstep(0.55, 0.8, texture(noise, uv.mul(0.11).add(0.7)).r);
      c.assign(mix(c, c.mul(vec3(0.82, 0.78, 0.62)), stain.mul(0.6)));
    }
    // Each block a touch darker towards its bottom: reads as stacked masonry.
    c.mulAssign(mix(float(S.bottomShade), float(1.0), smoothstep(-1.0, 0.25, relY)));
    // Grime and damp near the ground.
    if (S.grime > 0) {
      const g = float(1).sub(smoothstep(0.0, 2.6, positionWorld.y)).mul(S.grime);
      c.assign(mix(c, c.mul(vec3(0.62, 0.6, 0.52)), g));
    }
    if (S.moss > 0) {
      const mossMask = smoothstep(0.45, 0.75, texture(noise, uv.mul(0.17)).r);
      const up = smoothstep(0.55, 0.95, normalWorld.y);
      const low = float(1).sub(smoothstep(0.0, 1.6, positionWorld.y));
      const amount = clamp(up.mul(0.8).add(low.mul(0.6)), 0, 1).mul(mossMask).mul(S.moss);
      c.assign(mix(c, color(S.mossColor).mul(fine.g.mul(0.5).add(0.75)), amount));
    }
    if (S.mortarWidth > 0) {
      const m = aaLine(edge, S.mortarWidth);
      c.assign(mix(c, color(S.mortar), m.mul(0.8)));
    }
    return c;
  });
  mat.colorNode = colorFn();
  if (S.detail > 0) {
    mat.roughnessNode = clamp(float(S.roughness).add(fine.g.sub(0.5).mul(0.25)).add(big.b.mul(-0.05)), 0.35, 1.0);
  } else {
    mat.roughness = S.roughness;
  }
  if (S.bump > 0) {
    const h = fine.g.mul(0.6).add(big.r.mul(0.3)).sub(float(1).sub(smoothstep(0.0, 0.05, big.b)).mul(0.15));
    mat.normalNode = bumpNormal(h, float(S.bump * 0.9).mul(fadeByDistance(12, 60)));
  }
  return mat;
}

function wood(ctx: Ctx): THREE.MeshStandardNodeMaterial {
  const { style, noise } = ctx;
  const mat = newMaterial(style);
  mat.name = `${style.name}-wood`;
  const I = applyInstancing(mat, false);
  const p: N = I.vLocal;
  const isGate: N = I.vSize.y.greaterThan(I.vSize.x);
  const across: N = select(isGate, p.x, p.z);
  const along: N = select(isGate, p.y, p.x);
  const plankW = 0.27;
  const pc: N = across.div(plankW).add(7.0);
  const plank: N = floor(pc);
  const seamDist: N = float(0.5).sub(abs(fract(pc).sub(0.5))).mul(plankW);
  mat.colorNode = Fn(() => {
    const grain = texture(noise, vec2(across.mul(2.2).add(plank.mul(0.37)), along.mul(0.18))).g;
    const tint = hash(plank.add(I.vShade.mul(97.0)).add(13.0)).mul(0.3).add(0.85);
    const c: N = mix(color(style.woodDark), color(style.wood), grain.mul(0.9).add(0.25)).mul(tint).toVar();
    if (!style.geometry.flat) c.assign(mix(c, color(style.woodDark).mul(0.55), aaLine(seamDist, 0.014)));
    // Iron bands across the gate leaves.
    const band = max(aaLine(abs(p.y.sub(1.35)), 0.09), aaLine(abs(p.y.add(1.35)), 0.09)).mul(select(isGate, 1.0, 0.0));
    c.assign(mix(c, color(style.iron), band));
    return c;
  })();
  mat.roughness = style.geometry.flat ? 0.95 : 0.82;
  return mat;
}

function plaster(ctx: Ctx): THREE.MeshStandardNodeMaterial {
  const { style, noise } = ctx;
  const mat = newMaterial(style);
  mat.name = `${style.name}-plaster`;
  const I = applyInstancing(mat, false);
  const p: N = I.vLocal;
  const n: N = I.vN;
  const sz: N = I.vSize;
  const sideZ: N = abs(n.z).greaterThan(0.5);
  const sideX: N = abs(n.x).greaterThan(0.5);
  const u: N = select(sideZ, p.x, p.z);
  const L: N = select(sideZ, sz.x, sz.z).mul(2.0);
  const v: N = p.y;
  const H: N = sz.y;
  const big: N = sideZ.or(sideX);
  mat.colorNode = Fn(() => {
    const tex = texture(noise, boxUV(p, n).mul(0.6).add(I.vShade.mul(11.0)));
    const c: N = color(style.plaster).mul(tex.r.sub(0.5).mul(0.12).add(1.0)).toVar();
    // Damp at the bottom.
    c.mulAssign(mix(0.82, 1.0, smoothstep(0.0, 0.9, positionWorld.y)));
    // Windows, spaced along the wall.
    const count = max(floor(L.div(2.3)), 1.0);
    const cell = L.div(count);
    const local = fract(u.add(L.mul(0.5)).div(cell)).sub(0.5).mul(cell);
    const wy = v.sub(H.mul(0.12));
    const winHalf = vec2(0.34, 0.42);
    const dx = abs(local).sub(winHalf.x);
    const dy = abs(wy).sub(winHalf.y);
    const inside = float(1).sub(step(0.0, max(dx, dy)));
    const frame = float(1).sub(step(0.0, max(dx.sub(0.08), dy.sub(0.08)))).sub(inside);
    const win: N = select(big, inside, float(0.0));
    const frm: N = select(big, frame, float(0.0));
    // Glass: dark with a faint sky tint at the top.
    const glass = mix(vec3(0.05, 0.05, 0.06), vec3(0.18, 0.22, 0.28), smoothstep(-0.4, 0.4, wy));
    if (style.name !== "lowpoly") {
      // Half timbering: corner posts, sill and head beams.
      const post = aaLine(L.mul(0.5).sub(abs(u)), 0.16);
      const beamTop = aaLine(H.sub(v), 0.14);
      const beamBot = aaLine(v.add(H), 0.16);
      const mid = aaLine(abs(v.add(H.mul(0.42))), 0.07);
      const timber: N = select(big, max(max(post, beamTop), max(beamBot, mid)), float(0.0));
      c.assign(mix(c, color(style.timber), clamp(timber, 0, 1)));
      c.assign(mix(c, color(style.timber).mul(1.1), frm));
    } else {
      c.assign(mix(c, color(style.wood), frm));
    }
    c.assign(mix(c, glass, win));
    return c;
  })();
  mat.roughness = 0.92;
  return mat;
}

function roof(ctx: Ctx): THREE.MeshStandardNodeMaterial {
  const { style, noise } = ctx;
  const mat = newMaterial(style);
  mat.name = `${style.name}-roof`;
  const I = applyInstancing(mat, false);
  const p: N = I.vLocal;
  const n: N = I.vN;
  const slopeSign: N = I.vCol.w;
  const top: N = n.y.greaterThan(0.5);
  const up: N = p.z.mul(slopeSign);
  const rowH = style.geometry.flat ? 0.5 : 0.3;
  const rc: N = up.div(rowH).add(40.0);
  const row: N = floor(rc);
  const fr: N = fract(rc);
  const colW = 0.32;
  const cc: N = p.x.div(colW).add(row.mul(0.5)).add(40.0);
  const colId: N = floor(cc);
  const fc: N = fract(cc);
  mat.colorNode = Fn(() => {
    const c: N = I.vCol.rgb.toVar();
    const tileVar = hash(row.mul(31.0).add(colId).add(I.vShade.mul(1000.0))).sub(0.5);
    if (style.geometry.flat) {
      c.mulAssign(select(top, mix(0.92, 1.04, fr), 0.85));
    } else {
      const g = texture(noise, vec2(p.x, up).mul(0.9)).g;
      // Lighter at each tile's lower lip, shadowed under the next row.
      const lip = mix(1.08, 0.66, smoothstep(0.0, 1.0, fr));
      const seamV = aaLine(float(0.5).sub(abs(fc.sub(0.5))).mul(colW), 0.012);
      const t = float(1).add(tileVar.mul(0.22)).add(g.sub(0.5).mul(0.18));
      const tiled = c.mul(lip).mul(t).mul(float(1).sub(seamV.mul(0.45)));
      c.assign(select(top, tiled, c.mul(0.6)));
    }
    return c;
  })();
  mat.roughness = style.name === "gritty" ? 0.7 : 0.85;
  return mat;
}

function pole(ctx: Ctx): THREE.MeshStandardNodeMaterial {
  const { style, noise } = ctx;
  const mat = newMaterial(style);
  mat.name = `${style.name}-pole`;
  const I = applyInstancing(mat, false);
  const p: N = I.vLocal;
  mat.colorNode = color(style.pole).mul(texture(noise, vec2(p.x.add(p.z).mul(3.0), p.y.mul(0.3))).g.mul(0.4).add(0.8));
  mat.roughness = 0.7;
  return mat;
}

/** Cheap material for the shadow-only proxies (plain boxes, no bevel). */
export function makeProxyMaterial(isWedge: boolean): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.name = isWedge ? "proxy-wedge" : "proxy-box";
  applyInstancing(mat, isWedge, true);
  return mat;
}

export function makeGroupMaterial(kind: GroupKind, ctx: Ctx): THREE.MeshStandardNodeMaterial {
  switch (kind) {
    case "stone":
      return masonry(ctx, false);
    case "wedge":
      return masonry(ctx, true);
    case "wood":
      return wood(ctx);
    case "plaster":
      return plaster(ctx);
    case "roof":
      return roof(ctx);
    case "pole":
      return pole(ctx);
  }
}
