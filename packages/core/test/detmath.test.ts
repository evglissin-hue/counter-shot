import { test } from "node:test";
import assert from "node:assert/strict";
import { dcos, dsin, dsqrt, hashString, hex8, Rng } from "@keepfall/core";

test("dsin and dcos stay close to the platform functions", () => {
  for (let x = -20; x <= 20; x += 0.37) {
    assert.ok(Math.abs(dsin(x) - Math.sin(x)) < 1e-12, `sin ${x}`);
    assert.ok(Math.abs(dcos(x) - Math.cos(x)) < 1e-12, `cos ${x}`);
  }
});

test("dsqrt is exact on squares and close elsewhere", () => {
  for (let i = 1; i < 2000; i++) assert.equal(dsqrt(i * i), i);
  for (let x = 0.001; x < 1e6; x *= 1.7) assert.ok(Math.abs(dsqrt(x) - Math.sqrt(x)) <= 1e-15 * Math.sqrt(x) * 4);
  assert.equal(dsqrt(0), 0);
});

test("Rng streams are fixed", () => {
  const r = new Rng(42);
  const seq = Array.from({ length: 6 }, () => r.nextU32());
  const again = new Rng(42);
  assert.deepEqual(Array.from({ length: 6 }, () => again.nextU32()), seq);
  let h = 0;
  const f = new Rng(7).fork("wind");
  for (let i = 0; i < 1000; i++) h = (Math.imul(h, 31) + f.nextU32()) >>> 0;
  assert.equal(hex8(h), "0a3d8ba1");
  assert.equal(hex8(hashString("keepfall")), "2bc6ad71");
});
