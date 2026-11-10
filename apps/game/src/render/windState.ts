// The CPU half of the game's wind field (look round L3), with no three import so
// Node tests can run it. WindField (windField.ts) wraps this and copies its
// numbers into uniforms; everything here is plain numbers.
//
// See windField.ts for the idea: a coming gust is a front that starts upwind at
// FRONT_SPEED times the time left and reaches the anchor (the gun you ride) as
// the gust does, then rolls on downwind as a passing front that fades.

/** How fast a front crosses the land (m/s). A gust 2 to 5 s out starts 60 to 150 m upwind. */
export const FRONT_SPEED = 30;
/** Half width of a front's band on the land (m). */
export const BAND = 9;
/** How long a passing front rolls on downwind before it has faded (s). */
export const PASS_FADE = 5;
/** The strongest wind the match makes (m/s; sim Wind's maxSpeed with a full gust), for normalising. */
export const WIND_MAX = 13.75;
/** How fast the upwind side eases to a new gust's wind (1/s), so a new front never snaps the far land. */
export const NEXT_EASE = 3;
/** The drift wraps here (m) so noise lookups stay precise. */
const DRIFT_WRAP = 4096;

export class WindState {
  nowX = 0;
  nowZ = 0;
  nextX = 0;
  nextZ = 0;
  /** The coming front: a point on it and the unit direction it travels (downwind). */
  frontX = 0;
  frontZ = -1e5;
  frontDirX = 0;
  frontDirZ = 1;
  /** The passing front, the same way. */
  pastX = 0;
  pastZ = -1e5;
  pastDirX = 0;
  pastDirZ = 1;
  /** Signed size of the coming front's change, and the passing one's (faded). */
  changeNext = 0;
  changePast = 0;
  /** The wind integrated over time (m). */
  driftX = 0;
  driftZ = 0;
  /** Seconds until the coming front reaches the anchor. */
  left = 0;
  hasLead = false;
  private anchorX = 0;
  private anchorZ = -150;
  private leadX = 0;
  private leadZ = 0;
  /** The wind the coming gust eases away from (the last gust's target), so the front's size holds while it travels. */
  private fromX = 0;
  private fromZ = 0;
  private dirX = 0;
  private dirZ = 1;
  private pastAge = PASS_FADE;
  private pastChange = 0;
  private pastStartX = 0;
  private pastStartZ = -1e5;
  private pastStartDirX = 0;
  private pastStartDirZ = 1;

  /** Each sim frame: the wind now and where it is heading (gust fields may be missing in old frames: then no front shows). */
  setFrame(windX: number, windZ: number, gustX?: number, gustZ?: number, gustIn?: number) {
    this.nowX = windX || 0;
    this.nowZ = windZ || 0;
    if (gustX === undefined || gustZ === undefined || gustIn === undefined) {
      this.hasLead = false;
      this.leadX = this.nowX;
      this.leadZ = this.nowZ;
      this.left = 0;
      return;
    }
    const left = gustIn / 60;
    if (!this.hasLead) {
      this.fromX = this.nowX;
      this.fromZ = this.nowZ;
    }
    // A new gust began: the front that was coming has reached the gun and rolls on.
    if (this.hasLead && left > this.left + 0.25) {
      // The wind now has eased all the way to the old lead by here, so the front's size is measured from where the gust began, not from the wind now.
      this.pastAge = 0;
      this.pastChange = changeOf(this.leadX, this.leadZ, this.fromX, this.fromZ);
      this.fromX = this.leadX;
      this.fromZ = this.leadZ;
      this.pastStartX = this.anchorX;
      this.pastStartZ = this.anchorZ;
      this.pastStartDirX = this.dirX;
      this.pastStartDirZ = this.dirZ;
    }
    this.hasLead = true;
    this.leadX = gustX;
    this.leadZ = gustZ;
    this.left = left;
  }

  setAnchor(x: number, z: number) {
    this.anchorX = x;
    this.anchorZ = z;
  }

  /** Once per rendered frame (cosmetic dt). */
  update(dt: number) {
    this.driftX += this.nowX * dt;
    this.driftZ += this.nowZ * dt;
    if (Math.abs(this.driftX) > DRIFT_WRAP) this.driftX -= Math.sign(this.driftX) * DRIFT_WRAP;
    if (Math.abs(this.driftZ) > DRIFT_WRAP) this.driftZ -= Math.sign(this.driftZ) * DRIFT_WRAP;
    const k = 1 - Math.exp(-dt * NEXT_EASE);
    this.nextX += (this.leadX - this.nextX) * k;
    this.nextZ += (this.leadZ - this.nextZ) * k;
    this.left = Math.max(0, this.left - dt);
    const sp = Math.hypot(this.nextX, this.nextZ);
    if (sp > 0.05) {
      this.dirX = this.nextX / sp;
      this.dirZ = this.nextZ / sp;
    }
    const dist = this.hasLead ? this.left * FRONT_SPEED : 0;
    this.frontX = this.anchorX - this.dirX * dist;
    this.frontZ = this.anchorZ - this.dirZ * dist;
    this.frontDirX = this.dirX;
    this.frontDirZ = this.dirZ;
    this.pastAge += dt;
    const fade = Math.max(0, 1 - this.pastAge / PASS_FADE);
    const travelled = this.pastAge * FRONT_SPEED;
    this.pastX = this.pastStartX + this.pastStartDirX * travelled;
    this.pastZ = this.pastStartZ + this.pastStartDirZ * travelled;
    this.pastDirX = this.pastStartDirX;
    this.pastDirZ = this.pastStartDirZ;
    this.changeNext = this.hasLead ? changeOf(this.nextX, this.nextZ, this.fromX, this.fromZ) : 0;
    this.changePast = this.pastChange * fade;
  }

  /** The wind at (x, z): the coming wind upwind of the front, the wind now downwind of it, blended across the band. */
  sampleAt(x: number, z: number, out: { x: number; z: number }) {
    const s = (x - this.frontX) * this.frontDirX + (z - this.frontZ) * this.frontDirZ;
    const behind = 1 - Math.min(1, Math.max(0, (s / BAND) * 0.5 + 0.5));
    out.x = this.nowX + (this.nextX - this.nowX) * behind;
    out.z = this.nowZ + (this.nextZ - this.nowZ) * behind;
  }

  /** The signed band at (x, z): + where a gust's front is passing, - for a lull. */
  bandAt(x: number, z: number): number {
    const a = ((x - this.frontX) * this.frontDirX + (z - this.frontZ) * this.frontDirZ) / BAND;
    const b = ((x - this.pastX) * this.pastDirX + (z - this.pastZ) * this.pastDirZ) / BAND;
    return Math.exp(-a * a) * this.changeNext + Math.exp(-b * b) * this.changePast;
  }
}

export function changeOf(ax: number, az: number, bx: number, bz: number): number {
  const a = Math.hypot(ax, az), b = Math.hypot(bx, bz);
  return Math.max(-1, Math.min(1, (a - b) / Math.max(b, 2)));
}
