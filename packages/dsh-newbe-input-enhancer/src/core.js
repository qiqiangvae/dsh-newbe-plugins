/**
 * dsh-input-enhancer — pure logic core (no DOM / React / Cordis dependency).
 *
 * The testable seam for the composer-lock triple-tap gesture and the draft-slot
 * swap. `src/client.js` stays thin glue: it owns timing (setTimeout) and DOM
 * side effects, while the *what happens next* decision lives here so it can be
 * unit-tested with node:test.
 *
 * Contracts:
 *  - `advanceTripleTap(tapCount)` → `{ tapCount, complete }`: increments the
 *    in-progress tap count; `complete === true` exactly when this tap is the
 *    third (unlock + send). The returned `tapCount` is what the store should
 *    hold next (counts 1..2 while gesture is open, resets to 0 once complete).
 *  - `nextSwap(nextStaged, currentDraft)` — not used; see `swapResult`.
 *  - `swapResult(stagedText, currentDraft)` → `{ staged: string, draft: string }`:
 *    the atomic slot⇄composer exchange. Empty slot stages the draft (composer
 *    empties); full slot swaps the two (nothing is lost). The returned `staged`
 *    is what the slot holds next; `draft` is what the composer should show.
 *  - `shouldAutoLock(prevLen, nextLen, threshold)` → `boolean`: the rising-edge
 *    detector for auto-lock. True only on the crossing from `<= threshold` to
 *    `> threshold` — i.e. one-shot on the upward edge, never while already
 *    above nor on any downward move.
 *  - `shouldAutoUnlock(prevLen, nextLen)` → `boolean`: the falling-edge detector
 *    for auto-unlock. True only when the draft empties completely — from any
 *    non-zero length back to zero. The composer never stays locked when the
 *    text has been cleared.
 *
 * @module dsh-input-enhancer/core
 */

/**
 * Advance the locked-composer triple-tap counter.
 * @param {number} tapCount current stored tap count (0..2 while unlocked)
 * @returns {{ tapCount: number, complete: boolean }}
 */
export function advanceTripleTap(tapCount) {
  const count = tapCount + 1
  if (count >= 3) {
    return { tapCount: 0, complete: true }
  }
  return { tapCount: count, complete: false }
}

/**
 * The atomic draft-slot ⇄ composer exchange, a pure swap decided by occupancy.
 *   - slot empty  -> composer draft moves into the slot, composer empties.
 *   - slot full   -> the two contents swap (neither side is lost).
 * @param {string} stagedText current slot content ('' = empty)
 * @param {string} currentDraft current composer draft ('' = empty)
 * @returns {{ staged: string, draft: string }}
 */
export function swapResult(stagedText, currentDraft) {
  const staged = typeof stagedText === 'string' ? stagedText : ''
  const draft = typeof currentDraft === 'string' ? currentDraft : ''
  return { staged: draft, draft: staged }
}

/**
 * Rising-edge detector for auto-lock: true exactly when the draft length
 * crosses from `<= threshold` up to `> threshold` (a strict `>` comparison).
 * False while already above the threshold, and false on any downward move —
 * auto-lock only ever *adds* the lock at the moment of crossing. Callers keep
 * `prevLen` per session so the edge is tracked independently per conversation.
 * @param {number} prevLen previous draft length
 * @param {number} nextLen current draft length
 * @param {number} threshold lock threshold (auto-lock when nextLen > threshold)
 * @returns {boolean}
 */
export function shouldAutoLock(prevLen, nextLen, threshold) {
  const prev = typeof prevLen === 'number' ? prevLen : 0
  const next = typeof nextLen === 'number' ? nextLen : 0
  const thr = typeof threshold === 'number' ? threshold : 0
  return prev <= thr && next > thr
}

/**
 * Falling-edge detector for auto-unlock: true exactly when the draft emptied —
 * from any non-zero length back to zero. This is the single auto-unlock trigger;
 * shrinking to a smaller non-zero length keeps the lock. The lock has no
 * "manual vs automatic" source distinction: once it is on, clearing the composer
 * releases it regardless of how it was acquired.
 * @param {number} prevLen previous draft length
 * @param {number} nextLen current draft length
 * @returns {boolean}
 */
export function shouldAutoUnlock(prevLen, nextLen) {
  const prev = typeof prevLen === 'number' ? prevLen : 0
  const next = typeof nextLen === 'number' ? nextLen : 0
  return prev > 0 && next === 0
}
