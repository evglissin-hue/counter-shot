// The simulation runs here at a fixed 60 Hz, off the main thread: the
// Practice range (the sandbox), a match against the AI castle (M5: the AI
// commands the enemy from here, by inputs), or a match against a friend
// online (M5: lockstep; the page carries each side's inputs to the other). The
// page sends inputs; the worker tags each with a tick, steps the sim and posts
// what changed.

import { buildLayout, Earn, GAME_LAYOUT, MIX_NAMES, PLOTS, ROUTE_NAMES, STORM, UPGRADE_KINDS, WEAPON_KINDS, type CastleLayout } from "@keepfall/content";
import { AiPlayer } from "@keepfall/ai";
import { Match, Team, type MatchInput } from "@keepfall/rules";
import { RULES_VERSION, SandboxSim, type Rapier } from "@keepfall/sim";
import { Lockstep, netHash } from "./lockstep";
import { EARN_STRIDE, type FromWorker, type MatchInfo, type MatchSetup, type Mode, type NavInfo, type ToWorker } from "./protocol";

const post = (msg: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
const DT = 1000 / 60;

let R: Rapier | null = null;
let sim: SandboxSim | null = null;
let match: Match | null = null;
let layout: CastleLayout | null = null;
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
/** M5: the team this page plays, the AI commanding the other (Versus AI, or a friend's castle once they have gone), and the lockstep with a friend online. */
let me: Team = Team.Player;
let ai: AiPlayer | null = null;
let net: Lockstep | null = null;
let matchSeed = 0;
/** Online: since when the match has been waiting for the friend (ms), and when this side's state last went to the page. */
let waitingSince = 0;
let netSentAt = 0;
let netDirty = true;

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
  if (!R || !layout) return;
  const r = new SandboxSim(R, layout, { seed: 1, minions: 2 });
  r.explode(0, 19.3, -0.6);
  r.explode(15, 11.6, -15);
  for (let i = 0; i < 45; i++) r.step();
  r.free();
}

function build(mode: Mode, seed: number, minions: number, setup: MatchSetup = {}) {
  if (!R) return;
  sim?.free();
  const t0 = performance.now();
  layout ??= buildLayout(1, GAME_LAYOUT);
  gateLeaves = [0, 1].map((c) => layout!.stones.filter((st) => st.part === "gate" && st.castle === c).map((st) => st.id)) as [number[], number[]];
  ai = null;
  net = null;
  me = Team.Player;
  matchSeed = seed;
  if (mode === "versus" || mode === "online") {
    // Someone commands the enemy castle now (the AI, or a friend): no fixed build order, no routes in turn.
    match = new Match(R, layout, { seed, plan: false, rotate: false });
    sim = match.world;
    if (mode === "versus") ai = new AiPlayer(match, Team.Enemy, setup.difficulty ?? "knight", seed);
    else {
      me = setup.team === 0 ? Team.Enemy : Team.Player;
      net = new Lockstep(match, me, me === Team.Player ? Team.Enemy : Team.Player, setup.delay ?? 8);
      waitingSince = performance.now();
      netDirty = true;
    }
  } else {
    match = null;
    sim = new SandboxSim(R, layout, { seed, minions });
  }
  navSent = -1;
  bridgesSent = -1;
  endSent = false;
  post({ t: "ready", mode, stones: sim.castle.layout.stones.length, setupMs: Math.round(performance.now() - t0), terrain: sim.terrain.fullPatch(), rulesVersion: RULES_VERSION });
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
  const works = match.world.works!;
  const mason = (c: 0 | 1) => {
    const w = works.status(c);
    return { job: w.job, left: w.left, hold: w.hold, up: w.masons, laid: w.laid };
  };
  const L = match.world.ladders!;
  const info: MatchInfo = {
    team: me as 0 | 1,
    tick: match.tick,
    gold: [match.gold[0], match.gold[1]],
    result: match.result,
    shots: [match.shots[0], match.shots[1]],
    masonry: ended && !endSent ? [match.masonryDown(0), match.masonryDown(1)] : null,
    nextWave: match.nextWaveIn(),
    waves: [match.waves[0], match.waves[1]],
    route: match.route[me],
    order: army.order[me],
    standing: counts.standing,
    fallen: counts.fallen,
    autoShots: [match.autoShots[0], match.autoShots[1]],
    guns,
    gateHits: [hits(0), hits(1)],
    gateOpen: [open(0), open(1)],
    storm: [match.storm[0], match.storm[1]],
    stormHold: STORM.hold,
    attackers: [army.attackers[0], army.attackers[1]],
    defenders: [army.defenders[0], army.defenders[1]],
    garrison: [army.garrisonCount(0), army.garrisonCount(1)],
    suddenDeath: match.suddenDeath,
    repairs: { ...match.repairs[me] },
    masons: [mason(0), mason(1)],
    ladders: [L.plantedAt(0), L.plantedAt(1)],
    down: match.tick % 60 < 2 || ended ? [match.masonryDown(0), match.masonryDown(1)] : null,
    stats: ended && !endSent ? [match.stats(Team.Enemy), match.stats(Team.Player)] : null,
    ...estateInfo(match),
  };
  if (info.masonry) endSent = true;
  return info;
}

/** M3: gold coming in, earnings since the last frame, the player's barracks and every gun. */
function estateInfo(m: Match): Pick<MatchInfo, "income" | "earned" | "goldEarned" | "goldSpent" | "tricks" | "barracks" | "arms" | "foundry"> {
  const ec = m.economy, es = m.estate;
  const feed = ec.feed;
  const earned = new Float32Array(feed.length * EARN_STRIDE);
  feed.forEach((e, i) => earned.set([e.team, e.amount, e.kind, e.x, e.y, e.z], i * EARN_STRIDE));
  ec.feed = [];
  const barracks = new Int8Array(PLOTS.length * 2);
  es.barracks[me].forEach((b, p) => {
    barracks[p * 2] = MIX_NAMES.indexOf(b.mix);
    barracks[p * 2 + 1] = ROUTE_NAMES.indexOf(b.route);
  });
  const arms = new Int8Array(m.emplacements.length * 2);
  m.emplacements.forEach((e, i) => {
    arms[i * 2] = e.empty ? -1 : WEAPON_KINDS.indexOf(e.weapon);
    arms[i * 2 + 1] = e.upgrade ? UPGRADE_KINDS.indexOf(e.upgrade) : -1;
  });
  const tricks = (t: number) => ec.tricks[t].slice(Earn.Ricochet, Earn.KeepHit + 1);
  return {
    income: [m.income(Team.Enemy), m.income(Team.Player)],
    earned,
    goldEarned: [ec.earned[0], ec.earned[1]],
    goldSpent: [ec.spent[0], ec.spent[1]],
    tricks: [tricks(0), tricks(1)],
    barracks,
    arms,
    foundry: [es.foundry(0), es.foundry(1)],
  };
}

function tick(advanceMs = -1) {
  if (!sim || paused) return;
  if (manual) {
    if (advanceMs < 0) return;
    acc += advanceMs * speed;
  } else {
    const now = performance.now();
    // Online: the side that is ahead of its friend eases off a little and the one behind hurries, so neither waits long.
    const lead = net ? net.lead() : 0;
    const pace = lead > 3 ? 0.92 : lead < -3 ? 1.12 : 1;
    acc += (now - last) * speed * pace;
    last = now;
    // After a slow step (a big collapse), fall a little behind real time rather
    // than stall and then rush through the backlog: at most two steps per tick (online, a little more to catch up).
    const cap = net ? DT * 4 : DT * 2;
    if (acc > cap) acc = cap;
  }
  let steps = 0;
  const most = manual ? 12 : net ? 4 : 2;
  while (acc >= DT && steps < most) {
    if (net && !net.canStep()) break; // waiting for the friend's inputs for this tick
    const t0 = performance.now();
    if (match) {
      ai?.step();
      match.step();
      if (net) {
        net.afterStep(() => netHash(match!));
        netDirty = true;
      }
    } else sim.step();
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
  if (net) postNet(steps > 0);
  if (!steps) return;
  const frame = sim.collect();
  const counts = sim.minionCounts();
  const transfer: Transferable[] = [frame.stones.buffer, frame.projectiles.buffer, frame.chains.buffer, frame.minions.buffer, frame.parts.buffer, frame.settled.buffer, frame.gone.buffer, frame.events.buffer, frame.ladders.buffer, frame.works.buffer, frame.plots.buffer, frame.kegs.buffer];
  const info = matchInfo();
  if (info) transfer.push(info.guns.buffer, info.earned.buffer, info.barracks.buffer, info.arms.buffer);
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

/** Online: this side's lockstep state to the page (which carries it to the friend), when it changed and at most every 30 ms. */
function postNet(stepped: boolean) {
  if (!net) return;
  const now = performance.now();
  if (stepped || net.canStep()) waitingSince = now;
  if (!netDirty && now - netSentAt < 250) return;
  if (now - netSentAt < 30) return;
  netSentAt = now;
  netDirty = false;
  post({ t: "net", state: net.state(), waiting: Math.round(now - waitingSince), delay: net.delay, unacked: net.unacked, desync: net.desync });
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
        layout ??= buildLayout(1, GAME_LAYOUT);
        rehearse();
        build(msg.mode, msg.seed, msg.minions, msg.setup);
        start();
        break;
      case "reset":
        build(msg.mode, msg.seed, msg.minions, msg.setup);
        start();
        break;
      case "input": {
        const input = msg.input;
        if (match) {
          if (input.kind === "minions") break;
          // Online, an input goes out to the friend and both play it on the same tick, a few ticks ahead.
          if (net) {
            net.local(input as MatchInput);
            netDirty = true;
            postNet(false);
          } else match.queue(match.tick, me, input);
        } else if (sim && (input.kind === "fire" || input.kind === "minions")) sim.queue(sim.tick, input);
        break;
      }
      case "net":
        if (net) {
          net.remote(msg.state, msg.now);
          netDirty = true;
        }
        break;
      case "delay":
        if (net) net.delay = Math.max(3, Math.min(40, Math.round(msg.ticks)));
        break;
      case "takeover":
        // The friend has gone: the AI takes their castle from here, and the match goes on alone.
        if (match && net) {
          ai = new AiPlayer(match, net.them, msg.difficulty, matchSeed);
          net = null;
        }
        break;
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
      case "spawn":
        match?.army.spawnWave(msg.team, 1, msg.count, { x: msg.x, z: msg.z }, { ladder: msg.ladder === true });
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
