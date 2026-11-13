// The build menu (phase 2 M3; a plain list since the playtest pass): B, or
// the Build button by your gold, opens it on everything your gold can buy,
// each with its cost and what it does: a building (it goes up on your next
// free plot), a gun for an empty slot, an upgrade, the rebuilding of a ruin.
// A number picks from the list; the map of your courtyard beside it picks a
// plot to build on exactly there (or to set a barracks' mix and route).
// Backspace goes back, B or Esc closes it, and everything can be clicked. It
// only sends inputs: the match decides (and refuses what cannot be paid for).

import {
  BUILDING_KINDS,
  BUILDING_REBUILD,
  BUILDINGS,
  MIX_NAMES,
  PLOTS,
  plotName,
  POWDER,
  ROUTE_NAMES,
  UPGRADES,
  upgradesFor,
  WAVE_MIXES,
  WEAPON_COST,
  WEAPONS,
  type BuildingKind,
  type Emplacement,
  type MixName,
  type RouteName,
  type UpgradeKind,
  type WeaponKind,
} from "@keepfall/content";
import type { MatchInput } from "@keepfall/rules";
import { PLOT_STRIDE } from "@keepfall/sim";
import { powderBuyWhy } from "./powder";

/** Plot states (sim structures.ts PlotState). */
const EMPTY = 0, RISING = 1, STANDING = 2, RUINED = 3;
const KIND_NAMES = BUILDING_KINDS.map((k) => BUILDINGS[k].name);
/**
 * The names on the courtyard map's plots: short, with soft hyphens, so a narrow plot (by the keep, at the back) breaks
 * a long word ("Maga-zine") instead of cutting it off. The list beside the map gives the full names.
 */
const TILE_NAMES = KIND_NAMES.map((n) => n.replace("Powder Mill", "Mill").replace("Magazine", "Maga\u00adzine").replace("Foundry", "Found\u00adry").replace("Barracks", "Bar\u00adracks"));
const ROUTE_LABEL: Record<RouteName, string> = { left: "Left flank", centre: "Centre road", right: "Right flank" };

interface PlotInfo {
  kind: number;
  state: number;
  share: number;
  health: number;
}

interface Choice {
  label: string;
  detail: string;
  /** Gold it costs (0: free), and whether it can be done now. */
  cost: number;
  ok: boolean;
  pressed?: boolean;
  input: MatchInput | null;
  /** Instead of an input: a page of the menu to open (a gun slot's guns, the upgrades). */
  sub?: number;
  /** Shown before the cost ("from" for a page of choices). */
  from?: boolean;
}

/** Menu pages besides the list (-1) and the plots (0 to 5): the gun you ride, a gun slot (+ slot), the guns to upgrade. */
const RIDDEN = 6, SLOT = 10, UPGRADE_LIST = 20;
/** Plots a new building takes first: the back ones, out of the enemy's easy reach, then the sides, then the front. */
const PLOT_ORDER = [4, 5, 2, 3, 1, 0];

export interface WheelState {
  gold: number;
  team: number;
  /** The player's barracks settings per plot: [mix index, route index]. */
  barracks: Int8Array | null;
  foundry: boolean;
  /** The gun you ride, and its slot number (0 to 7). */
  gun: Emplacement | null;
  gunSlot: number;
  /** Your castle's eight gun slots, in slot order. */
  guns: Emplacement[];
  /** After M5: by slot, the masonry it stands on is down (no gun can be bought for it until masons rebuild it). */
  mountDown?: boolean[];
  /** 3.3: your store (charges, what it holds, the plot of the working magazine or -1), or null in a match without powder. */
  powder?: { stock: number; cap: number; magazine: number } | null;
}

export class BuildWheel {
  isOpen = false;
  /** -1 nothing chosen; 0..5 a plot; 6 the gun. */
  private target = -1;
  private plots: PlotInfo[] = PLOTS.map(() => ({ kind: -1, state: EMPTY, share: 0, health: 0 }));
  private state: WheelState = { gold: 0, team: 1, barracks: null, foundry: false, gun: null, gunSlot: 0, guns: [] };
  private choices: Choice[] = [];
  /** What the wheel last drew (it is drawn again only when that changes). */
  private html = "";

  constructor(
    private el: HTMLElement,
    private send: (input: MatchInput) => void,
    private note: (text: string) => void,
  ) {
    // A press acts at once: the wheel is redrawn as gold comes in, and a click
    // whose press and release fell on two different drawings would be lost. A
    // click from the keyboard (Enter or Space on a focused button) acts too.
    const act = (e: Event) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-pick],[data-choice],[data-act]");
      if (!t) return;
      e.stopPropagation();
      e.preventDefault();
      if (t.dataset.pick !== undefined) this.pick(Number(t.dataset.pick));
      else if (t.dataset.choice !== undefined) this.choose(Number(t.dataset.choice));
      else if (t.dataset.act === "close") this.close();
      else if (t.dataset.act === "back") this.back();
      (t as HTMLButtonElement).blur?.();
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button === 0) act(e);
    });
    el.addEventListener("click", (e) => {
      if (e.detail === 0) act(e);
      else e.stopPropagation();
    });
  }

  open(target = -1) {
    this.isOpen = true;
    this.target = target;
    this.el.hidden = false;
    this.render();
  }

  close() {
    this.isOpen = false;
    this.el.hidden = true;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** A number key while the menu is open: a choice on the page shown. */
  digit(n: number) {
    this.choose(n - 1);
  }

  back() {
    if (this.target < 0) this.close();
    else {
      this.target = -1;
      this.render();
    }
  }

  private pick(t: number) {
    this.target = t;
    this.render();
  }

  private choose(i: number) {
    const c = this.choices[i];
    if (c && c.sub !== undefined) {
      this.pick(c.sub);
      return;
    }
    if (!c || !c.input) return;
    if (!c.ok) {
      this.note(c.input.kind === "powder" ? c.detail : c.cost > this.state.gold ? `Not enough gold: ${c.cost} needed` : `${c.label}: not now`);
      return;
    }
    this.send(c.input);
    if (c.input.kind === "build") this.note(`Building on plot ${c.input.plot + 1}, ${plotName(this.state.team, c.input.plot)}`);
    // Building and buying close the wheel; settings stay open to adjust.
    if (c.input.kind === "build" || c.input.kind === "buy" || c.input.kind === "upgrade") this.close();
    else this.render();
  }

  /** The player's plots from a frame, and the rest of what the wheel shows. */
  update(plots: Float32Array | null, count: number, state: WheelState) {
    if (plots) {
      for (let i = 0; i < count; i++) {
        const o = i * PLOT_STRIDE;
        if (plots[o] !== state.team) continue;
        const p = this.plots[plots[o + 1] | 0];
        if (!p) continue;
        p.kind = plots[o + 2] | 0;
        p.state = plots[o + 3] | 0;
        p.share = plots[o + 4];
        p.health = plots[o + 5];
      }
    }
    this.state = state;
    if (this.isOpen) this.render();
  }

  /** What stands on one of the player's plots (for notes). */
  plot(i: number): PlotInfo {
    return this.plots[i];
  }

  private render() {
    const s = this.state;
    const t = this.target;
    this.choices = t < 0 ? this.listChoices() : t === RIDDEN ? this.gunChoices(s.gun) : t >= SLOT && t < SLOT + 8 ? this.gunChoices(s.guns[t - SLOT] ?? null) : t === UPGRADE_LIST ? this.upgradeList() : this.plotChoices(t);
    const plotBox = (i: number) => {
      const p = PLOTS[i], v = this.plots[i];
      // The map is drawn as the player faces from the gate wall, the field ahead (up): their left on the left, the gate at the top.
      const x = s.team === 1 ? -p.x : p.x;
      const z = p.z;
      const what = v.kind < 0 ? "Empty" : `${TILE_NAMES[v.kind]}${v.state === RISING ? ` ${Math.round(v.share * 100)}%` : v.state === RUINED ? " (ruined)" : ""}`;
      const cls = `plot${this.target === i ? " sel" : ""}${v.state === RUINED ? " ruin" : ""}${v.kind < 0 ? " empty" : ""}`;
      return `<button class="${cls}" data-pick="${i}" style="left:${50 + x * 2.9 - p.w * 1.45}%;top:${50 + z * 2.9 - p.d * 1.45}%;width:${p.w * 2.9}%;height:${p.d * 2.9}%"><b>${i + 1}</b><span>${what}</span></button>`;
    };
    const gold = `<b class="goldtxt">${s.gold} gold</b>`;
    const slotGun = t >= SLOT && t < SLOT + 8 ? s.guns[t - SLOT] : t === RIDDEN ? s.gun : null;
    const head =
      t < 0
        ? `<p class="small">A number key buys; a plot on the map builds there.</p>`
        : slotGun
          ? `<p class="small"><b>Slot ${(t === RIDDEN ? s.gunSlot : t - SLOT) + 1}: ${slotGun.empty ? "empty" : WEAPONS[slotGun.weapon].name}</b>${slotGun.place ? `, ${slotGun.place}` : ""}</p>`
          : t === UPGRADE_LIST
            ? `<p class="small"><b>Upgrades</b>: one per gun, from a working Foundry</p>`
            : `<p class="small"><b>Plot ${t + 1}</b>, ${plotName(s.team, t)}</p>`;
    const list = this.choices
      .map((c, i) => `<button class="choice2${c.ok ? "" : " no"}${c.pressed ? " on" : ""}${c.sub !== undefined ? " more" : ""}" data-choice="${i}"><span class="k">${i < 8 ? i + 1 : ""}</span><b>${c.label}</b>${c.detail ? `<span class="d">${c.detail}</span>` : ""}${c.cost ? `<span class="c">${c.from ? "from " : ""}${c.cost}</span>` : ""}</button>`)
      .join("");
    const html =
      `<div class="wheel-head"><h2>Build</h2>${gold}${t >= 0 ? `<button data-act="back" title="Back (Backspace)">Back</button>` : ""}<button data-act="close" title="Close (B or Esc)">Close</button></div>` +
      head +
      `<div class="yard" aria-label="Your courtyard, the gate at the top: click a plot"><div class="keep" style="left:35.5%;top:47.1%;width:29%;height:29%">Keep</div><div class="gatemark">Gate</div>${PLOTS.map((_, i) => plotBox(i)).join("")}</div>` +
      `<div class="choices2">${list || `<p class="small">Nothing to do here now.</p>`}</div>`;
    // The match reports every frame: redraw only what changed, so the buttons under the pointer stay put.
    if (html === this.html) return;
    this.html = html;
    this.el.innerHTML = html;
  }

  private plotChoices(i: number): Choice[] {
    const v = this.plots[i], s = this.state;
    const out: Choice[] = [];
    if (v.state === EMPTY) {
      for (const k of BUILDING_KINDS as BuildingKind[]) {
        const b = BUILDINGS[k];
        out.push({ label: b.name, detail: `${b.blurb}; ${Math.round(b.buildTicks / 60)} s to build`, cost: b.cost, ok: s.gold >= b.cost, input: { kind: "build", plot: i, building: k } });
      }
      return out;
    }
    if (v.state === RUINED) {
      const k = BUILDING_KINDS[v.kind];
      const cost = Math.round(BUILDINGS[k].cost * BUILDING_REBUILD);
      out.push({ label: `Rebuild the ${BUILDINGS[k].name}`, detail: `${Math.round(v.health * 100)}% stands; half price`, cost, ok: s.gold >= cost, input: { kind: "build", plot: i, building: k } });
      return out;
    }
    if (BUILDING_KINDS[v.kind] === "barracks") {
      const b = s.barracks;
      const mix = b ? MIX_NAMES[b[i * 2]] : "pikemen";
      const route = b ? ROUTE_NAMES[b[i * 2 + 1]] : "centre";
      for (const m of MIX_NAMES as MixName[]) {
        const units = WAVE_MIXES[m].units;
        const count = (u: string) => units.filter((x) => x === u).length;
        const parts = [`${count("pikeman")} pikemen`];
        if (count("sapper")) parts.push(`${count("sapper")} sappers`);
        if (count("musketeer")) parts.push(`${count("musketeer")} musketeers`);
        out.push({ label: `Mix: ${WAVE_MIXES[m].name}`, detail: parts.join(", "), cost: 0, ok: true, pressed: m === mix, input: { kind: "barracks", plot: i, mix: m } });
      }
      // Routes are named from castle 1's side (its left is +x); castle 0 (the guest online) faces the other way.
      const own = (r: RouteName): RouteName => (s.team === 0 && r !== "centre" ? (r === "left" ? "right" : "left") : r);
      for (const v of ROUTE_NAMES as RouteName[]) {
        const r = own(v);
        out.push({ label: `Route: ${ROUTE_LABEL[v]}`, detail: "", cost: 0, ok: true, pressed: r === route, input: { kind: "barracks", plot: i, route: r } });
      }
      return out;
    }
    return out;
  }

  /** The menu's first page: everything the gold can buy, the cheapest way to each. */
  private listChoices(): Choice[] {
    const s = this.state, out: Choice[] = [];
    // A ruin first: it costs half.
    this.plots.forEach((v, i) => {
      if (v.state !== RUINED || v.kind < 0) return;
      const k = BUILDING_KINDS[v.kind];
      const cost = Math.round(BUILDINGS[k].cost * BUILDING_REBUILD);
      out.push({ label: `Rebuild the ${BUILDINGS[k].name}`, detail: `Plot ${i + 1}, ${plotName(s.team, i)}; half price`, cost, ok: s.gold >= cost, input: { kind: "build", plot: i, building: k } });
    });
    const free = PLOT_ORDER.find((p) => this.plots[p].state === EMPTY);
    // The magazine: one a castle, standing or rising (a ruin is rebuilt from the list above).
    const hasMagazine = this.plots.some((v) => v.kind >= 0 && BUILDING_KINDS[v.kind] === "magazine" && (v.state === STANDING || v.state === RISING));
    // Gold first (the cheapest and the one a new castle wants), then waves, then upgrades.
    for (const k of ["mill", "barracks", "foundry", "magazine"] as BuildingKind[]) {
      const b = BUILDINGS[k];
      if (k === "magazine" && s.powder === null) continue; // a match without powder has no use for one
      const one = k === "magazine" && hasMagazine;
      const ok = free !== undefined && s.gold >= b.cost && !one;
      const detail = one ? "You have one" : free === undefined ? "Every plot is taken" : `${b.blurb}; ${Math.round(b.buildTicks / 60)} s to build`;
      out.push({ label: b.name, detail, cost: b.cost, ok, input: free === undefined || one ? null : { kind: "build", plot: free, building: k } });
    }
    // Powder: bought at once at the working magazine.
    if (s.powder !== null) {
      const why = powderBuyWhy(s.powder ?? null, s.gold);
      out.push({ label: `Powder, ${POWDER.buy.charges} for ${POWDER.buy.gold} gold`, detail: why || "Into the magazine at once", cost: POWDER.buy.gold, ok: !why, input: { kind: "powder" } });
    }
    s.guns.forEach((e, slot) => {
      if (!e.empty) return;
      const kinds = e.allowed ?? [];
      const cheapest = Math.min(...kinds.map((k) => WEAPON_COST[k]));
      const down = s.mountDown?.[slot] === true;
      out.push({ label: `Gun for slot ${slot + 1}`, detail: down ? "Its masonry is down: masons first" : kinds.map((k) => WEAPONS[k].name.toLowerCase()).join(", "), cost: cheapest, from: kinds.length > 1, ok: !down && s.gold >= cheapest, input: null, sub: SLOT + slot });
    });
    if (s.guns.some((e) => !e.empty && !e.upgrade && upgradesFor(e.weapon).length)) {
      out.push({ label: "Upgrade a gun", detail: s.foundry ? "One per gun" : "Needs a working Foundry", cost: 0, ok: s.foundry, input: null, sub: UPGRADE_LIST });
    }
    return out;
  }

  /** The guns that can still take an upgrade. */
  private upgradeList(): Choice[] {
    const s = this.state;
    const out: Choice[] = [];
    s.guns.forEach((e, slot) => {
      if (e.empty || e.upgrade || !upgradesFor(e.weapon).length) return;
      const ups = upgradesFor(e.weapon);
      out.push({ label: `Slot ${slot + 1}: ${WEAPONS[e.weapon].name}`, detail: ups.map((u) => u.name).join(" or "), cost: Math.min(...ups.map((u) => u.cost)), from: true, ok: s.foundry, input: null, sub: SLOT + slot });
    });
    return out;
  }

  private gunChoices(e: Emplacement | null): Choice[] {
    const s = this.state;
    if (!e) return [];
    const id = e.id;
    if (e.empty) {
      // After M5: a gun stands on its masonry, so none can be bought for a slot whose masonry is down.
      const down = s.mountDown?.[s.guns.findIndex((g) => g.id === id)] === true;
      return (e.allowed ?? []).map((k: WeaponKind) => ({ label: WEAPONS[k].name, detail: down ? "Its masonry is down: masons first" : gunBlurb(k), cost: WEAPON_COST[k], ok: !down && s.gold >= WEAPON_COST[k], input: { kind: "buy" as const, emplacement: id, weapon: k } }));
    }
    return upgradesFor(e.weapon).map((u) => {
      const has = e.upgrade === u.kind;
      const ok = !e.upgrade && s.foundry && s.gold >= u.cost;
      const detail = has ? "Fitted" : e.upgrade ? `It has ${UPGRADES[e.upgrade as UpgradeKind].name}: one upgrade per gun` : !s.foundry ? `${u.blurb}. Needs a working Foundry` : u.blurb;
      return { label: u.name, detail, cost: has ? 0 : u.cost, ok, pressed: has, input: has ? null : { kind: "upgrade" as const, emplacement: id, upgrade: u.kind } };
    });
  }
}

function gunBlurb(k: WeaponKind): string {
  switch (k) {
    case "longGun":
      return "Flat and fast: breaks walls";
    case "mortar":
      return "High arc: roofs, keeps and waves";
    case "chainShot":
      return "Mows down ranks, sweeps gun crews";
    default:
      return "Grapeshot at close range";
  }
}
