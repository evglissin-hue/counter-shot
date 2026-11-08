// The build wheel (phase 2 M3): a map of your courtyard with its six plots and
// the gun you ride, and what each can take. B opens it; a number picks a plot
// (1 to 6) or the gun (7), a second number picks what to do (build, rebuild,
// set a barracks' mix or route, buy a gun, upgrade it); Backspace goes back;
// B or Esc closes it. Everything can be clicked too. It only sends inputs:
// the match decides (and refuses what cannot be paid for).

import {
  BUILDING_KINDS,
  BUILDING_REBUILD,
  BUILDINGS,
  MIX_NAMES,
  PLOTS,
  plotName,
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

/** Plot states (sim structures.ts PlotState). */
const EMPTY = 0, RISING = 1, STANDING = 2, RUINED = 3;
const KIND_NAMES = BUILDING_KINDS.map((k) => BUILDINGS[k].name);
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
}

export interface WheelState {
  gold: number;
  team: number;
  /** The player's barracks settings per plot: [mix index, route index]. */
  barracks: Int8Array | null;
  foundry: boolean;
  /** The gun you ride, and its slot number (0 to 7). */
  gun: Emplacement | null;
  gunSlot: number;
}

export class BuildWheel {
  isOpen = false;
  /** -1 nothing chosen; 0..5 a plot; 6 the gun. */
  private target = -1;
  private plots: PlotInfo[] = PLOTS.map(() => ({ kind: -1, state: EMPTY, share: 0, health: 0 }));
  private state: WheelState = { gold: 0, team: 1, barracks: null, foundry: false, gun: null, gunSlot: 0 };
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

  /** A number key while the wheel is open: a target first, then a choice. */
  digit(n: number) {
    if (this.target < 0) {
      if (n >= 1 && n <= PLOTS.length) this.pick(n - 1);
      else if (n === PLOTS.length + 1) this.pick(6);
    } else this.choose(n - 1);
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
    if (!c || !c.input) return;
    if (!c.ok) {
      this.note(c.cost > this.state.gold ? `Not enough gold: ${c.label} costs ${c.cost}.` : `${c.label}: not now.`);
      return;
    }
    this.send(c.input);
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
    this.choices = this.target < 0 ? [] : this.target === 6 ? this.gunChoices() : this.plotChoices(this.target);
    const plotBox = (i: number) => {
      const p = PLOTS[i], v = this.plots[i];
      // The map is drawn as the player faces from the gate wall, the field ahead (up): their left on the left, the gate at the top.
      const x = s.team === 1 ? -p.x : p.x;
      const z = p.z;
      const what = v.kind < 0 ? "Empty" : `${KIND_NAMES[v.kind]}${v.state === RISING ? ` ${Math.round(v.share * 100)}%` : v.state === RUINED ? " (ruined)" : ""}`;
      const cls = `plot${this.target === i ? " sel" : ""}${v.state === RUINED ? " ruin" : ""}${v.kind < 0 ? " empty" : ""}`;
      return `<button class="${cls}" data-pick="${i}" style="left:${50 + x * 2.9 - p.w * 1.45}%;top:${50 + z * 2.9 - p.d * 1.45}%;width:${p.w * 2.9}%;height:${p.d * 2.9}%"><b>${i + 1}</b><span>${what}</span></button>`;
    };
    const head = this.target < 0
      ? `<p class="small">Pick a plot (1 to 6) or the gun you ride (7). Gold: <b class="goldtxt">${s.gold}</b></p>`
      : this.target === 6
        ? `<p class="small"><b>${s.gun ? `Gun ${s.gunSlot + 1}: ${s.gun.empty ? "an empty emplacement" : WEAPONS[s.gun.weapon].name}` : "No gun"}</b>${s.gun?.place ? `, ${s.gun.place}` : ""}. Gold: <b class="goldtxt">${s.gold}</b></p>`
        : `<p class="small"><b>Plot ${this.target + 1}</b>, ${plotName(s.team, this.target)}. Gold: <b class="goldtxt">${s.gold}</b></p>`;
    const list = this.choices
      .map((c, i) => `<button class="choice2${c.ok ? "" : " no"}${c.pressed ? " on" : ""}" data-choice="${i}"><span class="k">${i + 1}</span><b>${c.label}</b><span class="d">${c.detail}</span>${c.cost ? `<span class="c">${c.cost}</span>` : ""}</button>`)
      .join("");
    const html =
      `<div class="wheel-head"><h2>Build</h2><span class="small">B or Esc closes${this.target >= 0 ? ", Backspace goes back" : ""}</span><button data-act="close">Close</button></div>` +
      head +
      `<div class="yard" aria-label="Your courtyard, the gate at the top"><div class="keep" style="left:35.5%;top:47.1%;width:29%;height:29%">Keep</div><div class="gatemark">Gate</div>${PLOTS.map((_, i) => plotBox(i)).join("")}<button class="gunpick${this.target === 6 ? " sel" : ""}" data-pick="6"><b>7</b><span>Gun ${s.gunSlot + 1}</span></button></div>` +
      (this.target >= 0 ? `<div class="choices2">${list || `<p class="small">Nothing to do here now.</p>`}</div>` : "");
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
        out.push({ label: b.name, detail: `${b.blurb}. Rises in ${Math.round(b.buildTicks / 60)} s`, cost: b.cost, ok: s.gold >= b.cost, input: { kind: "build", plot: i, building: k } });
      }
      return out;
    }
    if (v.state === RUINED) {
      const k = BUILDING_KINDS[v.kind];
      const cost = Math.round(BUILDINGS[k].cost * BUILDING_REBUILD);
      out.push({ label: `Rebuild the ${BUILDINGS[k].name}`, detail: `${Math.round(v.health * 100)}% of it stands; it works again once rebuilt`, cost, ok: s.gold >= cost, input: { kind: "build", plot: i, building: k } });
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
      for (const r of ROUTE_NAMES as RouteName[]) out.push({ label: `Route: ${ROUTE_LABEL[r]}`, detail: v.state === RISING ? "Its waves will march here" : "Its waves march here", cost: 0, ok: true, pressed: r === route, input: { kind: "barracks", plot: i, route: r } });
      return out;
    }
    return out;
  }

  private gunChoices(): Choice[] {
    const s = this.state, e = s.gun;
    if (!e) return [];
    const id = e.id;
    if (e.empty) {
      return (e.allowed ?? []).map((k: WeaponKind) => ({ label: WEAPONS[k].name, detail: gunBlurb(k), cost: WEAPON_COST[k], ok: s.gold >= WEAPON_COST[k], input: { kind: "buy" as const, emplacement: id, weapon: k } }));
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
      return "Fast and flat: the wall breaker";
    case "mortar":
      return "A high arc and a fused shell: roofs, keeps and waves";
    case "chainShot":
      return "Two balls on a chain: scythes through ranks";
    default:
      return "Grapeshot at short range: the last line at your walls";
  }
}
