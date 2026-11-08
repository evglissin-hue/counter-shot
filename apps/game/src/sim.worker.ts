// The simulation runs here at a fixed 60 Hz, off the main thread: the
// Practice range (the sandbox) or a match against the AI castle. The page
// sends inputs; the worker tags each with the next tick, steps the sim and
// posts what changed.

import { buildLayout, GAME_LAYOUT, KEEP_STOREYS, MATCH_LAYOUT, type CastleLayout } from "@keepfall/content";
import { Match, MATCH_RULES_VERSION, Team } from "@keepfall/rules";
import { RULES_VERSION, SandboxSim, type Rapier } from "@keepfall/sim";
import type { FromWorker, MatchInfo, Mode, NavInfo, PlotView, SlotView, ToWorker } from "./protocol";

const post = (msg: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
const DT = 1000 / 60;

let R: Rapier | null = null;
let sim: SandboxSim | null = null;
let match: Match | null = null;
/** The Practice range's world and a match's (with plots in both courtyards). */
let practiceLayout: CastleLayout | null = null;
let matchLayout: CastleLayout | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let last = 0;
let acc = 0;
let speed = 1;
let paused = false;
let stepEma = 0;
/** The slowest step in the current and the previous second, for the HUD. */
let peakNow = 0, peakLast = 0, peakTicks = 0;
/** Test clock: the page advances the sim itself, frame by frame. */
let manual = false;
/** Nav overlay: send the grid when it changes, at most a few times a second. */
let navOn = false;
let navSent = -1;
let navAt = 0;
let bridgesSent = -1;
/** The match's end is reported once with the masonry counts. */
let endSent = false;
/** Each castle's gate leaves (stone ids). */
let gateLeaves: [number[], number[]] = [[], []];

async function load(): Promise<Rapier> {
  if (R) return R;
  const m = await import("@dimforge/rapier3d-deterministic-compat");
  const r = (m.default ?? m) as unknown as Rapier;
  await r.init();
  R = r;
  return r;
}

/**
 * A throwaway sim bursts two shells and steps a little at load, so the
 * JavaScript and WebAssembly behind a burst are compiled before the player's
 * first one (that first burst used to stall the frames for about 100 ms).
 * It never touches the real sim.
 */
function rehearse() {
  if (!R || !practiceLayout) return;
  const r = new SandboxSim(R, practiceLayout, { seed: 1, minions: 2 });
  r.explode(0, 19.3, -0.6);
  r.explode(15, 11.6, -15);
  for (let i = 0; i < 45; i++) r.step();
  r.free();
}

function build(mode: Mode, seed: number, minions: number) {
  if (!R) return;
  sim?.free();
  const t0 = performance.now();
  const layout = mode === "versus" ? (matchLayout ??= buildLayout(1, MATCH_LAYOUT)) : (practiceLayout ??= buildLayout(1, GAME_LAYOUT));
  gateLeaves = [0, 1].map((c) => layout.stones.filter((st) => st.part === "gate" && st.castle === c).map((st) => st.id)) as [number[], number[]];
  if (mode === "versus") {
    match = new Match(R, layout, { seed });
    sim = match.world;
  } else {
    match = null;
    sim = new SandboxSim(R, layout, { seed, minions });
  }
  navSent = -1;
  bridgesSent = -1;
  endSent = false;
  post({ t: "ready", mode, stones: sim.castle.layout.stones.length, setupMs: Math.round(performance.now() - t0), terrain: sim.terrain.fullPatch(), rulesVersion: RULES_VERSION * 100 + MATCH_RULES_VERSION });
}

function matchInfo(): MatchInfo | null {
  if (!match) return null;
  const ended = !!match.result;
  const army = match.army;
  const counts = match.armyCounts();
  const guns = new Float32Array(match.guns.length * 2);
  match.guns.forEach((g, i) => guns.set([g.yaw, g.pitch], i * 2));
  const hits = (c: 0 | 1) => gateLeaves[c].reduce((n, id) => n + (army.gateHits.get(id) ?? 0), 0);
  const open = (c: 0 | 1) => gateLeaves[c].some((id) => match!.world.castle.dynamic[id] === 1);
  const info: MatchInfo = {
    tick: match.tick,
    gold: [match.gold[0], match.gold[1]],
    result: match.result,
    shots: [match.shots[0], match.shots[1]],
    masonry: ended && !endSent ? [match.masonryDown(0), match.masonryDown(1)] : null,
    nextWave: match.nextWaveIn(),
    waves: [match.waves[0], match.waves[1]],
    route: match.route[Team.Player],
    order: army.order[Team.Player],
    standing: counts.standing,
    fallen: counts.fallen,
    autoShots: [match.autoShots[0], match.autoShots[1]],
    guns,
    gateHits: [hits(0), hits(1)],
    gateOpen: [open(0), open(1)],
    income: match.income(Team.Player),
    plots: plotViews(match),
    slots: slotViews(match),
    gains: match.goldLog.filter((g) => g.team === Team.Player).map((g) => ({ amount: g.amount, why: g.why, x: g.x, y: g.y, z: g.z })),
    notes: match.notes,
    keepFloor: [keepFloor(match, 0), keepFloor(match, 1)],
    earned: ended && !endSent ? { ...match.earned[Team.Player] } : null,
  };
  match.goldLog = [];
  match.notes = [];
  if (info.masonry) endSent = true;
  return info;
}

function plotViews(m: Match): PlotView[] {
  const out: PlotView[] = [];
  for (const team of [0, 1] as const) {
    m.plots[team].forEach((p, plot) => {
      out.push({ team, plot, kind: p.kind, state: p.state, progress: p.order.length ? p.raised / p.order.length : 0, standing: p.raised ? p.standing / p.raised : 0, route: p.route, mix: p.mix });
    });
  }
  return out;
}

function slotViews(m: Match): SlotView[] {
  return m.emplacements.map((e, i) => {
    const s = m.slots[i];
    return { weapon: e.weapon, armed: s.armed, down: s.down, heavy: !!e.mods?.heavy, rifled: !!e.mods?.rifled, y: e.y, barrel: e.barrel };
  });
}

/** Which floor a keep's banner stands on: 3 the roof, 2 and 1 the timber floors, 0 the ground. */
function keepFloor(m: Match, castle: 0 | 1): number {
  const y = m.world.castle.bodies[m.layout.bannerIds[castle]].translation().y;
  const tops = KEEP_STOREYS.map((c) => c * 0.5);
  let floor = 0;
  for (let k = 0; k < tops.length; k++) if (y > tops[k] + 1) floor = k + 1;
  return floor;
}

function tick(advanceMs = -1) {
  if (!sim || paused) return;
  if (manual) {
    if (advanceMs < 0) return;
    acc += advanceMs * speed;
  } else {
    const now = performance.now();
    acc += (now - last) * speed;
    last = now;
    // After a slow step (a big collapse), fall a little behind real time rather
    // than stall and then rush through the backlog: at most two steps per tick.
    if (acc > DT * 2) acc = DT * 2;
  }
  let steps = 0;
  while (acc >= DT && steps < (manual ? 12 : 2)) {
    const t0 = performance.now();
    if (match) match.step();
    else sim.step();
    const ms = performance.now() - t0;
    stepEma = stepEma === 0 ? ms : stepEma * 0.9 + ms * 0.1;
    if (ms > peakNow) peakNow = ms;
    if (++peakTicks >= 60) {
      peakLast = peakNow;
      peakNow = 0;
      peakTicks = 0;
    }
    acc -= DT;
    steps++;
  }
  if (!steps) return;
  const frame = sim.collect();
  const counts = sim.minionCounts();
  const transfer: Transferable[] = [frame.stones.buffer, frame.projectiles.buffer, frame.chains.buffer, frame.minions.buffer, frame.parts.buffer, frame.settled.buffer, frame.gone.buffer, frame.raised.buffer, frame.cleared.buffer, frame.events.buffer];
  const info = matchInfo();
  if (info) transfer.push(info.guns.buffer);
  for (const p of frame.terrain) transfer.push(p.h.buffer);
  // Bridges: whenever the nav grid changed.
  let bridges: boolean[] | null = null;
  if (sim.nav.version !== bridgesSent) {
    bridgesSent = sim.nav.version;
    bridges = sim.bridgesOpen();
  }
  let nav: NavInfo | null = null;
  const now = performance.now();
  if (navOn && sim.nav.version !== navSent && (manual || now - navAt > 250)) {
    navSent = sim.nav.version;
    navAt = now;
    nav = { version: sim.nav.version, kind: sim.nav.kind.slice(), floor: sim.nav.floor.slice() };
    transfer.push(nav.kind.buffer, nav.floor.buffer);
  }
  post(
    {
      t: "frame",
      frame,
      reload: sim.reload.slice(),
      stepMs: Math.round(stepEma * 100) / 100,
      stepPeak: Math.round(Math.max(peakNow, peakLast) * 10) / 10,
      down: counts.down,
      standing: counts.standing,
      awake: sim.castle.awakeCount(),
      match: info,
      bridges,
      nav,
    },
    transfer as Transferable[],
  );
}

function start() {
  if (timer !== null) clearInterval(timer);
  last = performance.now();
  acc = 0;
  timer = setInterval(tick, 4);
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.t) {
      case "init":
        await load();
        practiceLayout ??= buildLayout(1, GAME_LAYOUT);
        rehearse();
        build(msg.mode, msg.seed, msg.minions);
        start();
        break;
      case "reset":
        build(msg.mode, msg.seed, msg.minions);
        start();
        break;
      case "input": {
        const input = msg.input;
        if (match) {
          if (input.kind !== "minions") match.queue(match.tick, Team.Player, input);
        } else if (sim && (input.kind === "fire" || input.kind === "minions")) sim.queue(sim.tick, input);
        break;
      }
      case "speed":
        speed = msg.factor;
        break;
      case "pause":
        paused = msg.paused;
        last = performance.now();
        break;
      case "nav":
        navOn = msg.on;
        navSent = -1;
        break;
      case "manual":
        manual = true;
        acc = 0;
        break;
      case "advance":
        tick(msg.seconds * 1000);
        break;
    }
  } catch (err) {
    post({ t: "error", message: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};

export {};
