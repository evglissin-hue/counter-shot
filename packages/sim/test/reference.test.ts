import { test } from "node:test";
import assert from "node:assert/strict";
import RD from "@dimforge/rapier3d-deterministic-compat";
import { buildLayout } from "@keepfall/content";
import { REFERENCE_SIEGE_HASH, referenceSiegeHash, type Rapier } from "@keepfall/sim";

test("the reference siege reproduces the lab's device hash", async () => {
  await RD.init();
  const h = referenceSiegeHash(RD as unknown as Rapier, buildLayout(1));
  assert.deepEqual(h, REFERENCE_SIEGE_HASH);
});
