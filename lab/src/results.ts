// Saving test results where Claude can read them (the page's shared
// database on claude.ai), with a copy-to-clipboard fallback everywhere else.

import type { RubbleResult, SiegeResult } from "./physics/bench";
import type { ProbeResult } from "./probe";

export interface GraphicsRow {
  tier: string;
  fps: number;
  p95Ms: number;
  gpuMs: number | null;
}

export interface LabResult {
  version: 1;
  label: string;
  at: string;
  build: string;
  device: ProbeResult;
  graphics: { backend: string; refreshHz: number; style: string; rows: GraphicsRow[]; recommended: string };
  physics: {
    siegeDet: SiegeResult;
    rubbleDet: RubbleResult;
    siegeSimd: SiegeResult | null;
    rubbleSimd: RubbleResult | null;
    reference: { state: string; snapshot: string };
    matchesReference: boolean;
  };
}

interface DbLike {
  collection(path: string): {
    add(data: Record<string, unknown>): Promise<unknown>;
    orderBy(field: string, dir?: "asc" | "desc"): {
      limit(n: number): {
        onSnapshot(
          next: (snap: { docs: Array<{ id: string; data(): Record<string, unknown> | undefined }> }) => void,
          error?: (e: unknown) => void,
        ): () => void;
      };
    };
  };
}

type ClaudeWindow = Window & { claude?: { use(name: string): Promise<unknown> } };

let dbPromise: Promise<DbLike | null> | null = null;

export function getDb(): Promise<DbLike | null> {
  if (!dbPromise) {
    const c = (window as ClaudeWindow).claude;
    dbPromise = c?.use ? (c.use("db") as Promise<DbLike | null>).catch(() => null) : Promise.resolve(null);
  }
  return dbPromise;
}

/** Save to the shared store. Resolves true when saved. */
export async function saveResult(result: LabResult): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.collection("results").add(JSON.parse(JSON.stringify(result)) as Record<string, unknown>);
    return true;
  } catch {
    return false;
  }
}

/** Live list of saved results, newest first. Returns an unsubscribe, or null without a store. */
export async function watchResults(onChange: (rows: LabResult[]) => void, onError: () => void): Promise<(() => void) | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    return db
      .collection("results")
      .orderBy("at", "desc")
      .limit(30)
      .onSnapshot(
        (snap) => onChange(snap.docs.map((d) => d.data() as unknown as LabResult).filter(Boolean)),
        () => onError(),
      );
  } catch {
    onError();
    return null;
  }
}

/** Copy text; falls back to selecting it in a textarea the caller shows. */
export async function copyText(text: string, fallback: HTMLTextAreaElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    fallback.hidden = false;
    fallback.value = text;
    fallback.focus();
    fallback.select();
    return false;
  }
}
