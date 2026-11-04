// Overcast sky dome with a gradient, sun glow, sun disc and a projected
// cloud layer, plus a matching height fog. The fog colour blends into the
// sky's own horizon colour with distance, so far hills melt into the sky.

import * as THREE from "three/webgpu";
import {
  Fn,
  abs,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  fog,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  select,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import type { StylePreset } from "./styles";
import type { N } from "./tslUtils";

function u3(hex: number) {
  return uniform(new THREE.Color(hex));
}

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly sunDir = uniform(new THREE.Vector3(0, 1, 0));
  readonly time = uniform(0);
  private readonly u = {
    zenith: u3(0x5f97d6),
    horizon: u3(0xf6e3c4),
    ground: u3(0xd8cdb4),
    glow: u3(0xffc68c),
    glowPower: uniform(6),
    glowStrength: uniform(0.8),
    sunDisc: u3(0xffffff),
    sunDiscSize: uniform(0.9994),
    haze: u3(0xffffff),
    hazeHeight: uniform(0.2),
    clouds: uniform(0.4),
    cloudColor: u3(0xffffff),
    cloudShade: u3(0xcccccc),
    cloudScale: uniform(1),
    cloudSharp: uniform(0.5),
    cloudFade: uniform(0.18),
    fogColor: u3(0xc0c8d0),
    fogSun: u3(0xffe0c0),
    fogDensity: uniform(0.001),
    fogFalloff: uniform(0.01),
    sunIntensity: uniform(1),
  };
  private noise: THREE.Texture;

  constructor(noise: THREE.Texture) {
    this.noise = noise;
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.side = THREE.BackSide;
    mat.depthWrite = false;
    mat.fog = false;
    mat.name = "sky";
    const dir = normalize(positionWorld.sub(cameraPosition));
    mat.colorNode = this.skyColor(dir, true);
    const geo = new THREE.SphereGeometry(4000, 48, 24);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = "sky";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  /** Sky radiance in direction `dir` (unit). `withSun` adds the disc and clouds. */
  skyColor(dir: N, withSun: boolean): N {
    const u = this.u;
    const sunDir = this.sunDir;
    const noise = this.noise;
    return Fn(() => {
      const y = dir.y;
      const up = max(y, 0.0);
      const t = pow(up, 0.5);
      const c: N = mix(u.horizon, u.zenith, smoothstep(0.0, 1.0, t)).toVar();
      // Haze band hugging the horizon.
      c.assign(mix(c, u.haze, exp(up.div(u.hazeHeight).negate()).mul(0.65)));
      const sd = max(dot(dir, sunDir), 0.0);
      // Broad glow around the sun, plus a tighter halo.
      c.addAssign(u.glow.mul(pow(sd, u.glowPower).mul(u.glowStrength)));
      c.addAssign(u.glow.mul(pow(sd, u.glowPower.mul(8.0)).mul(u.glowStrength.mul(0.8))));
      if (withSun) {
        // Clouds on a plane, fading out towards the horizon.
        const k = float(1).div(max(y, 0.0).add(0.09));
        const cuv = vec2(dir.x, dir.z).mul(k).mul(u.cloudScale.mul(0.055)).add(vec2(this.time.mul(0.0015), this.time.mul(0.0006)));
        const n1 = texture(noise, cuv).r;
        const n2 = texture(noise, cuv.mul(2.7).add(0.31)).g;
        const n = clamp(n1.mul(0.72).add(n2.mul(0.28)).sub(0.5).mul(2.4).add(0.5), 0.0, 1.0);
        const thr = float(1).sub(u.clouds);
        const soft = mix(0.32, 0.05, u.cloudSharp);
        const dens = smoothstep(thr.sub(soft.mul(0.5)), thr.add(soft), n);
        // Lit from the sun side: sample a little towards the sun.
        const toward = vec2(sunDir.x, sunDir.z).normalize().mul(0.025);
        const n3 = clamp(texture(noise, cuv.add(toward)).r.mul(0.72).add(texture(noise, cuv.add(toward).mul(2.7).add(0.31)).g.mul(0.28)).sub(0.5).mul(2.4).add(0.5), 0.0, 1.0);
        const lit = clamp(n.sub(n3).mul(3.0).add(0.6).sub(dens.mul(0.25)), 0.0, 1.0);
        const cloudCol = mix(u.cloudShade, u.cloudColor, lit).add(u.glow.mul(pow(sd, 4.0).mul(0.25)));
        const fade = smoothstep(0.0, this.u.cloudFade, y);
        c.assign(mix(c, cloudCol, dens.mul(fade)));
        // Sun disc (HDR, feeds the bloom), dimmed behind clouds.
        const disc = smoothstep(u.sunDiscSize, u.sunDiscSize.add(0.00025), dot(dir, sunDir));
        c.addAssign(u.sunDisc.mul(disc.mul(float(1).sub(dens.mul(0.92))).mul(u.sunIntensity).mul(22.0)));
      }
      // Below the horizon.
      c.assign(mix(c, u.ground, float(1).sub(smoothstep(-0.06, 0.0, y))));
      return c;
    })();
  }

  /** The aerial haze colour seen in direction dir (fog colour plus sun in-scatter). */
  hazeColor(dir: N): N {
    const sd = max(dot(dir, this.sunDir), 0.0);
    return mix(this.u.fogColor, this.u.fogSun, pow(sd, 6.0).mul(0.9));
  }

  /** Node for scene.fogNode: height fog with sun in-scatter, fading to the sky horizon. */
  fogNode(): N {
    const u = this.u;
    const sunDir = this.sunDir;
    const toFrag = positionWorld.sub(cameraPosition);
    const dist = toFrag.length();
    const dir = toFrag.div(max(dist, 0.001));
    const k = u.fogFalloff.mul(dir.y).mul(dist);
    const kk = select(abs(k).greaterThan(0.001), float(1).sub(exp(k.negate())).div(k), float(1));
    const od = u.fogDensity.mul(exp(u.fogFalloff.mul(cameraPosition.y).negate())).mul(dist).mul(kk);
    const f = float(1).sub(exp(od.negate()));
    const sd = max(dot(dir, sunDir), 0.0);
    const haze = mix(u.fogColor, u.fogSun, pow(sd, 6.0).mul(0.9));
    const horizonDir = normalize(vec3(dir.x, max(dir.y, 0.0).mul(0.25).add(0.015), dir.z));
    const skyAt = this.skyColor(horizonDir, false);
    const fogCol = mix(haze, skyAt, smoothstep(0.55, 1.0, f));
    return fog(fogCol, f);
  }

  setStyle(style: StylePreset) {
    const s = style.sky;
    const u = this.u;
    u.zenith.value.setHex(s.zenith);
    u.horizon.value.setHex(s.horizon);
    u.ground.value.setHex(s.ground);
    u.glow.value.setHex(s.glow);
    u.glowPower.value = s.glowPower;
    u.glowStrength.value = s.glowStrength;
    u.sunDisc.value.setHex(s.sunDisc);
    u.sunDiscSize.value = s.sunDiscSize;
    u.haze.value.setHex(s.haze);
    u.hazeHeight.value = s.hazeHeight;
    u.clouds.value = s.clouds;
    u.cloudColor.value.setHex(s.cloudColor);
    u.cloudShade.value.setHex(s.cloudShade);
    u.cloudScale.value = s.cloudScale;
    u.cloudSharp.value = s.cloudSharp;
    u.cloudFade.value = s.cloudFade;
    u.fogColor.value.setHex(style.fog.color);
    u.fogSun.value.setHex(style.fog.sunColor);
    u.fogDensity.value = style.fog.density;
    u.fogFalloff.value = style.fog.falloff;
    u.sunIntensity.value = 0.35;
    this.sunDir.value.set(style.sunDir[0], style.sunDir[1], style.sunDir[2]).normalize();
  }

  /** Keep the dome centred on the camera. */
  follow(camera: THREE.Camera) {
    this.mesh.position.copy(camera.position);
  }
}
