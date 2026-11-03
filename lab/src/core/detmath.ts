// Deterministic maths for anything that feeds the physics.
//
// JavaScript's + - * / and comparisons are exactly specified (IEEE 754 double,
// round to nearest), so they give the same bits in every browser on every CPU.
// Math.sin, Math.cos, Math.exp, Math.pow and friends are NOT: engines may
// differ in the last bit. Anything that decides where a body starts or how it
// moves must use the functions here instead.

const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/** sin(x) using only + - * /. Accurate to about 1e-15 for |x| < 1e6. */
export function dsin(x: number): number {
  // Range reduce to [-pi, pi] by subtracting whole turns.
  let k = x / TWO_PI;
  k = k < 0 ? -Math.floor(-k + 0.5) : Math.floor(k + 0.5);
  let r = x - k * TWO_PI;
  // Fold to [-pi/2, pi/2] using sin(pi - r) = sin(r).
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  // Taylor series to x^17 is plenty on [-pi/2, pi/2].
  const r2 = r * r;
  let term = r;
  let sum = r;
  for (let n = 1; n <= 8; n++) {
    term = (-term * r2) / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

/** cos(x) using only + - * /. */
export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

export const DPI = PI;

/** Quaternion for a rotation of `angle` radians about the Y axis. */
export function quatY(angle: number): [number, number, number, number] {
  const h = angle / 2;
  return [0, dsin(h), 0, dcos(h)];
}

/** Quaternion for a rotation about X, then the result rotated about Y. */
export function quatYX(yaw: number, pitch: number): [number, number, number, number] {
  // q = qY * qX
  const sy = dsin(yaw / 2), cy = dcos(yaw / 2);
  const sx = dsin(pitch / 2), cx = dcos(pitch / 2);
  // qY = (0, sy, 0, cy), qX = (sx, 0, 0, cx)
  return [cy * sx, sy * cx, -sy * sx, cy * cx];
}

/**
 * Small fast seeded generator (sfc32). Integer maths only, so it is
 * identical everywhere. `fork(label)` gives an independent stream.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = seed >>> 0;
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1). Exact: built from 32 integer bits. */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  fork(label: string): Rng {
    return new Rng(hashString(label) ^ this.nextU32());
  }
}

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** FNV-1a over raw bytes, as 8 hex digits. Used for determinism checks. */
export function hashBytes(bytes: Uint8Array, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}
