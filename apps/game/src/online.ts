// Play a friend (M5): the lobby on the start menu, hosting and joining a
// match, and, during it, the link between this page's worker and the
// friend's page. The host plays the oxblood castle (team 1), the guest the
// other (team 0); the host picks the match's seed. Each page's presence in
// the match room carries its lockstep state with a ping, and the friend's
// echo of it gives the round trip, from which the input delay is set.

import type { NetState } from "./lockstep";
import { matchCode, NET_VERSION, openLobby, type Friend, type Lobby, type Room } from "./net";
import type { ToWorker } from "./protocol";

export interface OnlineStart {
  team: 0 | 1;
  seed: number;
  delay: number;
  friend: string;
}

/** Where the lobby draws itself. */
export interface OnlineUi {
  panel: HTMLElement;
  status: HTMLElement;
  list: HTMLElement;
  hostBtn: HTMLButtonElement;
  wait: HTMLElement;
  code: HTMLElement;
  cancel: HTMLButtonElement;
  /** In a match: the line under the match bar (ping, waiting for the friend). */
  line: HTMLElement;
}

interface KfPresence {
  v?: number;
  role?: "host" | "guest";
  seed?: number;
  go?: boolean;
  open?: string | null;
  paused?: boolean;
}

/** The input delay for a round trip (ms): half of it each way, a little slack, and never under 4 ticks or over 30. */
export function delayFor(rtt: number): number {
  return Math.max(4, Math.min(30, Math.ceil((rtt / 2 + 35) / (1000 / 60)) + 1));
}

export class Online {
  private lobby: Lobby | null = null;
  private opening: Promise<Lobby | null> | null = null;
  private room: Room | null = null;
  private role: "host" | "guest" | null = null;
  private code = "";
  private seed = 0;
  /** The friend in the match room (their peer label), their name, and the last lockstep state of theirs passed on. */
  private friendPeer: string | null = null;
  private friendName = "";
  private lastLs: unknown = null;
  /** Round trip (ms, smoothed) and the delay it asks for; the friend's last ping, to echo. */
  rtt = 0;
  private delay = 8;
  private friendPing = 0;
  private playing = false;
  private names: Record<string, string> = {};
  private waiting = 0;
  /** Since when the friend has not been seen in the match room (ms), and whether that has been said. */
  private goneSince = 0;
  onGone: (() => void) | null = null;

  constructor(
    private ui: OnlineUi,
    private send: (m: ToWorker) => void,
    private start: (s: OnlineStart) => void,
    private note: (text: string, ms: number) => void,
  ) {
    ui.hostBtn.addEventListener("click", () => {
      ui.hostBtn.blur();
      void this.host();
    });
    ui.cancel.addEventListener("click", () => {
      ui.cancel.blur();
      void this.leave();
      this.render();
    });
  }

  /** In a match against a friend now. */
  get active(): boolean {
    return this.playing;
  }

  get friend(): string {
    return this.friendName || "your friend";
  }

  /** Show the lobby: connect to the room the first time. */
  async open() {
    this.ui.panel.hidden = false;
    if (!this.lobby) {
      this.ui.status.textContent = "Looking for the room...";
      this.opening ??= openLobby();
      this.lobby = await this.opening;
      if (!this.lobby) {
        this.ui.status.textContent = "Playing a friend needs this game opened from its claude.ai link while signed in (both of you). Share the link with your friend from the artifact's Share menu.";
        this.ui.hostBtn.disabled = true;
        return;
      }
      this.lobby.lobby.presence({ kf: { v: NET_VERSION, open: null } });
      this.lobby.lobby.onChange(() => this.render());
    }
    this.render();
  }

  /** The lobby: open matches to join, or this page's own waiting for a guest. */
  private render() {
    const ui = this.ui;
    if (!this.lobby) return;
    ui.wait.hidden = !(this.role === "host" && !this.playing);
    ui.code.textContent = this.code;
    ui.hostBtn.hidden = this.role !== null;
    const open = this.lobby.lobby
      .others()
      .map((f) => ({ f, kf: (f.presence.kf ?? {}) as KfPresence }))
      .filter(({ kf }) => typeof kf.open === "string" && kf.open.length === 4);
    ui.list.textContent = "";
    for (const { f, kf } of open) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      const who = (f.by && this.names[f.by]) || "Someone";
      label.textContent = kf.v === NET_VERSION ? `${who} is waiting for a match (${kf.open})` : `${who} is on another version of the game: reload both pages`;
      const b = document.createElement("button");
      b.textContent = "Join";
      b.className = "primary";
      b.disabled = kf.v !== NET_VERSION || this.role !== null;
      b.addEventListener("click", () => {
        b.blur();
        void this.join(kf.open as string);
      });
      li.append(label, b);
      ui.list.appendChild(li);
    }
    const ids = open.map(({ f }) => f.by).filter((x): x is string => !!x && !(x in this.names));
    if (ids.length) {
      for (const id of ids) this.names[id] = "";
      void this.lobby.names(ids).then((n) => {
        Object.assign(this.names, n);
        this.render();
      });
    }
    const here = this.lobby.lobby.others().length;
    ui.status.textContent =
      this.role === "guest"
        ? "Joining..."
        : this.role === "host"
          ? "Your friend opens the game's link, chooses Play a friend and joins your match."
          : open.length
          ? "Join a friend's match, or host your own."
          : here
            ? `${here === 1 ? "One other person has" : `${here} others have`} the game open. Host a match and ask your friend to join it.`
            : "Nobody else has the game open right now. Host a match and send your friend the game's link.";
  }

  /** Host a match: a room with a code, shown in the lobby until a friend joins. */
  private async host() {
    if (!this.lobby || this.role) return;
    this.role = "host";
    this.code = matchCode();
    this.seed = Math.floor(Math.random() * 1e9);
    this.render();
    const room = await this.lobby.join(`kf-${this.code.toLowerCase()}`);
    this.room = room;
    room.presence({ kf: { v: NET_VERSION, role: "host", seed: this.seed } });
    this.lobby.lobby.presence({ kf: { v: NET_VERSION, open: this.code } });
    room.onChange(() => this.onRoom());
  }

  /** Join a friend's match by its code. */
  private async join(code: string) {
    if (!this.lobby || this.role) return;
    this.role = "guest";
    this.code = code;
    this.render();
    const room = await this.lobby.join(`kf-${code.toLowerCase()}`);
    this.room = room;
    room.presence({ kf: { v: NET_VERSION, role: "guest" } });
    room.onChange(() => this.onRoom());
    this.onRoom();
  }

  /** The friend in the match room: the other page there, the first to come. */
  private other(): Friend | null {
    const list = this.room?.others() ?? [];
    if (this.friendPeer) return list.find((f) => f.peer === this.friendPeer) ?? null;
    return list[0] ?? null;
  }

  /** Something changed in the match room: the handshake, the friend's state, the friend leaving. */
  private onRoom() {
    const room = this.room;
    if (!room) return;
    const f = this.other();
    const kf = (f?.presence.kf ?? {}) as KfPresence;
    if (!this.playing) {
      if (!f || kf.v !== NET_VERSION) return;
      if (this.role === "host" && kf.role === "guest") {
        this.friendPeer = f.peer;
        room.presence({ kf: { v: NET_VERSION, role: "host", seed: this.seed, go: true } });
        this.lobby?.lobby.presence({ kf: { v: NET_VERSION, open: null } });
        void this.begin(1, f);
      } else if (this.role === "guest" && kf.role === "host" && kf.go && typeof kf.seed === "number") {
        this.friendPeer = f.peer;
        this.seed = kf.seed;
        void this.begin(0, f);
      }
      return;
    }
    if (!f) {
      if (!this.goneSince) this.goneSince = performance.now();
      return;
    }
    this.goneSince = 0;
    // The friend's echo of this page's ping: the round trip.
    const pong = f.presence.pong;
    if (typeof pong === "number" && pong > 0) {
      const rtt = performance.now() - pong;
      if (rtt > 0 && rtt < 5000) this.rtt = this.rtt ? this.rtt * 0.85 + rtt * 0.15 : rtt;
      const d = delayFor(this.rtt);
      if (Math.abs(d - this.delay) >= 2) {
        this.delay = d;
        this.send({ t: "delay", ticks: d });
      }
    }
    if (typeof f.presence.ping === "number") this.friendPing = f.presence.ping;
    const ls = f.presence.ls;
    if (ls && ls !== this.lastLs) {
      this.lastLs = ls;
      this.send({ t: "net", state: ls as NetState, now: performance.now() });
    }
  }

  private async begin(team: 0 | 1, f: Friend) {
    this.playing = true;
    this.ui.panel.hidden = true;
    this.friendName = "";
    if (f.by && this.lobby) {
      const n = await this.lobby.names([f.by]);
      this.friendName = n[f.by] ?? "";
    }
    this.start({ team, seed: this.seed, delay: this.delay, friend: this.friend });
  }

  /** This side's lockstep state from the worker: into the room, with a ping and the echo of the friend's. */
  fromWorker(state: NetState, waiting: number, desync: number | null) {
    if (!this.room || !this.playing) return;
    this.room.presence({ ls: state, ping: performance.now(), pong: this.friendPing });
    this.waiting = waiting;
    const gone = this.goneSince ? performance.now() - this.goneSince : 0;
    const ui = this.ui.line;
    if (desync !== null) ui.textContent = `Out of step with ${this.friend} since ${Math.floor(desync / 3600)}:${String(Math.floor(desync / 60) % 60).padStart(2, "0")}: start a new match`;
    else if (gone > 1500) ui.textContent = `${this.friend} has left the match`;
    else if (waiting > 1500) ui.textContent = `Waiting for ${this.friend}... (${Math.floor(waiting / 1000)} s)`;
    else ui.textContent = `Against ${this.friend}, ${Math.round(this.rtt)} ms`;
    ui.classList.toggle("wait", waiting > 1500 || gone > 1500 || desync !== null);
    if ((gone > 3000 || waiting > 25000) && this.onGone) {
      const fn = this.onGone;
      this.onGone = null;
      fn();
    }
  }

  /** Pausing here stops the match for both (the friend's page waits): say so in presence. */
  setPaused(on: boolean) {
    this.room?.presence({ kf: { v: NET_VERSION, role: this.role ?? undefined, seed: this.seed, go: this.role === "host" ? true : undefined, paused: on } });
  }

  /** Is the friend's page paused? */
  get friendPaused(): boolean {
    return ((this.other()?.presence.kf ?? {}) as KfPresence).paused === true;
  }

  /** How long the match has been waiting for the friend (ms). */
  get waitingMs(): number {
    return this.waiting;
  }

  /** Leave the match room (and the lobby's listing). */
  async leave() {
    const room = this.room;
    this.room = null;
    this.role = null;
    this.playing = false;
    this.friendPeer = null;
    this.lastLs = null;
    this.goneSince = 0;
    this.rtt = 0;
    this.delay = 8;
    this.onGone = null;
    this.lobby?.lobby.presence({ kf: { v: NET_VERSION, open: null } });
    if (room) await room.leave().catch(() => {});
  }
}
