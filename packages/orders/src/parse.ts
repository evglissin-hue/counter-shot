import type { OrdersView, ParseResult } from "./types";

/** An order line in plain words: the inputs it gives, or why not. */
export function parse(text: string, _view: OrdersView): ParseResult {
  return { ok: false, reason: `Not understood: ${text.trim()}` };
}
