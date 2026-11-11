// Track S6: "Watch a replay" on the page. A replay file runs as a match in the worker
// with nobody driving it (mode "watch"); the page looks through the overview and the
// gun views, sends nothing, and keeps this bar at the bottom: the clock, Pause, 1x,
// 2x, 4x and the way back to the menu. This module owns the bar, the file picker's
// reading and the download of a saved file; main.ts wires it in.

import { readLog, type ReadResult, type ReplayFile } from "./matchLog";
import type { ToWorker } from "./protocol";

/**
 * The fastest speed the machine can keep up with (physics steps in a replay are all there is to do): 4x while the
 * average step is under 3 ms, 2x while under 6 ms, else real time. `now` is the speed in use: it steps down when
 * the average climbs past a limit, and a speed is only offered again once the average is under it.
 */
export function speedLimit(stepMs: number): 1 | 2 | 4 {
  if (!(stepMs > 0)) return 4; // nothing measured yet
  return stepMs < 3 ? 4 : stepMs < 6 ? 2 : 1;
}

export const SPEEDS = [1, 2, 4] as const;

/** The clock as m:ss. */
export function clockOf(tick: number): string {
  const s = Math.floor(tick / 60);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Read a picked file as a replay (a file the page cannot read at all is "not a replay" too). */
export async function readReplayFile(file: File): Promise<ReadResult> {
  let text = "";
  try {
    text = await file.text();
  } catch {
    return { ok: false, why: "This is not a Keepfall replay." };
  }
  return readLog(text);
}

/** Hand a text over as a download (a Blob and a link). */
export function downloadText(text: string, name: string) {
  downloadBlob(new Blob([text], { type: "application/json" }), name);
}

/** Hand a file to the person (the film and the photo of S5 use it too). */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export interface WatchHooks {
  send(m: ToWorker): void;
  /** Pause or resume (main's setPause). */
  pause(on: boolean): void;
  /** Leave the replay for the start menu. */
  back(): void;
  /** Offer only the speeds the machine keeps up with (off on the test clock, which keeps up by definition). */
  gate: boolean;
}

export class Watch {
  speed = 1;
  /** The match's last tick (the file's), and whether the worker has reported it. */
  final = 0;
  ended = false;
  active = false;
  private bar = document.getElementById("watch-bar")!;
  private clock = document.getElementById("watch-clock")!;
  private pauseBtn = document.getElementById("watch-pause") as HTMLButtonElement;
  private endEl = document.getElementById("watch-end")!;
  private speedBtns = [...document.querySelectorAll<HTMLButtonElement>("[data-watch-speed]")];

  constructor(private o: WatchHooks) {
    this.pauseBtn.addEventListener("click", () => {
      this.pauseBtn.blur();
      o.pause(this.pauseBtn.getAttribute("aria-pressed") !== "true");
    });
    for (const b of this.speedBtns) {
      b.addEventListener("click", () => {
        b.blur();
        if (!b.disabled) this.setSpeed(Number(b.dataset.watchSpeed));
      });
    }
    document.getElementById("watch-back")!.addEventListener("click", () => o.back());
  }

  /** A replay starts. */
  begin(log: ReplayFile) {
    this.active = true;
    this.ended = false;
    this.final = log.final.tick;
    this.speed = 1;
    this.bar.hidden = false;
    this.endEl.hidden = true;
    this.endEl.textContent = "";
    this.setPaused(false);
    this.show(0);
    this.limit(1);
  }

  /** The replay is left (another mode starts, or the menu). */
  stop() {
    this.active = false;
    this.bar.hidden = true;
  }

  setPaused(on: boolean) {
    this.pauseBtn.setAttribute("aria-pressed", String(on));
    this.pauseBtn.textContent = on ? "Resume" : "Pause";
  }

  setSpeed(f: number) {
    if (!SPEEDS.includes(f as 1 | 2 | 4)) return;
    this.speed = f;
    this.o.send({ t: "speed", factor: f });
    this.show(this.lastTick);
  }

  private lastTick = 0;
  /** Every frame the worker sends: the clock, and which speeds the machine keeps up with. */
  frame(tick: number, stepMs: number) {
    if (!this.active) return;
    this.lastTick = tick;
    this.show(tick);
    this.limit(this.o.gate ? speedLimit(stepMs) : 4);
  }

  /** Disable the speeds above `top`, and step down to it if the replay runs faster. */
  private limit(top: number) {
    for (const b of this.speedBtns) b.disabled = Number(b.dataset.watchSpeed) > top;
    if (this.speed > top) this.setSpeed(top);
  }

  private show(tick: number) {
    this.clock.textContent = `${clockOf(tick)} / ${clockOf(this.final)}`;
    for (const b of this.speedBtns) b.setAttribute("aria-pressed", String(Number(b.dataset.watchSpeed) === this.speed));
  }

  /** The worker reached the saved match's last tick. */
  end(ok: boolean) {
    this.ended = true;
    this.endEl.hidden = false;
    this.endEl.textContent = ok ? "End of the replay" : "End of the replay. This replay drifted from the saved match";
    this.show(this.final);
  }
}
