// Voice (V2): hold a key to talk, let go to send. Never a toggle. Sources in
// order: the claude.ai artifact `dictation` capability, then the browser's own
// SpeechRecognition, else voice is not offered. Talking back (V2.4) uses the
// artifact `tts` capability, else speechSynthesis.

/** The little of the claude.ai runtime this page uses. */
interface Dictation {
  start(): Promise<void>;
  stop(): Promise<void>;
  onPartial(fn: (e: { text: string }) => void): () => void;
  onFinal(fn: (e: { text: string }) => void): () => void;
}
interface Tts {
  speak(text: string): Promise<void>;
  stop?(): void;
}
interface ClaudeRuntime {
  use?: (name: string) => Promise<unknown>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives?: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

/** Does the answer speak aloud by default? The owner has not decided: off. */
export const SPEAK_DEFAULT = false;

const runtime = (): ClaudeRuntime | undefined => (window as unknown as { claude?: ClaudeRuntime }).claude;

async function useCap<T>(name: string): Promise<T | null> {
  try {
    return ((await runtime()?.use?.(name)) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export interface VoiceHooks {
  /** Words heard so far (provisional included), to show in the line. */
  heard: (text: string) => void;
  /** The key was let go and the words are in: send them through the parser. `alts` are the recogniser's other readings of the same speech, best first. */
  done: (text: string, alts?: string[]) => void;
  /** It could not listen: nothing to send. */
  failed: () => void;
}

export class Voice {
  private dict: Dictation | null = null;
  private rec: RecognitionCtor | null;
  private hidden = false;
  private active: { stop: () => Promise<void> } | null = null;

  constructor(private hooks: VoiceHooks, private onOffer: () => void) {
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    this.rec = w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
    void useCap<Dictation>("dictation").then((d) => {
      this.dict = d;
      this.onOffer();
    });
  }

  /** Is voice offered (a source found and not refused)? */
  get offered(): boolean {
    return !this.hidden && (!!this.dict || !!this.rec);
  }

  get listening(): boolean {
    return !!this.active;
  }

  /** Call from the key handler, synchronously. */
  start() {
    if (this.active || !this.offered) return;
    if (this.dict) this.startDictation(this.dict);
    else if (this.rec) this.startRecognition(this.rec);
  }

  /** The key was let go. */
  stop() {
    const a = this.active;
    if (a) void a.stop();
  }

  private startDictation(d: Dictation) {
    const finals: string[] = [];
    let partial = "";
    let ended = false;
    const show = () => this.hooks.heard([...finals, partial].join(" ").trim());
    const offP = d.onPartial((e) => {
      partial = e.text;
      show();
    });
    const offF = d.onFinal((e) => {
      finals.push(e.text.trim());
      partial = "";
      show();
    });
    const finish = (send: boolean) => {
      if (ended) return;
      ended = true;
      offP();
      offF();
      this.active = null;
      if (send) this.hooks.done(finals.join(" ").trim());
      else this.hooks.failed();
    };
    this.active = {
      stop: async () => {
        try {
          await d.stop();
        } catch {
          /* ignore */
        }
        finish(true);
      },
    };
    d.start().catch((e: { code?: string }) => {
      if (e?.code === "not_granted") {
        this.hidden = true;
        this.onOffer();
      }
      finish(false);
    });
  }

  private startRecognition(Ctor: RecognitionCtor) {
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 5;
    let text = "";
    let alts: string[] = [];
    let ended = false;
    r.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      text = t.trim();
      this.hooks.heard(text);
      // The other readings: the same speech with each result's next best words (a result with fewer keeps its best).
      const n = Math.max(0, ...Array.from({ length: e.results.length }, (_, i) => e.results[i].length));
      alts = [];
      for (let j = 1; j < n; j++) {
        let a = "";
        for (let i = 0; i < e.results.length; i++) a += (e.results[i][j] ?? e.results[i][0]).transcript;
        if (a.trim() && a.trim() !== text) alts.push(a.trim());
      }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.hidden = true;
        this.onOffer();
      }
    };
    r.onend = () => {
      if (ended) return;
      ended = true;
      this.active = null;
      if (this.hidden) this.hooks.failed();
      else this.hooks.done(text, alts);
    };
    this.active = {
      stop: async () => {
        try {
          r.stop();
        } catch {
          /* ignore */
        }
      },
    };
    try {
      r.start();
    } catch {
      ended = true;
      this.active = null;
      this.hooks.failed();
    }
  }
}

/** Talking back: the artifact's tts, else the browser's speech synthesis. */
export class Speaker {
  private tts: Tts | null = null;
  private refused = false;

  constructor(private onOffer: () => void) {
    void useCap<Tts>("tts").then((t) => {
      this.tts = t;
      this.onOffer();
    });
  }

  get offered(): boolean {
    return !this.refused && (!!this.tts || (typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined"));
  }

  speak(text: string) {
    if (!this.offered || !text) return;
    if (this.tts) {
      this.tts.speak(text).catch((e: { code?: string }) => {
        if (e?.code === "not_granted") {
          this.tts = null;
          if (typeof speechSynthesis === "undefined") this.refused = true;
          this.onOffer();
        }
      });
      return;
    }
    try {
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch {
      /* ignore */
    }
  }
}
