// The steward's ear on the game page (track V): the order line (Enter), voice
// (hold T), the answer, and the standing orders. Every order goes out through
// the page's own functions (`act`), so the HUD stays in step and the match sees
// only the inputs a key or a button would send.

import { parse, STANDING_ORDERS, type OrdersView, type StandingId } from "@keepfall/orders";
import type { MatchInput } from "@keepfall/rules";
import { Standing, type StandingCtx } from "./standing";
import { SPEAK_DEFAULT, Speaker, Voice } from "./voice";

export { buildView, type ViewData } from "./view";
export { SPEAK_DEFAULT } from "./voice";

export interface StewardDeps {
  $: (id: string) => HTMLElement;
  canvas: HTMLElement;
  /** In a match that is running, not ridden on the shot camera, no menu or end screen over it. */
  available: () => boolean;
  view: () => OrdersView | null;
  /** The page's own function for one input (order, route, repair, man, build and the rest). */
  act: (input: MatchInput) => void;
  note: (text: string, ms: number) => void;
  /** Opening the line closes the build menu. */
  closeBuild: () => void;
  standingCtx: () => StandingCtx | null;
}

const REFUSED_KEY = "keepfall.steward.refused";
const SPEAK_KEY = "keepfall.steward.speak";
const REFUSED_KEPT = 20;
const ANSWER_MS = 4000;

function readJson<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage can be blocked */
  }
}

export interface Steward {
  readonly isOpen: boolean;
  /** The standing orders on now (for the view). */
  standing: () => StandingId[];
  /** Every frame. */
  tick: (now: number) => void;
  /** A new match: standing orders off, the line shut. */
  reset: () => void;
  close: () => void;
}

export function createSteward(deps: StewardDeps): Steward {
  const { $ } = deps;
  const box = $("steward");
  const chipsEl = $("steward-chips");
  const answerEl = $("steward-answer");
  const rowEl = $("steward-row");
  const listenEl = $("steward-listen");
  const inputEl = $("steward-input") as HTMLInputElement;
  const refusedEl = $("steward-refused");
  const refusedHead = $("steward-refused-head");
  const speakRow = $("steward-speak-row");
  const speakBox = $("steward-speak") as HTMLInputElement;

  let open = false;
  let lastSent = "";
  let answerTimer: ReturnType<typeof setTimeout> | undefined;
  let refused = readJson<string[]>(REFUSED_KEY, []).filter((s) => typeof s === "string").slice(-REFUSED_KEPT);
  let chipsKey = "";

  const standing = new Standing({ act: deps.act, note: deps.note });

  // Talking back.
  let speakOn = SPEAK_DEFAULT;
  try {
    const s = localStorage.getItem(SPEAK_KEY);
    if (s !== null) speakOn = s === "1";
  } catch {
    /* ignore */
  }
  speakBox.checked = speakOn;
  const speaker = new Speaker(() => (speakRow.hidden = !speaker.offered));
  speakRow.hidden = !speaker.offered;
  speakBox.addEventListener("change", () => {
    speakOn = speakBox.checked;
    try {
      localStorage.setItem(SPEAK_KEY, speakOn ? "1" : "0");
    } catch {
      /* ignore */
    }
  });

  // Voice.
  const showVoiceKey = () => {
    for (const id of ["steward-voice-dt", "steward-voice-dd"]) $(id).hidden = !voice.offered;
  };
  const voice: Voice = new Voice(
    {
      heard: (text) => {
        if (!open) return;
        inputEl.value = text;
      },
      done: (text) => {
        listenEl.hidden = true;
        if (!open) return;
        if (!text) {
          say("Heard nothing", true);
          close();
          return;
        }
        inputEl.value = text;
        submit();
      },
      failed: () => {
        listenEl.hidden = true;
        if (open) close();
      },
    },
    showVoiceKey,
  );
  showVoiceKey();

  function layout() {
    box.hidden = !open && answerEl.hidden;
    rowEl.hidden = !open;
    renderChips();
  }

  function renderChips() {
    const ids = open ? standing.list() : [];
    const key = ids.join(",");
    if (key === chipsKey) return;
    chipsKey = key;
    chipsEl.replaceChildren(
      ...ids.map((id) => {
        const chip = document.createElement("span");
        chip.className = "steward-chip";
        chip.title = STANDING_ORDERS[id].blurb;
        chip.append(STANDING_ORDERS[id].name + " ");
        const x = document.createElement("button");
        x.type = "button";
        x.textContent = "x";
        x.setAttribute("aria-label", `Switch off: ${STANDING_ORDERS[id].name}`);
        x.addEventListener("click", () => setStanding(id, false));
        chip.append(x);
        return chip;
      }),
    );
    chipsEl.hidden = ids.length === 0;
  }

  function setStanding(id: StandingId, on: boolean) {
    standing.set(id, on);
    renderChips();
  }

  function say(text: string, bad = false) {
    answerEl.textContent = text;
    answerEl.classList.toggle("bad", bad);
    answerEl.hidden = false;
    clearTimeout(answerTimer);
    if (!open) answerTimer = setTimeout(hideAnswer, ANSWER_MS);
    layout();
    if (speakOn) speaker.speak(text);
  }
  function hideAnswer() {
    answerEl.hidden = true;
    layout();
  }

  function openLine(focus: boolean) {
    if (!open) {
      deps.closeBuild();
      open = true;
      clearTimeout(answerTimer);
      chipsKey = "";
    }
    layout();
    if (focus) inputEl.focus();
  }

  function close() {
    if (!open) return;
    open = false;
    if (voice.listening) voice.stop();
    listenEl.hidden = true;
    inputEl.blur();
    if (!answerEl.hidden) {
      clearTimeout(answerTimer);
      answerTimer = setTimeout(hideAnswer, ANSWER_MS);
    }
    layout();
  }

  function remember(text: string) {
    refused = refused.filter((s) => s !== text);
    refused.push(text);
    if (refused.length > REFUSED_KEPT) refused = refused.slice(-REFUSED_KEPT);
    writeJson(REFUSED_KEY, refused);
    renderRefused();
  }
  function renderRefused() {
    refusedHead.hidden = refusedEl.hidden = refused.length === 0;
    refusedEl.replaceChildren(
      ...refused
        .slice()
        .reverse()
        .map((s) => {
          const li = document.createElement("li");
          li.textContent = s;
          return li;
        }),
    );
  }
  renderRefused();

  function submit() {
    const text = inputEl.value.trim();
    if (!text) {
      close();
      return;
    }
    const view = deps.view();
    if (!view) {
      say("No match to give orders in", true);
      return;
    }
    const r = parse(text, view);
    if (!r.ok) {
      say(r.reason, true);
      remember(text);
      inputEl.focus();
      return;
    }
    for (const step of r.steps) {
      if (step.kind === "input") deps.act(step.input);
      else {
        setStanding(step.id, step.on);
        deps.note(`Steward: ${step.say}`, 2600);
      }
    }
    lastSent = text;
    inputEl.value = "";
    say(r.say);
    close();
  }

  const typingTarget = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
  };

  window.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.altKey || e.metaKey;
    if (e.target === inputEl) {
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        e.preventDefault();
        if (!e.repeat) submit();
      } else if (e.code === "Escape") {
        e.preventDefault();
        close();
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        if (lastSent) inputEl.value = lastSent;
      }
      return;
    }
    if (open && e.code === "Escape") {
      close();
      return;
    }
    if (e.repeat || mod) return;
    if (e.code === "Enter" || e.code === "NumpadEnter") {
      if (voice.listening) return;
      if (open) {
        e.preventDefault();
        inputEl.focus();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (typingTarget(t) || t?.tagName === "BUTTON" || t?.tagName === "A") return;
      if (!deps.available()) return;
      e.preventDefault();
      openLine(true);
    } else if (e.code === "KeyT" && voice.offered && !typingTarget(e.target) && deps.available()) {
      openLine(false);
      listenEl.hidden = false;
      inputEl.value = "";
      voice.start();
      if (!voice.listening) listenEl.hidden = true;
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyT" && voice.listening) voice.stop();
  });
  window.addEventListener("blur", () => {
    if (voice.listening) voice.stop();
  });
  // A click on the scene closes the line; the click still fires (input.ts handles it).
  deps.canvas.addEventListener("mousedown", () => close());

  return {
    get isOpen() {
      return open;
    },
    close,
    standing: () => standing.list(),
    reset() {
      standing.reset();
      close();
      hideAnswer();
      chipsKey = "";
    },
    tick(now: number) {
      if (open && !deps.available()) close();
      const ctx = deps.standingCtx();
      if (ctx) standing.tick(now, ctx);
    },
  };
}
