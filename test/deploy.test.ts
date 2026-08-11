// Unit tests for the concurrency-cap eviction decision.
import assert from "node:assert/strict";
import { test } from "node:test";
import { pickEvictions } from "../lib/deploy";

test("pickEvictions: nothing to evict when under the cap", () => {
  assert.deepEqual(pickEvictions([{ id: "a", seen: 1 }, { id: "b", seen: 2 }], 5), []);
});

test("pickEvictions: at the cap, evicts the single least-recently-active", () => {
  const running = [
    { id: "a", seen: 30 }, { id: "b", seen: 10 }, { id: "c", seen: 20 },
    { id: "d", seen: 5 }, { id: "e", seen: 40 },
  ];
  // 5 running + 1 newcomer, cap 5 -> pause the 1 oldest (d).
  assert.deepEqual(pickEvictions(running, 5), ["d"]);
});

test("pickEvictions: well over the cap, evicts several oldest-first", () => {
  const running = [{ id: "a", seen: 3 }, { id: "b", seen: 1 }, { id: "c", seen: 2 }];
  // cap 1 -> need 3+1-1 = 3 -> evict all, least-recently-active first.
  assert.deepEqual(pickEvictions(running, 1), ["b", "c", "a"]);
});
