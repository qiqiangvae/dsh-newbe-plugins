import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceTripleTap, swapResult, shouldAutoLock, shouldAutoUnlock } from "./core.js";

test("advanceTripleTap: counts 1 then 2 while the gesture is open", () => {
  assert.deepEqual(advanceTripleTap(0), { tapCount: 1, complete: false });
  assert.deepEqual(advanceTripleTap(1), { tapCount: 2, complete: false });
});

test("advanceTripleTap: third tap completes and resets to 0", () => {
  assert.deepEqual(advanceTripleTap(2), { tapCount: 0, complete: true });
});

test("advanceTripleTap: does not fire before the third tap", () => {
  const first = advanceTripleTap(0);
  const second = advanceTripleTap(first.tapCount);
  assert.equal(first.complete, false);
  assert.equal(second.complete, false);
});

test("swapResult: empty slot stages the whole draft and empties the composer", () => {
  const out = swapResult("", "hello world");
  assert.deepEqual(out, { staged: "hello world", draft: "" });
});

test("swapResult: full slot swaps both sides atomically, losing nothing", () => {
  const out = swapResult("staged text", "current text");
  assert.deepEqual(out, { staged: "current text", draft: "staged text" });
});

test("swapResult: both empty is a no-op", () => {
  const out = swapResult("", "");
  assert.deepEqual(out, { staged: "", draft: "" });
});

test("shouldAutoLock: fires only on the upward edge past the threshold", () => {
  assert.equal(shouldAutoLock(80, 81, 80), true);
  assert.equal(shouldAutoLock(0, 81, 80), true);
});

test("shouldAutoLock: strict > — exactly at threshold does not lock", () => {
  assert.equal(shouldAutoLock(79, 80, 80), false);
});

test("shouldAutoLock: does not re-fire while already above the threshold", () => {
  assert.equal(shouldAutoLock(81, 82, 80), false);
  assert.equal(shouldAutoLock(100, 200, 80), false);
});

test("shouldAutoLock: never fires on a downward move", () => {
  assert.equal(shouldAutoLock(82, 60, 80), false);
  assert.equal(shouldAutoLock(81, 80, 80), false);
});

test("shouldAutoUnlock: fires only when the draft empties completely", () => {
  assert.equal(shouldAutoUnlock(81, 0), true);
  assert.equal(shouldAutoUnlock(1, 0), true);
});

test("shouldAutoUnlock: does not fire while already empty", () => {
  assert.equal(shouldAutoUnlock(0, 0), false);
});

test("shouldAutoUnlock: does not fire on a shrink to a non-zero length", () => {
  assert.equal(shouldAutoUnlock(81, 60, 80), false);
  assert.equal(shouldAutoUnlock(10, 1), false);
});
