// Online 1v1 on the page (M5): finding a friend and keeping in touch with
// them. The artifact's room capability is everyone who has this game open
// right now: the lobby shows who is hosting a match, a named room holds the
// two players of one match, and each page's presence there carries its
// lockstep state (lockstep.ts) to the other. Presence is latest-state and the
// platform re-sends it on reconnect, which suits lockstep: every message
// carries everything the other side still needs. With #net=local in the
// address, a BroadcastChannel stands in for the room, so two tabs (or a test)
// can play each other on one machine.

/** Bumped whenever two builds could not play each other. */
export const NET_VERSION = 5;

/** One other page in a room, as this page sees it. */
export interface Friend {
  peer: string;
  by: string | null;
  presence: Record<string, unknown>;
  /** This page's clock (ms) when its presence last changed. */
  updatedAt: number;
}

export interface Room {
  /** Set (merge) this page's presence. */
  presence(patch: Record<string, unknown>): void;
  /** Everyone else here now. */
  others(): Friend[];
  /** Called when anyone here comes, goes or changes. */
  onChange(fn: () => void): void;
  leave(): Promise<void>;
}

export interface Lobby {
  /** The lobby itself (everyone with the game open). */
  lobby: Room;
  /** A named room for one match. */
  join(name: string): Promise<Room>;
  /** Display names for room ids (empty when unknown). */
  names(ids: string[]): Promise<Record<string, string>>;
}

// ---- the artifact room ---------------------------------------------------------------

interface ClaudeRoomNs {
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): ReadonlyArray<{ peer: string; by: string | null; isMe: boolean; presence: Record<string, unknown>; updatedAt: number }>;
  onPeers(fn: (c: unknown) => void, onError?: (e: { code: string }) => void): () => void;
  join(name: string): Promise<ClaudeNamedRoom>;
}
interface ClaudeNamedRoom {
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): ReadonlyArray<{ peer: string; by: string | null; isMe: boolean; presence: Record<string, unknown>; updatedAt: number }>;
  onPeers(fn: (c: unknown) => void, onError?: (e: { code: string }) => void): () => void;
  leave(): Promise<void>;
}
interface ClaudeUserNs {
  profiles(ids: string[]): Promise<Record<string, { name?: string }>>;
}
type ClaudeGlobal = { use(name: string): Promise<unknown> };

function wrap(r: ClaudeRoomNs | ClaudeNamedRoom, leave: () => Promise<void>): Room {
  const fns: Array<() => void> = [];
  r.onPeers(() => fns.forEach((f) => f()), () => fns.forEach((f) => f()));
  return {
    presence(patch) {
      r.presence(patch).catch(() => {});
    },
    others() {
      return r
        .peers()
        .filter((p) => !p.isMe)
        .map((p) => ({ peer: p.peer, by: p.by, presence: (p.presence ?? {}) as Record<string, unknown>, updatedAt: p.updatedAt }));
    },
    onChange(fn) {
      fns.push(fn);
    },
    leave,
  };
}

/** The artifact's room, or null where this page cannot reach one (opened outside claude.ai, signed out, a public link). */
async function claudeLobby(): Promise<Lobby | null> {
  const c = (globalThis as unknown as { claude?: ClaudeGlobal }).claude;
  if (!c || typeof c.use !== "function") return null;
  const room = (await c.use("room").catch(() => null)) as ClaudeRoomNs | null;
  if (!room) return null;
  const user = (await c.use("user").catch(() => null)) as ClaudeUserNs | null;
  return {
    lobby: wrap(room, async () => {}),
    async join(name) {
      const named = await room.join(name);
      return wrap(named, () => named.leave());
    },
    async names(ids) {
      const out: Record<string, string> = {};
      if (!user || !ids.length) return out;
      try {
        const ps = await user.profiles(ids);
        for (const id of ids) out[id] = ps[id]?.name || "";
      } catch {}
      return out;
    },
  };
}

// ---- a stand-in over BroadcastChannel (#net=local) ------------------------------------

/** Every page on this machine with #net=local: presence per room, re-sent every second and on change; pages unheard for 4 s are gone. */
function localLobby(): Lobby {
  const me = Math.random().toString(36).slice(2, 10);
  const ch = new BroadcastChannel("keepfall-net");
  const rooms = new Map<string, { mine: Record<string, unknown>; others: Map<string, Friend>; heard: Map<string, number>; fns: Array<() => void>; joined: boolean }>();
  const get = (name: string) => {
    let r = rooms.get(name);
    if (!r) rooms.set(name, (r = { mine: {}, others: new Map(), heard: new Map(), fns: [], joined: false }));
    return r;
  };
  const sendOne = (name: string) => {
    const r = get(name);
    if (r.joined) ch.postMessage({ room: name, peer: me, presence: r.mine });
  };
  ch.onmessage = (e: MessageEvent) => {
    const m = e.data as { room: string; peer: string; presence?: Record<string, unknown>; left?: boolean };
    const r = rooms.get(m.room);
    if (!r || !r.joined || m.peer === me) return;
    if (m.left) {
      r.others.delete(m.peer);
      r.heard.delete(m.peer);
    } else {
      r.heard.set(m.peer, performance.now());
      const was = r.others.get(m.peer);
      const same = was && JSON.stringify(was.presence) === JSON.stringify(m.presence);
      r.others.set(m.peer, { peer: m.peer, by: m.peer, presence: same ? was!.presence : (m.presence ?? {}), updatedAt: same ? was!.updatedAt : performance.now() });
      if (!was) sendOne(m.room); // a newcomer hears this page at once
    }
    r.fns.forEach((f) => f());
  };
  setInterval(() => {
    const now = performance.now();
    for (const [name, r] of rooms) {
      sendOne(name);
      let gone = false;
      for (const [p, at] of r.heard) {
        if (now - at <= 4000) continue;
        r.heard.delete(p);
        r.others.delete(p);
        gone = true;
      }
      if (gone) r.fns.forEach((f) => f());
    }
  }, 1000);
  const room = (name: string): Room => {
    const r = get(name);
    r.joined = true;
    sendOne(name);
    return {
      presence(patch) {
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) delete r.mine[k];
          else r.mine[k] = v;
        }
        sendOne(name);
      },
      others: () => [...r.others.values()],
      onChange: (fn) => r.fns.push(fn),
      async leave() {
        r.joined = false;
        ch.postMessage({ room: name, peer: me, left: true });
        r.others.clear();
        r.heard.clear();
        r.mine = {};
      },
    };
  };
  return { lobby: room("lobby"), join: async (name) => room(name), names: async () => ({}) };
}

/** The room to play in: the artifact's, the local stand-in with #net=local, or null. */
export async function openLobby(): Promise<Lobby | null> {
  if (location.hash.includes("net=local")) return localLobby();
  return claudeLobby();
}

/** A short code for a match room (letters only: easy to read out). */
export function matchCode(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
