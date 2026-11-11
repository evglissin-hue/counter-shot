// 3.2 range and register, the page's side: what a mark is called from where it
// lies, the key pair F and a number that orders fire for effect, and the row of
// numbered chips on the command card (one per mark, a ring that drains as it
// fades). Page only: the rules are in @keepfall/rules (Register).

import { BRIDGES, CASTLE_SHAPE, DIST } from "@keepfall/content";
import type { MarkInfo } from "./protocol";

/** A mark within this many metres of a gate is "at the gate". */
const GATE_NEAR = 9;
/** A mark this near a bridge's centre across the road, and this near along it, is "at the bridge" (the road just short of it). */
const BRIDGE_X = 14, BRIDGE_Z = 24;

/**
 * Where a mark lies, in words, as the page's own player sees it (me: castle 0 or 1; the guest
 * plays castle 0, so its left is the match's right). `ground` is the terrain's height there:
 * a mark well above it lies on masonry.
 */
export function placeName(me: 0 | 1, x: number, y: number, z: number, ground: number): string {
  const half = CASTLE_SHAPE.half;
  const foe = me === 1 ? 0 : 1;
  const centreZ = (c: number) => (c === 0 ? 0 : -DIST);
  const gateZ = (c: number) => centreZ(c) + (c === 0 ? -half : half);
  if (Math.hypot(x, z - gateZ(foe)) <= GATE_NEAR) return "Their gate";
  if (y > ground + 0.5 && Math.abs(x) <= half + 4 && Math.abs(z - centreZ(foe)) <= half + 4) return "Their wall";
  if (Math.hypot(x, z - gateZ(me)) <= GATE_NEAR) return "Our gate";
  for (const b of BRIDGES) {
    if (Math.abs(x - b.x) > BRIDGE_X || Math.abs(z - b.z) > BRIDGE_Z) continue;
    const side = me === 0 && b.name !== "centre" ? (b.name === "left" ? "right" : "left") : b.name;
    return `${side === "left" ? "Left" : side === "right" ? "Right" : "Centre"} bridge`;
  }
  return "Field";
}

/**
 * Why a mark can or cannot be ordered now: the words of its chip's title and of the refusal note.
 * `mortar`: the mortar is in the salvo. null `why` means some gun bears.
 */
export function bearWhy(m: MarkInfo, mortar: boolean): string | null {
  if ((mortar ? m.bearM : m.bear) > 0) return null;
  if (!mortar && m.bearM > 0) return "Only the mortar bears: tick Mortar in the salvo";
  if ((mortar ? m.reachM : m.reach) > 0) return `Guns loading (${Math.max(1, mortar ? m.loadMS : m.loadS)} s)`;
  return "No gun bears";
}

/** Seconds a half-typed fire for effect waits for its number. */
export const SALVO_WAIT_MS = 2000;

/**
 * The keys of fire for effect: F, then a mark's number (the keys 1 to 6); F twice is the newest
 * mark; F then anything else, or SALVO_WAIT_MS of nothing, cancels.
 */
export class SalvoKeys {
  armedAt = -1;
  get armed(): boolean {
    return this.armedAt >= 0;
  }

  /**
   * One frame's keys. `digit` is the weapon key pressed (0 to 7, or -1), `other` any other key.
   * Returns the order: 0 the newest mark, 1 to 6 that mark, -1 none; `eat` says the digit was ours
   * (it must not switch the gun).
   */
  step(now: number, f: boolean, digit: number, other: boolean): { order: number; eat: boolean } {
    if (this.armedAt >= 0 && now - this.armedAt > SALVO_WAIT_MS) this.armedAt = -1;
    // F and its number may land in the same frame (a quick typist, a test): F arms, then the number is read at once.
    const fresh = this.armedAt < 0 && f;
    if (fresh) this.armedAt = now;
    if (this.armedAt < 0) return { order: -1, eat: false };
    if (f && !fresh) {
      this.armedAt = -1;
      return { order: 0, eat: false };
    }
    if (digit >= 0) {
      this.armedAt = -1;
      return { order: digit < 6 ? digit + 1 : -1, eat: true };
    }
    if (other) this.armedAt = -1;
    return { order: -1, eat: false };
  }

  cancel() {
    this.armedAt = -1;
  }
}

/** The newest mark's number (made last), or 0 when there is none. */
export function newestMark(marks: MarkInfo[]): number {
  let best: MarkInfo | null = null;
  for (const m of marks) if (!best || m.made > best.made || (m.made === best.made && m.n > best.n)) best = m;
  return best ? best.n : 0;
}

/** The command card's row of marks: a chip for each, its ring draining as the mark fades, and the mortar toggle at the row's end. */
export class MarkChips {
  private chips = new Map<number, { el: HTMLButtonElement; place: HTMLElement; sec: HTMLElement; key: string }>();

  constructor(
    private row: HTMLElement,
    private list: HTMLElement,
    private onOrder: (n: number) => void,
  ) {
    row.hidden = true;
  }

  /** Redraw from what the worker reports. `mortar`: the mortar is in the salvo (its guns count for "bears"). */
  update(marks: MarkInfo[], salvoReady: number, mortar: boolean) {
    this.row.hidden = marks.length === 0;
    const have = new Set(marks.map((m) => m.n));
    for (const [n, c] of this.chips) {
      if (have.has(n)) continue;
      c.el.remove();
      this.chips.delete(n);
    }
    const sorted = marks.slice().sort((a, b) => a.n - b.n);
    let added = false;
    for (const m of sorted) {
      let c = this.chips.get(m.n);
      if (!c) {
        const el = document.createElement("button");
        el.className = "chip";
        el.dataset.n = String(m.n);
        el.innerHTML = `<i class="ring"><b>${m.n}</b></i><span class="pl"></span><span class="sec"></span>`;
        el.addEventListener("click", () => {
          this.onOrder(m.n);
          el.blur();
        });
        c = { el, place: el.querySelector(".pl")!, sec: el.querySelector(".sec")!, key: "" };
        this.chips.set(m.n, c);
        added = true;
      }
      if (c.place.textContent !== m.place) c.place.textContent = m.place;
      const why = bearWhy(m, mortar);
      const bears = why === null;
      const wait = salvoReady > 0 ? `${Math.ceil(salvoReady / 60)} s` : "";
      const key = `${why}|${wait}`;
      if (key !== c.key) {
        c.key = key;
        c.el.classList.toggle("dim", !bears);
        c.sec.textContent = wait;
        c.el.title = bears ? `Fire for effect at mark ${m.n} (F, ${m.n})` : why;
        c.el.setAttribute("aria-label", `Mark ${m.n}, ${m.place}${bears ? "" : `, ${why!.toLowerCase()}`}${wait ? `, ready in ${wait}` : ""}`);
      }
      const p = Math.max(0, Math.min(1, m.left / m.life));
      c.el.style.setProperty("--p", p.toFixed(3));
      c.el.classList.toggle("low", p < 0.15);
    }
    // Keep the chips in the order of their numbers (only when one came: a chip moved between a press and its release would lose the click).
    if (added) for (const m of sorted) this.list.appendChild(this.chips.get(m.n)!.el);
  }

  /** Test hook: what the chips read. */
  get shown(): Array<{ n: number; place: string; dim: boolean; sec: string; title: string }> {
    return [...this.chips.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, c]) => ({ n, place: c.place.textContent ?? "", dim: c.el.classList.contains("dim"), sec: c.sec.textContent ?? "", title: c.el.title }));
  }
}
