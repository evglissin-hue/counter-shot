// The dead-end hunt (see "Build and review loop" in docs/handoff.md): play a
// match with an AI on either side (or a side left idle) and flag what a player
// would get stuck on. Since the round after M5 it watches the guns that can be
// knocked out: a gun out for minutes (its masonry never rebuilt), an empty slot
// that cannot be bought because the masonry under it is down, a gunner who
// stops firing, gold piling up unspent; and, before the match, every gun on a
// wall or a tower must stand on masonry (or it could never fall with it).
// 3.3 adds the powder hunts (each flagged once per gun, boy or castle, with the stock and the box): a gun whose box cannot pay
// for 60 s while its store has stock and one of its boys stands; a castle whose powder rate is 0; a boy whose errand does not
// advance for 60 s (same task, same gun, moved under 2 m); a magazine ruin that cannot be rebuilt (the gold was there and it is
// still a ruin, or still rising with no piece raised, after 90 s).
// The army pass adds the army hunts (sampled once a second, each flagged once, with numbers): a team cut off (route fields
// FLOW_INF under its marching men), a soldier stuck with nothing to fight, an AI that holds too long or flips its orders, and
// ladders carried to the wall with no way in but never planted. The scripted army scenarios live in packages/ai/scripts/army-hunt.ts.
// 3.4 adds the keep hunts (each flagged once per structure): a structure groaning or holding under 0.3 for over 120 s without
// falling or mending past 0.6 (masons undoing each hit for ever: gold and masons are printed); a piece let go moving faster than
// 40 m/s within 2 s of a Released event (stones thrown from inside masonry); and a keep or tower piece down for over 180 s with
// its masons allowed and gold over 100 while rubble fills its place the whole time (a foot never mended).
// Prints one line per flag and a summary; exits 1 if anything was flagged.
// npx rolldown packages/ai/scripts/dead-ends.ts --format esm --platform node -o node_modules/.scratch/dead-ends.mjs && node node_modules/.scratch/dead-ends.mjs [enemy=knight|idle] [player=knight|idle] [secs=720] [seed=21]
import RD from "@dimforge/rapier3d-deterministic-compat";
import { BUILDING_KINDS, BUILDING_REBUILD, BUILDINGS, buildLayout, GAME_LAYOUT, holdMarker, inCourtyard, MUSTER, ROUTE_NAMES, sectionOf, Unit, WEAPON_COST, type Difficulty } from "@keepfall/content";
import { Action, breachField, EVENT_STRIDE, EventKind, FLOW_INF, LadderState, MinionState, Order, PlotState, Role, routeField, StaticState, type Minion, type Rapier } from "@keepfall/sim";
import { Match } from "@keepfall/rules";
import { AiPlayer } from "@keepfall/ai";

await RD.init();
const R = RD as unknown as Rapier;
const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(k + "="))?.split("=")[1] ?? d;
const sides = [arg("enemy", "knight"), arg("player", "knight")];
const secs = Number(arg("secs", "720")), seed = Number(arg("seed", "21"));
/** How long (s) a gun may stay out, a slot stay blocked, a gunner stay idle, or gold pile up before it is flagged. */
const LIMIT = { out: Number(arg("out", "240")), blocked: 240, idle: 150, gold: 600, goldFor: 180 };

/** The army hunts' thresholds (the army pass). */
const ARMY = {
  cutMen: 8, // marching men of a team on FLOW_INF cells at once...
  cutFor: 20, // ...for this many seconds is a team cut off
  cutRelief: 3, // s the count may stay under cutMen (a nav-topo flicker) before the spell is forgotten
  cutOne: 30, // or one man on a FLOW_INF cell for this many seconds
  stuckFor: 20, // seconds an upright soldier with nothing to fight may make under stuckMetres
  stuckMetres: 1, // m that counts as moving
  stuckCap: 6, // stuck men listed one by one (the rest are counted in one flag at the end)
  gateFront: 14, // m from the enemy muster that counts as the gate front (a man waiting there is not stuck)
  holdStretch: 60, // s: the longest Hold an AI may give in one stretch
  holdShare: 0.4, // the share of the match so far an AI may spend on Hold (checked at the end)
  holdMin: 120, // s of match before the Hold share is judged
  churnCount: 6, // order changes allowed in any churnWindow
  churnWindow: 300, // s
  churnGap: 15, // s: two order changes closer than this are a flip
  ladderSent: 5, // ladders carried to the wall with no way in before the planted share is judged (at the end)
  ladderShare: 0.3, // share of those ladders that must have been planted
  noSpot: 60, // s a ladder crew may carry near the wall with no spot
};

const m = new Match(R, buildLayout(1, GAME_LAYOUT), { seed, plan: false, rotate: false });
const ais = sides.map((s, team) => (s === "idle" ? null : new AiPlayer(m, team, s as Difficulty, seed)));
const M = m.world.mounts;
const castleOf = (i: number) => (m.emplacements[i].z < -75 ? 1 : 0);
const flags: string[] = [];
const clock = (tick: number) => `${Math.floor(tick / 3600)}:${String(Math.floor(tick / 60) % 60).padStart(2, "0")}`;
const flag = (tick: number, text: string) => {
  flags.push(`${clock(tick)} ${text}`);
  console.log(`FLAG ${clock(tick)} ${text}`);
};

// Static: a gun on a wall walk or a tower stands on masonry (a mortar stands on the ground in its pit), and masons
// rebuild every stone of it (a stone of no repair section, once down, would keep its gun out for good).
const section = sectionOf(m.world.castle.layout);
for (let i = 0; i < m.emplacements.length; i++) {
  const e = m.emplacements[i];
  const onGround = e.y < 3;
  if (!onGround && M.pieces[i].length === 0) flag(0, `slot ${i} (castle ${castleOf(i)}, ${e.place ?? e.weapon}) stands on no masonry: it can never fall with its tower or wall`);
  const lost = Array.from(M.pieces[i]).filter((id) => section[id] < 0).length;
  if (lost) flag(0, `slot ${i} (castle ${castleOf(i)}, ${e.place ?? e.weapon}) stands on ${lost} stones no masons rebuild: once down, its gun is out for good`);
}

const n = m.emplacements.length;
const report = new Int16Array(n * 2);
/** Since when (tick) each emplacement has been out, or its empty slot blocked; -1 when not. */
const outSince = new Int32Array(n).fill(-1), blockedSince = new Int32Array(n).fill(-1);
const outFlagged = new Uint8Array(n), blockedFlagged = new Uint8Array(n);
const lastShot = [0, 0], shotsSeen = [0, 0], idleFlagged = [false, false];
const richSince = [-1, -1], richFlagged = [false, false];
/** Every spell out: [castle, seconds]. */
const spells: [number, number][] = [];
const cheapest = (i: number) => Math.min(...(m.emplacements[i].allowed ?? [m.emplacements[i].weapon]).map((k) => WEAPON_COST[k]));
const WAIT = ["", "its crew", "its masonry", "gold"];

// 3.3 powder hunts.
const POW = { dry: 60, boy: 60, boyMoved: 2, ruin: 90 };
const carriers = m.world.carriers;
const TASKS = ["idle", "to store", "take", "carry", "hoist", "back", "flee"];
const MAGAZINE = BUILDING_KINDS.indexOf("magazine");
const drySince = new Int32Array(n).fill(-1), dryFlagged = new Uint8Array(n);
const rateFlagged = [false, false];
/** Per boy (castle 0's first): the errand he has been on (task and gun), since when, where he stood then, and whether it was flagged. */
const boyKey = new Array<string>(6).fill(""), boySince = new Array<number>(6).fill(0), boyAt = new Array<{ x: number; z: number }>(6).fill({ x: 0, z: 0 }), boyFlagged = new Array<boolean>(6).fill(false);
/** Per castle: since when its magazine has been a ruin (or rising with no piece up) while it could pay for the rebuild; -1 when not. */
const magSince = [-1, -1], magFlagged = [false, false];
const boxes = (c: number) => m.emplacements.map((e, i) => (castleOf(i) === c && !e.empty ? `${i}:${carriers!.box(i)}/${carriers!.boxCap(i)}` : "")).filter(Boolean).join(" ");
const stockOf = (c: number) => (carriers ? carriers.status(c).stock : 0);

// Army hunts: state.
const A = m.army;
const lastOrder = [A.order[0], A.order[1]], changes: number[][] = [[], []], holdTicks = [0, 0], holdStretch = [0, 0];
const holdFlagged = [false, false], churnFlagged = [false, false], flipFlagged = [false, false];
const sealRun = [0, 0], sealFlagged = [false, false];
const cutSpell = [-1, -1], cutHigh = [0, 0], cutTeamFlagged = [false, false], cutSince = new Map<number, number>(), cutManFlagged = [false, false];
const stillAt = new Map<number, { x: number; z: number; since: number }>(), stillFlagged = new Set<number>();
let stuckMore = 0;
const everPlanted = new Set<number>(), carrySince = new Map<number, number>(), carryFlagged = new Set<number>();
/** Ladders whose crew stood near the enemy wall, carrying, with no way in open (the ones a ladder was for). */
const chance = new Set<number>();
const ORDERS = ["Advance", "Hold", "Push"];
/** The field a man marches on now, or -1 when he holds by order (as the army chooses it). */
function marchField(x: Minion): number {
  const route = routeField(x.team, x.route);
  if (A.order[x.team] === Order.Push) {
    const b = breachField(x.team);
    return A.flow.at(b, x.x, x.z) < FLOW_INF ? b : route;
  }
  if (A.order[x.team] === Order.Hold) {
    const hz = holdMarker(x.team as 0 | 1, ROUTE_NAMES[x.route]).z;
    const past = x.team === 1 ? x.z - hz : hz - x.z;
    if (past > 1.5) return routeField(1 - x.team, x.route);
    if (past > -0.5) return -1;
  }
  return route;
}

/** The army hunts' once-a-second sampling. */
function armySecond(t: number) {
  const list = m.world.minions.list;
  const L = m.world.ladders;
  // Cut off: marching men standing on a FLOW_INF cell. "Cut off" is about the road to the objective, not the order of the
  // moment, so this reads the man's route field (or his breach field under Push) directly, not the Hold-adjusted field: a
  // man told to Hold whose road still reaches nothing is cut off too.
  for (const c of [0, 1]) {
    let cut = 0;
    for (const x of list) {
      if (x.team !== c || x.state !== MinionState.Upright || x.wave < 0 || x.role !== Role.March || inCourtyard(1 - c, x.x, x.z)) continue;
      const route = routeField(x.team, x.route);
      const bc = A.order[c] === Order.Push ? A.flow.at(breachField(x.team), x.x, x.z) : FLOW_INF;
      if (bc < FLOW_INF || A.flow.at(route, x.x, x.z) < FLOW_INF) {
        cutSince.delete(x.id);
        continue;
      }
      cut++;
      if (!cutSince.has(x.id)) cutSince.set(x.id, t);
      if (t - cutSince.get(x.id)! >= ARMY.cutOne * 60 && !cutManFlagged[c]) {
        cutManFlagged[c] = true;
        flag(t, `team ${c}'s man ${x.id} stood ${ARMY.cutOne} s on a FLOW_INF cell at (${x.x.toFixed(0)}, ${x.z.toFixed(0)}), order ${ORDERS[A.order[c]]}`);
      }
    }
    // Sealed: all three of the team's route fields read FLOW_INF at the enemy gate front (its muster), so no man of the team can path to the goal.
    const gm = MUSTER[1 - c];
    sealRun[c] = [0, 1, 2].every((r) => A.flow.at(c * 3 + r, gm.x, gm.z) >= FLOW_INF) ? sealRun[c] + 1 : 0;
    if (sealRun[c] >= ARMY.cutFor && !sealFlagged[c]) {
      sealFlagged[c] = true;
      flag(t, `team ${c} cut off: its three route fields reach nothing from castle ${1 - c}'s gate front for ${ARMY.cutFor} s (${cut} marching men on FLOW_INF cells now; order ${ORDERS[A.order[c]]})`);
    }
    // A cut-off spell: 8+ men cut, allowed to flicker (the nav topo rebuilds for a sample or two as the castle shifts, then
    // re-seals) but not to recover for cutRelief s. cutSpell[c] is when the spell began, cutHigh[c] the last second it was full.
    if (cut >= ARMY.cutMen) {
      if (cutSpell[c] < 0) cutSpell[c] = t;
      cutHigh[c] = t;
    } else if (cutSpell[c] >= 0 && t - cutHigh[c] > ARMY.cutRelief * 60) {
      cutSpell[c] = -1;
    }
    if (cutSpell[c] >= 0 && t - cutHigh[c] === 0 && t - cutSpell[c] >= ARMY.cutFor * 60 && !cutTeamFlagged[c]) {
      cutTeamFlagged[c] = true;
      const loose = m.world.castle.layout.stones.filter((s) => s.castle === 1 - c && s.part === "gate" && m.world.castle.dynamic[s.id]).length;
      flag(t, `team ${c} cut off: ${cut} marching men on FLOW_INF cells for ${ARMY.cutFor} s (order ${ORDERS[A.order[c]]}; castle ${1 - c} has ${loose} gate leaves loose)`);
    }
  }
  // Stuck: an upright soldier with nothing to fight, not holding by order, not battering, climbing or queueing at a ladder, not at the enemy gate front or in its courtyard.
  for (const x of list) {
    const c = x.team;
    const calm = x.state === MinionState.Upright && x.wave >= 0 && x.role === Role.March && (x.action === Action.Walk || x.action === Action.Stand) && x.target < 0 && x.unit !== Unit.Ladder && !(x.task >= 10 && x.task <= 14) && !m.world.specialists?.busy(x) && marchField(x) >= 0 && !inCourtyard(1 - c, x.x, x.z) && Math.hypot(x.x - MUSTER[1 - c].x, x.z - MUSTER[1 - c].z) > ARMY.gateFront;
    if (!calm) {
      stillAt.delete(x.id);
      continue;
    }
    const a = stillAt.get(x.id);
    if (!a || Math.hypot(x.x - a.x, x.z - a.z) >= ARMY.stuckMetres) {
      stillAt.set(x.id, { x: x.x, z: x.z, since: t });
      continue;
    }
    if (t - a.since >= ARMY.stuckFor * 60 && !stillFlagged.has(x.id)) {
      stillFlagged.add(x.id);
      if (stillFlagged.size <= ARMY.stuckCap) flag(t, `team ${c}'s ${["pike", "mason", "ladder", "sapper", "musket", "boy"][x.unit]} ${x.id} stood ${ARMY.stuckFor} s with nothing to fight at (${x.x.toFixed(1)}, ${x.z.toFixed(1)}), under ${ARMY.stuckMetres} m of progress (order ${ORDERS[A.order[c]]}, wave ${x.wave}, route ${ROUTE_NAMES[x.route]})`);
      else stuckMore++;
    }
  }
  // Ladders: planted so far, and crews carrying near the wall with no spot.
  if (L) {
    for (const lad of L.list) {
      if (lad.state === LadderState.Planted) everPlanted.add(lad.id);
      const f = list[lad.front];
      const wall = lad.team === 1 ? -16 : -134;
      if (lad.state === LadderState.Carried && f.state === MinionState.Upright && Math.abs(f.z - wall) < 34 && Math.abs(f.x) < 30 && A.flow.at(breachField(lad.team), f.x, f.z) >= FLOW_INF) chance.add(lad.id);
      const carrying = lad.state === LadderState.Carried && lad.spot < 0 && f.state === MinionState.Upright && Math.abs(f.z - wall) < 34;
      if (!carrying) {
        carrySince.delete(lad.id);
        continue;
      }
      if (!carrySince.has(lad.id)) carrySince.set(lad.id, t);
      if (t - carrySince.get(lad.id)! >= ARMY.noSpot * 60 && !carryFlagged.has(lad.id)) {
        carryFlagged.add(lad.id);
        flag(t, `team ${lad.team}'s ladder ${lad.id} crew carried ${ARMY.noSpot} s near the wall with no spot (front man at (${f.x.toFixed(0)}, ${f.z.toFixed(0)}), order ${ORDERS[A.order[lad.team]]})`);
      }
    }
  }
}
// 3.4 keep hunts.
const KEEP = { hang: 120, hangHolds: 0.3, mended: 0.6, fast: 40, fastTicks: 120, down: 180, gold: 100, sample: 10, maxPlaces: 80 };
const statics = m.world.statics;
const castle = m.world.castle;
const layout = castle.layout;
const dyn = castle.dynamic;
const events = (m.world as unknown as { events: number[] }).events;
let evSeen = 0;
/** Per structure: since when it has held under 0.3 (-1: not), whether it was flagged, the tick it was last let go (-1: not), whether a fast piece was flagged. */
const hangSince = new Array<number>(10).fill(-1), hangFlagged = new Array<boolean>(10).fill(false);
const releasedAt = new Array<number>(10).fill(-1), fastFlagged = new Array<boolean>(10).fill(false);
/** Per structure piece: since when it has been down (-1 standing), and since when rubble has filled its place all the while (-1: not). */
const downSince = new Map<number, number>(), placeBlocked = new Map<number, number>(), placeFlagged = new Set<number>();
const structs = statics ? statics.list : [];
const masonsAt = (c: number) => `${m.world.works ? m.world.works.status(c).masons : 0} masons (${m.world.works ? m.world.works.status(c).job : "-"})`;

for (let tick = 0; tick < secs * 60 && !m.result; tick++) {
  for (const ai of ais) ai?.step();
  m.step();
  // The orders each AI gives, read every tick (an order input can land between two samples).
  for (const c of [0, 1]) {
    if (!ais[c]) continue;
    const o = A.order[c];
    if (o !== lastOrder[c]) {
      const prev = changes[c][changes[c].length - 1];
      changes[c].push(m.tick);
      lastOrder[c] = o;
      if (prev !== undefined && m.tick - prev < ARMY.churnGap * 60 && !flipFlagged[c]) {
        flipFlagged[c] = true;
        flag(m.tick, `castle ${c}'s ${sides[c]} AI changed its order twice within ${ARMY.churnGap} s (${((m.tick - prev) / 60).toFixed(0)} s apart, now ${ORDERS[o]})`);
      }
      const inWindow = changes[c].filter((q) => m.tick - q <= ARMY.churnWindow * 60).length;
      if (inWindow > ARMY.churnCount && !churnFlagged[c]) {
        churnFlagged[c] = true;
        flag(m.tick, `castle ${c}'s ${sides[c]} AI changed its order ${inWindow} times in ${ARMY.churnWindow / 60} minutes (limit ${ARMY.churnCount})`);
      }
    }
    if (o === Order.Hold) {
      holdTicks[c]++;
      holdStretch[c]++;
      if (holdStretch[c] > ARMY.holdStretch * 60 && !holdFlagged[c]) {
        holdFlagged[c] = true;
        flag(m.tick, `castle ${c}'s ${sides[c]} AI held for more than ${ARMY.holdStretch} s at a stretch (${A.attackers[1 - c]} of the foe in its courtyard)`);
      }
    } else holdStretch[c] = 0;
  }
  if (statics) {
    for (; evSeen + EVENT_STRIDE <= events.length; evSeen += EVENT_STRIDE) {
      if (events[evSeen] === EventKind.Released) {
        releasedAt[events[evSeen + 1]] = m.tick;
        fastFlagged[events[evSeen + 1]] = false;
      }
    }
    // A piece let go moving faster than 40 m/s within 2 s of its Released event: thrown from inside masonry.
    for (const d of structs) {
      if (releasedAt[d.index] < 0 || fastFlagged[d.index]) continue;
      if (m.tick - releasedAt[d.index] > KEEP.fastTicks) {
        releasedAt[d.index] = -1;
        continue;
      }
      for (const id of d.stones) {
        if (!dyn[id]) continue;
        let v: { x: number; y: number; z: number };
        try {
          v = castle.bodies[id].linvel();
        } catch {
          continue;
        }
        const sp = Math.hypot(v.x, v.y, v.z);
        if (sp > KEEP.fast) {
          fastFlagged[d.index] = true;
          const p = castle.bodies[id].translation();
          flag(m.tick, `castle ${d.castle}'s ${d.name} let go: piece ${id} (${layout.stones[id].part}, course ${layout.stones[id].course}) moves at ${sp.toFixed(0)} m/s ${((m.tick - releasedAt[d.index]) / 60).toFixed(2)} s after it was released, at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
          break;
        }
      }
    }
  }
  if (tick % 60 !== 59) continue;
  const t = m.tick;
  armySecond(t);
  if (statics) {
    for (const d of structs) {
      // Groaning, or holding under 0.3, for over 120 s without falling or mending past 0.6.
      const s = statics.status(d.index);
      if (s.state === StaticState.Toppling || s.state === StaticState.Fallen || s.holds >= KEEP.mended) {
        hangSince[d.index] = -1;
        hangFlagged[d.index] = false;
      } else if (hangSince[d.index] < 0 && (s.holds < KEEP.hangHolds || s.state === StaticState.Groaning)) hangSince[d.index] = t;
      if (hangSince[d.index] >= 0 && !hangFlagged[d.index] && t - hangSince[d.index] > KEEP.hang * 60) {
        hangFlagged[d.index] = true;
        flag(t, `castle ${d.castle}'s ${d.name} has held under ${KEEP.hangHolds} for ${KEEP.hang} s without falling or mending past ${KEEP.mended} (holds ${s.holds.toFixed(2)}, weakest course ${s.weakest}; gold ${m.gold[d.castle]}, ${masonsAt(d.castle)})`);
      }
      // Pieces down for over 180 s, masons allowed, gold over 100, and rubble filling their place every time it is looked at.
      for (const id of d.stones) {
        const part = layout.stones[id].part;
        if (part !== "keep" && part !== "tower") continue;
        if (!dyn[id]) {
          downSince.delete(id);
          placeBlocked.delete(id);
          continue;
        }
        if (!downSince.has(id)) downSince.set(id, t);
      }
      const allowed = (d.kind === "keep" ? m.repairs[d.castle].keep : m.repairs[d.castle].towers) && m.gold[d.castle] > KEEP.gold;
      if (!allowed) {
        for (const id of d.stones) placeBlocked.delete(id);
      } else if (Math.floor(t / 60) % KEEP.sample === 0) {
        let looked = 0;
        for (const id of d.stones) {
          const since = downSince.get(id);
          if (since === undefined || looked >= KEEP.maxPlaces) continue;
          looked++;
          const place = castle.inPlace(id, m.world.terrain.handles);
          if (place.pieces.length === 0) {
            placeBlocked.delete(id);
            continue;
          }
          // Blocked at every look since it went down (the first look may be ten seconds after).
          if (!placeBlocked.has(id)) placeBlocked.set(id, t);
          if (placeBlocked.get(id)! - since > KEEP.sample * 60) {
            placeBlocked.set(id, Infinity); // it was free once: it does not count
            continue;
          }
          if (!placeFlagged.has(d.index) && t - since > KEEP.down * 60) {
            placeFlagged.add(d.index);
            flag(t, `castle ${d.castle}'s ${d.name}: piece ${id} (course ${layout.stones[id].course}) has been down ${((t - since) / 60).toFixed(0)} s with masons allowed and ${m.gold[d.castle]} gold, and rubble (${place.pieces.length} pieces) fills its place (${masonsAt(d.castle)})`);
          }
        }
      }
    }
  }
  M.report(t, report);
  for (let i = 0; i < n; i++) {
    const e = m.emplacements[i], c = castleOf(i), st = report[i * 2];
    if (e.empty) {
      // An empty slot whose masonry is down cannot be bought: flag it if its castle could pay for a gun all that time.
      const blocked = st === 2 && m.gold[c] >= cheapest(i);
      if (blocked && blockedSince[i] < 0) blockedSince[i] = t;
      if (!blocked) blockedSince[i] = -1;
      if (blocked && !blockedFlagged[i] && t - blockedSince[i] > LIMIT.blocked * 60) {
        blockedFlagged[i] = 1;
        flag(t, `castle ${c}'s empty slot ${i} (${e.place ?? "slot"}) could not be bought for ${LIMIT.blocked} s: its masonry is down (${Math.round(M.standing(i) * 100)}% stands; ${c ? "player" : "enemy"} repairs ${JSON.stringify(m.repairs[c])})`);
      }
      continue;
    }
    if (st !== 0 && outSince[i] < 0) outSince[i] = t;
    if (st === 0 && outSince[i] >= 0) {
      spells.push([c, (t - outSince[i]) / 60]);
      outSince[i] = -1;
      outFlagged[i] = 0;
    }
    if (st !== 0 && !outFlagged[i] && t - outSince[i] > LIMIT.out * 60) {
      outFlagged[i] = 1;
      flag(t, `castle ${c}'s ${e.weapon} (${i}, ${e.place ?? "slot"}) out for ${LIMIT.out} s, waiting for ${WAIT[st]} (${Math.round(M.standing(i) * 100)}% of its masonry stands; repairs ${JSON.stringify(m.repairs[c])})`);
    }
  }
  if (carriers) {
    for (let i = 0; i < n; i++) {
      const e = m.emplacements[i], c = castleOf(i);
      // A gun whose box cannot pay while its store has stock and one of its boys stands (a gun out or empty is not waiting for powder).
      const boyUp = carriers.errands().some((b) => b.team === c && b.minion >= 0 && m.world.minions.list[b.minion]?.state === MinionState.Upright);
      const dry = !e.empty && M.up(i) && !carriers.canPay(i) && stockOf(c) > 0 && boyUp;
      if (!dry) {
        drySince[i] = -1;
        continue;
      }
      if (drySince[i] < 0) drySince[i] = t;
      if (!dryFlagged[i] && t - drySince[i] > POW.dry * 60) {
        dryFlagged[i] = 1;
        flag(t, `castle ${c}'s ${e.weapon} (${i}, ${e.place ?? "slot"}) could not pay for ${POW.dry} s with stock and a boy standing (stock ${stockOf(c)}, boxes ${boxes(c)}, boys ${carriers.errands().filter((b) => b.team === c).map((b) => `${TASKS[b.task]}${b.emplacement >= 0 ? "@" + b.emplacement : ""}`).join(",")})`);
      }
    }
    for (const c of [0, 1] as const) {
      if (!rateFlagged[c] && m.powderRate(c) <= 0) {
        rateFlagged[c] = true;
        flag(t, `castle ${c} makes no powder (rate ${m.powderRate(c)}; stock ${stockOf(c)}, boxes ${boxes(c)})`);
      }
      // The magazine: a ruin (or a rebuild with no piece raised) for 90 s while the gold for the rebuild was there, and no other magazine stands.
      const st = m.world.structures!;
      let bad = false, other = false;
      for (let p = 0; p < 6; p++) {
        const s = st.slot(c, p);
        if (s.kind !== MAGAZINE) continue;
        if (s.state === PlotState.Standing || (s.state === PlotState.Rising && s.up > 0)) other = true;
        if (s.state === PlotState.Ruined || (s.state === PlotState.Rising && s.up === 0)) bad = true;
      }
      const paid = m.gold[c] >= Math.round(BUILDINGS.magazine.cost * BUILDING_REBUILD);
      if (!bad || other || !paid || !ais[c]) magSince[c] = -1;
      else if (magSince[c] < 0) magSince[c] = t;
      if (!magFlagged[c] && magSince[c] >= 0 && t - magSince[c] > POW.ruin * 60) {
        magFlagged[c] = true;
        const mp = [0, 1, 2, 3, 4, 5].filter((p) => st.slot(c, p).kind === MAGAZINE).map((p) => `plot ${p} state ${st.slot(c, p).state} up ${st.slot(c, p).up}`).join("; ");
        flag(t, `castle ${c}'s magazine could not be rebuilt for ${POW.ruin} s with the gold there (${mp}; gold ${m.gold[c]}; stock ${stockOf(c)}, boxes ${boxes(c)})`);
      }
    }
    // A boy whose errand does not advance: the same task for the same gun, and he has moved under 2 m.
    carriers.errands().forEach((b, k) => {
      const mi = b.minion >= 0 ? m.world.minions.list[b.minion] : null;
      const key = `${b.task}:${b.emplacement}`;
      if (!mi || b.task === 0 || key !== boyKey[k] || Math.hypot(mi.x - boyAt[k].x, mi.z - boyAt[k].z) >= POW.boyMoved) {
        boyKey[k] = mi && b.task !== 0 ? key : "";
        boySince[k] = t;
        boyAt[k] = mi ? { x: mi.x, z: mi.z } : { x: 0, z: 0 };
        boyFlagged[k] = false;
        return;
      }
      if (!boyFlagged[k] && t - boySince[k] > POW.boy * 60) {
        boyFlagged[k] = true;
        flag(t, `castle ${b.team}'s powder boy ${k % 3} stuck ${POW.boy} s on "${TASKS[b.task]}" for gun ${b.emplacement} at (${mi.x.toFixed(1)}, ${mi.z.toFixed(1)}) (stock ${stockOf(b.team)}, boxes ${boxes(b.team)})`);
      }
    });
  }
  for (const c of [0, 1]) {
    if (!ais[c]) continue;
    if (m.shots[c] !== shotsSeen[c]) {
      shotsSeen[c] = m.shots[c];
      lastShot[c] = t;
      idleFlagged[c] = false;
    }
    const anyUp = m.emplacements.some((e, i) => castleOf(i) === c && !e.empty && M.up(i));
    if (anyUp && !idleFlagged[c] && t - lastShot[c] > LIMIT.idle * 60) {
      idleFlagged[c] = true;
      flag(t, `castle ${c}'s gunner (${sides[c]}) fired nothing by hand for ${LIMIT.idle} s with a gun up`);
    }
    // The Squire's plan is short and slow on purpose (seven steps, the last after ten minutes): once it is done, its gold piles up by design.
    if (sides[c] === "squire") continue;
    if (m.gold[c] > LIMIT.gold && richSince[c] < 0) richSince[c] = t;
    if (m.gold[c] <= LIMIT.gold) richSince[c] = -1;
    if (richSince[c] >= 0 && !richFlagged[c] && t - richSince[c] > LIMIT.goldFor * 60) {
      richFlagged[c] = true;
      flag(t, `castle ${c} (${sides[c]}) sat on more than ${LIMIT.gold} gold for ${LIMIT.goldFor} s (${m.gold[c]} now)`);
    }
  }
}

const end = m.tick;
// Army hunts, judged at the end: the AI's Hold share, and the ladders it sent.
if (stuckMore) flag(end, `${stuckMore} more soldiers stood ${ARMY.stuckFor} s with nothing to fight (not listed)`);
for (const c of [0, 1]) {
  if (!ais[c]) continue;
  if (end >= ARMY.holdMin * 60 && holdTicks[c] > ARMY.holdShare * end) flag(end, `castle ${c}'s ${sides[c]} AI spent ${Math.round((100 * holdTicks[c]) / end)}% of the match so far on Hold (${(holdTicks[c] / 60).toFixed(0)} of ${(end / 60).toFixed(0)} s; limit ${Math.round(ARMY.holdShare * 100)}%)`);
  // Judged over the ladders that had their chance: carried to the wall with no way in open (not lost on the road, not
  // dropped because a breach let the wave in).
  const lads = (m.world.ladders?.list ?? []).filter((l) => l.team === c && (chance.has(l.id) || everPlanted.has(l.id)));
  const planted = lads.filter((l) => everPlanted.has(l.id)).length;
  if (lads.length >= ARMY.ladderSent && planted < ARMY.ladderShare * lads.length) flag(end, `team ${c} carried ${lads.length} ladders to the wall with no way in and planted ${planted} (${Math.round((100 * planted) / lads.length)}%; need ${Math.round(ARMY.ladderShare * 100)}%)`);
}
const armyLine = [0, 1].map((c) => {
  const lads = (m.world.ladders?.list ?? []).filter((l) => l.team === c);
  const had = lads.filter((l) => chance.has(l.id) || everPlanted.has(l.id)).length;
  return `castle ${c}: ${changes[c].length} order changes, Hold ${(holdTicks[c] / 60).toFixed(0)} s, ladders ${lads.filter((l) => everPlanted.has(l.id)).length}/${lads.length} planted (${had} reached the wall with no way in)`;
}).join("; ");
for (let i = 0; i < n; i++) if (outSince[i] >= 0) spells.push([castleOf(i), (end - outSince[i]) / 60]);
const summary = [0, 1].map((c) => {
  const s = spells.filter((x) => x[0] === c).map((x) => x[1]).sort((a, b) => a - b);
  const med = s.length ? s[Math.floor(s.length / 2)] : 0;
  return `castle ${c} (${sides[c]}): ${s.length} knock-outs, median ${med.toFixed(0)} s out, longest ${(s[s.length - 1] ?? 0).toFixed(0)} s, ${m.shots[c]} shots by hand, silenced ${m.economy.silenced[c]}`;
});
console.log(`seed ${seed}, ${sides[0]} (castle 0) against ${sides[1]} (castle 1), ${clock(end)} played: ${m.result ? (m.result.winner < 0 ? `a draw (${m.result.reason})` : `won by castle ${m.result.winner} (${m.result.reason})`) : "no result yet"}`);
for (const s of summary) console.log("  " + s);
console.log("  army: " + armyLine);
console.log(flags.length ? `${flags.length} flagged` : "nothing flagged");
m.free();
process.exit(flags.length ? 1 : 0);
