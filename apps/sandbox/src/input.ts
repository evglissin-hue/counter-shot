// Keyboard, mouse (pointer lock), wheel and gamepad, folded into one per-frame
// snapshot. The page turns it into aim changes and actions.

export interface Pressed {
  fire: boolean;
  next: boolean;
  prev: boolean;
  weapon: number; // 0..3, or -1
  overview: boolean;
  shotCam: boolean;
  spin: boolean;
  fuseUp: boolean;
  fuseDown: boolean;
  help: boolean;
}

export class Input {
  /** Accumulated mouse movement in pixels since the last read (pointer locked only). */
  mouseX = 0;
  mouseY = 0;
  /** Wheel steps since the last read (positive = towards the user). */
  wheel = 0;
  wheelAlt = 0;
  zoomHeld = false;
  private keys = new Set<string>();
  private edges = new Set<string>();
  private padPrev: boolean[] = [];
  locked = false;
  fireHeld = false;
  usedPad = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (isTyping(e)) return;
      if (e.code === "Tab") e.preventDefault();
      if (!e.repeat) this.edges.add(e.code);
      this.keys.add(e.code);
      this.usedPad = false;
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        if (!this.locked) canvas.requestPointerLock?.();
        else this.edges.add("Mouse0");
      }
      if (e.button === 2) this.zoomHeld = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 2) this.zoomHeld = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
    });
    window.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.mouseX += e.movementX;
      this.mouseY += e.movementY;
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const s = Math.sign(e.deltaY);
        if (e.altKey) this.wheelAlt += s;
        else this.wheel += s;
      },
      { passive: false },
    );
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** Axis from two keys: -1, 0 or 1. */
  axis(neg: string, pos: string): number {
    return (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0);
  }

  gamepad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Edge-triggered actions since the last call. */
  read(): Pressed {
    const e = this.edges;
    const pad = this.gamepad();
    const b = pad ? pad.buttons.map((x) => x.pressed) : [];
    const edge = (i: number) => !!b[i] && !this.padPrev[i];
    if (pad && b.some(Boolean)) this.usedPad = true;
    let weapon = -1;
    for (let i = 0; i < 4; i++) if (e.has(`Digit${i + 1}`)) weapon = i;
    const out: Pressed = {
      fire: e.has("Space") || e.has("Mouse0") || edge(7),
      next: e.has("KeyE") || edge(5),
      prev: e.has("KeyQ") || edge(4),
      weapon,
      overview: e.has("Tab") || edge(8),
      shotCam: e.has("KeyV") || edge(3),
      spin: e.has("KeyR") || edge(2),
      fuseUp: e.has("BracketRight") || edge(12),
      fuseDown: e.has("BracketLeft") || edge(13),
      help: e.has("KeyH") || edge(9),
    };
    this.padPrev = b;
    e.clear();
    return out;
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
}
