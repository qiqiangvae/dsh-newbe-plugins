window.__ModuleLoader__.load({
  id: 'dsh-input-enhancer',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    
    /**
     * Advance the locked-composer triple-tap counter.
     * @param {number} tapCount current stored tap count (0..2 while unlocked)
     * @returns {{ tapCount: number, complete: boolean }}
     */
    function advanceTripleTap(tapCount) {
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
    function swapResult(stagedText, currentDraft) {
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
    function shouldAutoLock(prevLen, nextLen, threshold) {
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
    function shouldAutoUnlock(prevLen, nextLen) {
      const prev = typeof prevLen === 'number' ? prevLen : 0
      const next = typeof nextLen === 'number' ? nextLen : 0
      return prev > 0 && next === 0
    }
/* =========================================================================
     * Constants & dictionaries
     * ======================================================================= */

    var NS = 'dsh-input-enhancer'
    var STYLE_ID = 'dsh-input-enhancer-style'

    /**
     * Host (DSH core) DOM contract — internal, undocumented selectors this
     * plugin reaches into. These may drift across DSH versions: after any DSH
     * upgrade, regression-test the four features against this table. Keeping
     * them in one place makes the coupling explicit instead of scattering
     * magic strings through the file.
     */
    var SEL = {
      composerCard: '[data-composer-card]',
      composerInput: '[data-composer-input]',
      suggestionMenu: '[role="listbox"]',
    }

    /**
     * Keyboard shortcut for the lock: Ctrl+Alt+L (Windows/Linux) or
     * Cmd+Alt+L (macOS). Enabled by default; it toggles the current session's
     * lock and only acts while the composer is focused. Deliberately NOT
     * Ctrl/Cmd+L (reserved for the browser address bar) and NOT Ctrl+Shift+L
     * (Edge reserves it for "paste and search").
     */
    var SHORTCUT_ENABLED = true

    /**
     * Draft slot ("staging slot") shortcut: Cmd+Opt+K. Pressing it toggles the
     * current session's draft slot: when the slot is empty it STAGES the
     * current draft (moves it out of the composer); when the slot is non-empty
     * it RESTORES the staged draft (overwrites the composer). One key, two
     * states, decided by the slot's occupancy. Kept as a constant so it can be
     * disabled or retuned later.
     *
     * Deliberately distinct from the lock shortcut (Cmd+Alt+L). Note Opt == Alt,
     * so Cmd+Opt+K sits adjacent to Cmd+Opt+L on the keyboard — a known (and
     * for now accepted) mis-press risk.
     */
    var STAGE_SHORTCUT_ENABLED = true

    var TRIPLE_TAP_WINDOW_MS = 800

    /** Duration of the unlock firework after the 3rd Enter tap. */
    var BURST_MS = 1000

    /**
     * Character count above which the composer is considered "long text":
     * the count badge switches to a warning state as a visual hint before
     * sending. Kept as a constant so it's easy to tune or expose later.
     */
    var LONG_TEXT_THRESHOLD = 800

    /**
     * Auto lock/unlock: when enabled, the composer locks itself the moment the
     * draft length crosses this threshold upward (strict `>`), and unlocks
     * itself when the draft is cleared back to empty. Between those two edges
     * (a non-empty length below the threshold, or any length above it short of
     * zero) the lock state is left untouched. The lock has no source
     * distinction — these length edges simply add/remove it, just like the
     * button, the shortcut, and the triple-tap escape hatch. Kept as constants
     * to stay zero-config, matching the other feature flags.
     */
    var AUTO_LOCK_ENABLED = true
    var AUTO_LOCK_THRESHOLD = 80

    var zh = {
      lockLabel: '锁定输入框',
      unlockLabel: '解锁输入框',
      unlockedHint: '已解锁，输入框为默认大小，Enter 可正常发送',
      lockedHint: '已锁定，Enter 不会发送；连按 3 次 Enter 可解锁并立即发送',
      charCountHint: '已输入 {count} 个字符',
      longTextHint: '已输入 {count} 个字符，内容较长',
      swapLabel: '交换草稿与暂存区',
      swapHint: '在输入框和暂存区之间交换内容（Cmd+Opt+K）',
      swapFilledHint: '暂存区有内容，点击取回并覆盖当前输入（Cmd+Opt+K）',
    }

    var en = {
      lockLabel: 'Lock composer',
      unlockLabel: 'Unlock composer',
      unlockedHint: 'Unlocked: composer is normal size, Enter sends normally',
      lockedHint: 'Locked: Enter will not send. Press Enter 3 times to unlock and send',
      charCountHint: '{count} characters entered',
      longTextHint: '{count} characters entered — long text',
      swapLabel: 'Swap draft with slot',
      swapHint: 'Swap content between the composer and the slot (Cmd+Opt+K)',
      swapFilledHint: 'Slot holds a draft — click to restore it, overwriting the current input (Cmd+Opt+K)',
    }

    /* =========================================================================
     * Infrastructure: a tiny external store + its React binding.
     *
     * Features own independent stores; `apply()` wires them. This generic
     * primitive keeps feature code free of publish/subscribe boilerplate.
     * ======================================================================= */

    function tinyStore(initial) {
      var listeners = new Set()
      var snapshot = initial

      return {
        getSnapshot: function () { return snapshot },
        subscribe: function (listener) {
          listeners.add(listener)
          return function () { listeners.delete(listener) }
        },
        set: function (updater) {
          var next = typeof updater === 'function' ? updater(snapshot) : updater
          if (next === snapshot) return
          snapshot = next
          listeners.forEach(function (listener) { listener() })
        },
      }
    }

    function useStoreSnapshot(store) {
      return React.useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
      )
    }

    /* =========================================================================
     * Shared icon components
     * ======================================================================= */

    function LockIcon(props) {
      var locked = props.locked
      var shackle = locked
        ? 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2'
        : 'M5.5 7V5a2.5 2.5 0 0 1 5 0'
      return React.createElement('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        'aria-hidden': true,
        fill: 'none',
      },
        React.createElement('path', {
          d: shackle,
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
        React.createElement('rect', {
          x: 3.5,
          y: 7,
          width: 9,
          height: 6,
          rx: 1.5,
          fill: 'currentColor',
        }))
    }

    /**
     * Draft-slot icon: a directional-agnostic swap glyph (two opposing
     * arrows). The button is NOT a directed "store" / "restore" pair — it is a
     * single swap action that moves the current text between the composer and
     * the slot, in whichever direction the slot's occupancy implies. The icon
     * therefore carries no up/down bias; only the filled highlight (driven by
     * `data-dsh-stage-filled`) signals that the slot currently holds a draft.
     */
    function StageIcon(props) {
      return React.createElement('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        'aria-hidden': true,
        fill: 'none',
      },
        React.createElement('path', {
          d: 'M3.5 5.5h7M8 3.5L10.5 5.5L8 7.5',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        React.createElement('path', {
          d: 'M12.5 10.5h-7M8 12.5L5.5 10.5L8 8.5',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }))
    }

    /**
     * Firework layer shown for ~1s after the 3rd Enter tap. It is a fixed
     * overlay anchored to the lock button's center, so the particles can
     * escape the 28px button bounds (the button itself clips nothing).
     *
     * Each particle is a tiny square that flies outward along a pre-set
     * angle, falls with a slight deceleration, and fades. Colors are fixed to
     * stay dependency-free (no image/emoji assets).
     */
    var FIREWORK_COLORS = ['#ffd166', '#ff6b6b', '#4ecdc4', '#a78bfa', '#f472b6', '#60a5fa', '#fbbf24']
    var FIREWORK_COUNT = 32

    /**
     * Mount a firework directly onto `document.body` and auto-remove it after
     * ~1s. It is plain DOM (not React) on purpose: `react-dom` is not in the
     * module table, and body-mounting escapes any transform/filter/contain on
     * the composer's ancestors that would otherwise break `position: fixed`
     * and shift the firework away from the lock button.
     *
     * @param anchor - { x, y } viewport center where the burst originates.
     */
    function mountFirework(anchor) {
      if (typeof document === 'undefined') return function () {}
      var root = document.createElement('div')
      root.setAttribute('data-dsh-firework', '')
      root.style.left = anchor.x + 'px'
      root.style.top = anchor.y + 'px'

      var core = document.createElement('span')
      core.className = 'dsh-firework-core'
      var flash = document.createElement('span')
      flash.className = 'dsh-firework-flash'
      root.appendChild(core)
      root.appendChild(flash)

      var angleStep = (Math.PI * 2) / FIREWORK_COUNT
      for (var i = 0; i < FIREWORK_COUNT; i++) {
        var angle = angleStep * i + (i % 2) * angleStep * 0.25 // slight jitter
        var dist = 56 + (i % 5) * 11 // 56 ~ 100px, varied travel
        var size = 6 + (i % 3) * 2 // 6 / 8 / 10px mix
        var p = document.createElement('span')
        p.className = 'dsh-firework-particle'
        p.style.setProperty('--dsh-fw-color', FIREWORK_COLORS[i % FIREWORK_COLORS.length])
        p.style.setProperty('--dsh-fw-dx', (Math.cos(angle) * dist) + 'px')
        p.style.setProperty('--dsh-fw-dy', (Math.sin(angle) * dist) + 'px')
        p.style.setProperty('--dsh-fw-size', size + 'px')
        root.appendChild(p)
      }

      document.body.appendChild(root)

      var removed = false
      function cleanup() {
        if (removed) return
        removed = true
        if (root.parentNode) root.parentNode.removeChild(root)
      }
      setTimeout(cleanup, BURST_MS)
      return cleanup
    }

    /* =========================================================================
     * Shared DOM helpers
     * ======================================================================= */

    /**
     * True when `target` is the composer's editable surface for the active
     * session. DSH 0.1.2-alpha.1 replaced the old `<textarea>` with a Lexical
     * `contenteditable` host (`data-composer-input`, `role="textbox"`) inside
     * the composer card. Detect that host: it must be attachable, editable,
     * in the card, and the element (or its focus target) must be focused.
     */
    function isComposerInput(target) {
      if (!(target instanceof Element)) return false
      var host = target.closest(SEL.composerInput)
      if (host === null) return false
      if (host.closest(SEL.composerCard) === null) return false
      var editable = host.getAttribute('contenteditable')
      if (editable !== 'true' && editable !== '') return false
      return host === document.activeElement || target === document.activeElement
    }

    /**
     * True while the composer's candidate menu (slash command / skill /
     * subagent picker) is open for the composer card owning `target`. The
     * official menu is a `role="listbox"` overlay whose Enter handling is
     * arbitrated by the composer — we must NOT swallow Enter while it is
     * open, or pressing Enter to confirm a pick would be blocked by the lock
     * guard.
     *
     * Scoped to `target`'s own composer card (not the first listbox anywhere
     * on the page) so that one session's open menu never releases Enter for a
     * different session's composer.
     */
    function isSuggestionMenuOpen(target) {
      if (typeof document === 'undefined' || !(target instanceof Element)) return false
      var card = target.closest(SEL.composerCard)
      if (card === null) return false
      var box = card.querySelector(SEL.suggestionMenu)
      if (box === null) return false
      // Must be visibly attached (the closed menu renders null, so any
      // listbox in the DOM is an open one).
      return box.isConnected && box.offsetParent !== null
    }

    /** Resolve the session id owned by the composer card containing target. */
    function sessionIdFromTarget(target) {
      if (!(target instanceof Element)) return undefined
      var card = target.closest(SEL.composerCard)
      if (card === null) return undefined
      var toggle = card.querySelector('[data-dsh-input-enhancer]')
      if (toggle === null) return undefined
      return toggle.getAttribute('data-dsh-input-enhancer-session')
    }

    /* =========================================================================
     * Feature: character count (independent of the lock)
     *
     * Reads the live draft through the official `useInput` store hoook (a
     * standard prop of `conversation.input.right`) and renders a badge with
     * the total character count. It shows whenever the draft is non-empty,
     * whether or not the composer is locked.
     * ======================================================================= */

    function CharCountBadge(props) {
      var useInput = props.useInput
      var t = props.t
      var input = useInput
        ? useInput(function (s) { return s })
        : undefined
      var draft = input && typeof input.draft === 'string' ? input.draft : ''
      if (draft.length === 0) return null
      var isLong = draft.length >= LONG_TEXT_THRESHOLD
      return React.createElement('span', {
        'data-dsh-char-count': '',
        'data-dsh-long-text': isLong ? '' : undefined,
        title: isLong
          ? t('longTextHint', { count: draft.length })
          : t('charCountHint', { count: draft.length }),
      }, isLong
        ? '\u26A0 ' + draft.length
        : String(draft.length))
    }

    /* =========================================================================
     * Feature: composer lock (Enter guard + triple-tap unlock&send)
     *
     * Self-contained: it owns its per-session lock store, the triple-tap
     * gesture timing state, and the live `inputActions` reference needed to
     * submit on the third tap. Everything below is private to this feature;
     * `apply()` only calls `createLockFeature()` and mounts its effects.
     * ======================================================================= */

    function createLockFeature() {
      // Per-session lock flags + the triple-tap gesture count live in one
      // store because the tap gesture is *part of* the lock's escape hatch.
      // `burstUntil` marks the brief "unlock explosion" window after the 3rd
      // tap, during which the lock icon shows the burst animation.
      var store = tinyStore({ sessions: {}, tapCount: 0, burstUntil: 0, prevLen: {} })
      var tapTimer = null
      var burstTimer = null
      var inputActionsRef = null

      function isLocked(sessionId) {
        return store.getSnapshot().sessions[sessionId] === true
      }

      function resetTap() {
        if (tapTimer !== null) clearTimeout(tapTimer)
        tapTimer = null
        if (store.getSnapshot().tapCount !== 0) {
          store.set(function (s) { return Object.assign({}, s, { tapCount: 0 }) })
        }
      }

      /** Fire the brief unlock-burst window after the 3rd tap completes. */
      function triggerBurst() {
        if (burstTimer !== null) clearTimeout(burstTimer)
        store.set(function (s) { return Object.assign({}, s, { burstUntil: Date.now() + BURST_MS }) })
        burstTimer = setTimeout(function () {
          burstTimer = null
          if (store.getSnapshot().burstUntil !== 0) {
            store.set(function (s) { return Object.assign({}, s, { burstUntil: 0 }) })
          }
        }, BURST_MS)
      }

      function toggle(sessionId) {
        store.set(function (s) {
          var next = Object.assign({}, s.sessions)
          if (s.sessions[sessionId] === true) delete next[sessionId]
          else next[sessionId] = true
          return Object.assign({}, s, { sessions: next })
        })
      }

      /**
       * Force the session to the locked state (used by auto-lock on the
       * upward length edge). A no-op when already locked.
       */
      function lock(sessionId) {
        if (isLocked(sessionId)) return
        store.set(function (s) {
          var next = Object.assign({}, s.sessions)
          next[sessionId] = true
          return Object.assign({}, s, { sessions: next })
        })
      }

      /**
       * Force the session to the unlocked state (used by auto-unlock when the
       * draft empties). A no-op when already unlocked.
       */
      function unlock(sessionId) {
        if (!isLocked(sessionId)) return
        store.set(function (s) {
          var next = Object.assign({}, s.sessions)
          delete next[sessionId]
          return Object.assign({}, s, { sessions: next })
        })
      }

      /**
       * Record the latest draft length per session and react to the two
       * length edges: the rising edge past AUTO_LOCK_THRESHOLD locks, and the
       * falling edge to zero (draft cleared) unlocks. `prevLen` is tracked per
       * session so switching conversations never leaks an edge flag. The lock
       * has no source distinction — these edges simply add/remove it.
       */
      function autoSyncLockOnLength(sessionId, nextLen) {
        if (!AUTO_LOCK_ENABLED || sessionId === undefined) return
        var prev = typeof store.getSnapshot().prevLen[sessionId] === 'number'
          ? store.getSnapshot().prevLen[sessionId]
          : 0
        if (shouldAutoLock(prev, nextLen, AUTO_LOCK_THRESHOLD)) {
          lock(sessionId)
        } else if (shouldAutoUnlock(prev, nextLen)) {
          unlock(sessionId)
        }
        store.set(function (s) {
          var next = Object.assign({}, s.prevLen)
          next[sessionId] = nextLen
          return Object.assign({}, s, { prevLen: next })
        })
      }

      /**
       * Record one Enter tap while locked. Returns true when this tap
       * completes the triple-tap gesture (unlock + send already dispatched),
       * false otherwise.
       */
      function onLockedEnterTap(sessionId) {
        var result = advanceTripleTap(store.getSnapshot().tapCount)
        var count = result.tapCount
        if (result.complete) {
          var nextSessions = Object.assign({}, store.getSnapshot().sessions)
          delete nextSessions[sessionId]
          store.set(function (s) { return Object.assign({}, s, { sessions: nextSessions, tapCount: 0 }) })
          if (tapTimer !== null) clearTimeout(tapTimer)
          tapTimer = null
          // Fire the unlock-burst visual, then submit.
          triggerBurst()
          if (typeof inputActionsRef === 'function') inputActionsRef()
          return true
        }
        store.set(function (s) { return Object.assign({}, s, { tapCount: count }) })
        if (tapTimer !== null) clearTimeout(tapTimer)
        tapTimer = setTimeout(resetTap, TRIPLE_TAP_WINDOW_MS)
        return false
      }

      function cancelTap() { resetTap() }

      function setInputActions(fn) { inputActionsRef = fn }

      function LockButton(props) {
        var sessionId = props.sessionId
        var inputActions = props.inputActions
        var useInput = props.useInput
        var t = props.t
        // Continuously-tracked viewport center of the lock button. Updated in
        // the button ref callback (which runs against the real DOM element),
        // so the value is always the button's latest on-screen position —
        // including the pre-shrink position on the 3rd tap's burst.
        var lastAnchorRef = React.useRef(null)
        var buttonRef = React.useRef(null)
        var snapshot = useStoreSnapshot(store)
        var locked = sessionId !== undefined && snapshot.sessions[sessionId] === true
        var label = locked ? t('unlockLabel') : t('lockLabel')
        var hint = locked ? t('lockedHint') : t('unlockedHint')
        // Graded tap feedback: 1 and 2 are rendered as digits replacing the
        // lock; the 3rd tap triggers the unlock burst.
        var tapping = snapshot.tapCount === 1 || snapshot.tapCount === 2
          ? snapshot.tapCount
          : 0
        var bursting = snapshot.burstUntil > 0
        var input = useInput ? useInput(function (s) { return s }) : undefined
        var draftLen = input && typeof input.draft === 'string' ? input.draft.length : 0

        function trackAnchor(el) {
          if (el) {
            var r = el.getBoundingClientRect()
            lastAnchorRef.current = {
              x: r.left + r.width / 2,
              y: r.top + r.height / 2,
            }
          }
        }
        // Expose the current session's submit so the keyboard handler can send
        // on the third Enter tap (the keyboard effect has no slot props).
        React.useEffect(function () {
          setInputActions(inputActions && typeof inputActions.submit === 'function'
            ? function () { inputActions.submit() }
            : function () {})
          return function () { setInputActions(null) }
        }, [inputActions])

        // Auto lock/unlock on the two length edges. Reads the live draft
        // through the official `useInput` store (same source as the char-count
        // badge) so every input path — typing, paste, drop, IME commit, undo —
        // is observed, not just keydown. The rising edge past the threshold
        // locks; clearing the draft back to empty unlocks. Shrinking to a
        // non-zero length leaves the lock untouched.
        React.useEffect(function () {
          if (!AUTO_LOCK_ENABLED || sessionId === undefined) return
          autoSyncLockOnLength(sessionId, draftLen)
        }, [sessionId, draftLen])

        var content = tapping > 0
          ? String(tapping)
          : React.createElement(LockIcon, { locked: locked })

        var button = React.createElement('button', {
          type: 'button',
          ref: function (el) {
            buttonRef.current = el
            if (el) {
              var rr = el.getBoundingClientRect()
              lastAnchorRef.current = {
                x: rr.left + rr.width / 2,
                y: rr.top + rr.height / 2,
              }
            }
          },
          'data-dsh-input-enhancer': '',
          'data-dsh-input-enhancer-session': sessionId,
          'aria-pressed': locked,
          'data-dsh-tap-flash': tapping > 0 ? String(tapping) : undefined,
          'aria-label': label,
          title: hint,
          onMouseDown: function (event) {
            // Keep focus in the composer input, matching DSH tool-row buttons.
            event.preventDefault()
          },
          onClick: function () {
            if (sessionId !== undefined) {
              toggle(sessionId)
              cancelTap()
            }
          },
        }, content)

        // Mount the firework onto document.body when the third tap starts,
        // anchored at the lock button's last recorded center.
        React.useEffect(function () {
          if (!bursting) return
          var anchor = lastAnchorRef.current || { x: 0, y: 0 }
          return mountFirework(anchor)
        }, [bursting])

        return button
      }


      function onKeyDown(event) {
        // Lock shortcut: Ctrl/Cmd+Alt+L toggles the current session's lock.
        if (SHORTCUT_ENABLED && isLockShortcut(event)) {
          if (event.isComposing || event.keyCode === 229) return
          var shortcutSessionId = sessionIdFromTarget(event.target)
          if (shortcutSessionId === null || shortcutSessionId === undefined) return
          event.preventDefault()
          event.stopImmediatePropagation()
          toggle(shortcutSessionId)
          return
        }

        if (event.key !== 'Enter') {
          // Any non-Enter key aborts an in-progress triple-tap gesture.
          if (!event.isComposing && event.keyCode !== 229 && isComposerInput(event.target)) {
            var anySessionId = sessionIdFromTarget(event.target)
            if (anySessionId !== null && anySessionId !== undefined) cancelTap()
          }
          return
        }
        // Shift+Enter is already a native newline in the official composer
        // and never sends, so leave it untouched (and don't count it).
        if (event.shiftKey) return
        // Never fight an IME: candidate confirmation belongs to the input
        // method, not to this guard.
        if (event.isComposing || event.keyCode === 229) return
        // When the slash/skill/subagent candidate menu is open, Enter belongs
        // to the menu's own arbitration (confirm a pick) — never intercept it
        // here, or selecting a command/skill becomes impossible while locked.
        if (isSuggestionMenuOpen(event.target)) return
        if (!isComposerInput(event.target)) return
        var sessionId = sessionIdFromTarget(event.target)
        if (sessionId === null || sessionId === undefined || !isLocked(sessionId)) return
        event.preventDefault()
        // stopImmediatePropagation keeps the event from reaching the React
        // root's delegated composer onKeyDown, which would otherwise submit.
        event.stopImmediatePropagation()
        // First two taps have no side effect (still swallowed) but advance
        // the counter; the third tap unlocks and submits.
        onLockedEnterTap(sessionId)
      }

      return {
        LockButton: LockButton,
        store: store,
        mountEffects: function (ctx) {
          // Keyboard capture for the Enter guard + triple-tap gesture.
          ctx.effect(function () {
            document.addEventListener('keydown', onKeyDown, true)
            return function () {
              document.removeEventListener('keydown', onKeyDown, true)
            }
          }, 'dsh-input-enhancer: capture composer keyboard')
        },
      }
    }

    /* =========================================================================
     * Feature: draft slot (stage/restore the composer draft)
     *
     * One per-session slot. One button, two states, decided by occupancy:
     *   - slot EMPTY  -> "stage": move the current draft into the slot, clear
     *                    the composer (so you can type something else).
     *   - slot FULL   -> "restore": overwrite the composer with the staged
     *                    draft and clear the slot.
     * The same behavior is bound to Cmd+Opt+K. Memory-only, per session, never
     * persisted — the slot dies with the app, exactly as designed.
     * ======================================================================= */

    function isStageShortcut(event) {
      if (event.repeat) return false
      if (event.shiftKey) return false
      if (event.altKey !== true) return false
      if (event.ctrlKey === true || event.metaKey === true) {
        // Cmd/Ctrl+Opt+K
        var key = event.key || ''
        var code = event.code || ''
        return code === 'KeyK' || key.toLowerCase() === 'k'
      }
      return false
    }

    function createStageFeature() {
      // Per-session staged draft: sessions[sessionId] = string | undefined
      // (undefined = empty slot). Never persisted.
      var store = tinyStore({ sessions: {} })
      var inputActionsRef = null
      var draftReaderRef = null

      function stagedText(sessionId) {
        var value = store.getSnapshot().sessions[sessionId]
        return typeof value === 'string' ? value : ''
      }

      function setStaged(sessionId, text) {
        store.set(function (s) {
          var next = Object.assign({}, s.sessions)
          if (text === '' || text === undefined) delete next[sessionId]
          else next[sessionId] = text
          return Object.assign({}, s, { sessions: next })
        })
      }

      /**
       * The single toggle: stage when empty, restore when full. Returns true
       * when the composer focus should be preserved (always true — the button
       * and the key both keep focus in the composer input).
       */
      function toggle(sessionId, draft) {
        var currentDraft = typeof draft === 'string' ? draft : ''
        var staged = stagedText(sessionId)
        // This is a SWAP, not a directed store/restore: the slot and the
        // composer always exchange their contents atomically, decided by the
        // pure `swapResult` core.
        var next = swapResult(staged, currentDraft)
        if (inputActionsRef && typeof inputActionsRef.setDraft === 'function') {
          inputActionsRef.setDraft(next.draft)
        }
        setStaged(sessionId, next.staged)
      }

      function setInputActions(actions) {
        inputActionsRef = actions && typeof actions.setDraft === 'function'
          ? actions
          : inputActionsRef
      }

      function setDraftReader(fn) { draftReaderRef = fn }

      function StageButton(props) {
        var sessionId = props.sessionId
        var inputActions = props.inputActions
        var useInput = props.useInput
        var t = props.t
        var snapshot = useStoreSnapshot(store)
        var input = useInput ? useInput(function (s) { return s }) : undefined
        var draft = input && typeof input.draft === 'string' ? input.draft : ''

        var staged = sessionId !== undefined ? snapshot.sessions[sessionId] : undefined
        var hasStaged = typeof staged === 'string' && staged !== ''
        var hasDraft = draft !== ''

        var label = t('swapLabel')
        var hint = hasStaged ? t('swapFilledHint') : t('swapHint')

        // Expose the current session's setDraft so the keyboard handler can
        // stage/restore without slot props (same pattern as the lock submit).
        React.useEffect(function () {
          setInputActions(inputActions || null)
          return function () {
            if (inputActionsRef === inputActions) inputActionsRef = null
          }
        }, [inputActions])

        // Expose the live draft so the capture-phase keydown handler (which
        // has no hook) reads the composer's current text for the stage swap.
        // Re-runs on every draft change so the reader is always the latest.
        React.useEffect(function () {
          setDraftReader(function () { return draft })
          return function () { draftReaderRef = null }
        }, [draft])

        return React.createElement('button', {
          type: 'button',
          'data-dsh-stage': '',
          'data-dsh-stage-session': sessionId,
          'data-dsh-stage-filled': hasStaged ? '' : undefined,
          'aria-pressed': hasStaged,
          'aria-label': label,
          title: hint,
          disabled: !hasStaged && !hasDraft,
          onMouseDown: function (event) {
            // Keep focus in the composer input, matching DSH tool-row buttons.
            event.preventDefault()
          },
          onClick: function () {
            if (sessionId !== undefined) toggle(sessionId, draft)
          },
        }, React.createElement(StageIcon))
      }

      function onKeyDown(event) {
        if (!STAGE_SHORTCUT_ENABLED || !isStageShortcut(event)) return
        if (event.isComposing || event.keyCode === 229) return
        // Only act while the composer input is focused.
        if (!isComposerInput(event.target)) return
        var sessionId = sessionIdFromTarget(event.target)
        if (sessionId === null || sessionId === undefined) return
        event.preventDefault()
        event.stopImmediatePropagation()
        // Read the live draft from the input store: the key path has no hook,
        // so the mounted StageButton exposes the current draft through a
        // feature-level reader (the button path uses useInput directly).
        var draft = typeof draftReaderRef === 'function' ? draftReaderRef() : ''
        toggle(sessionId, draft)
      }

      return {
        StageButton: StageButton,
        store: store,
        mountEffects: function (ctx) {
          ctx.effect(function () {
            document.addEventListener('keydown', onKeyDown, true)
            return function () {
              document.removeEventListener('keydown', onKeyDown, true)
            }
          }, 'dsh-input-enhancer: capture composer stage keyboard')
        },
      }
    }

    /* =========================================================================
     * Default shortcut matcher: Ctrl/Cmd+Alt+L. Toggles the lock on the
     * focused composer session.
     * ======================================================================= */
    function isLockShortcut(event) {
      if (event.repeat) return false
      var key = event.key || ''
      var isL = event.code === 'KeyL' || key.toLowerCase() === 'l'
      if (!isL) return false
      if (event.shiftKey) return false
      if (event.altKey !== true) return false
      return event.ctrlKey === true || event.metaKey === true
    }

    /* =========================================================================
     * Styles: one adopted <style> owns every feature's rules, partitioned by
     * comment. Each feature contributes its own selectors, keyed off its own
     * data-* attributes so they never collide.
     * ======================================================================= */

    function adoptStyles() {
      if (typeof document === 'undefined') return function () {}
      if (document.getElementById(STYLE_ID) !== null) {
        return function () {}
      }
      var style = document.createElement('style')
      style.id = STYLE_ID
      style.setAttribute('data-plugin', NS)
      style.textContent = [
        // ---- lock button --------------------------------------------------
        '[data-dsh-input-enhancer]{',
        'box-sizing:border-box;width:28px;height:28px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:50%;',
        'display:inline-flex;align-items:center;justify-content:center;flex:none;cursor:pointer;',
        'color:var(--dsw-alias-label-secondary);background:transparent;',
        '}',
        '[data-dsh-input-enhancer]:hover{',
        'color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);',
        '}',
        '[data-dsh-input-enhancer][aria-pressed="true"]{',
        'color:#fff;',
        'background:var(--dsw-alias-state-error-primary);',
        'border:1px solid var(--dsw-alias-state-error-primary);',
        '}',
        '[data-dsh-input-enhancer][aria-pressed="true"]:hover{',
        'color:#fff;',
        'background:var(--dsw-alias-state-error-secondary);',
        'border:1px solid var(--dsw-alias-state-error-secondary);',
        '}',
        '[data-dsh-input-enhancer]:focus-visible{',
        'outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;',
        '}',
        // Graded flash pulse on each Enter tap: tap 1 is a gentle pulse,
        // tap 2 is a larger pulse with a stronger halo, hinting "one more to
        // unlock and send". During taps the lock icon is replaced by the
        // count digit ("1" / "2").
        '[data-dsh-input-enhancer][data-dsh-tap-flash]{',
        'font-size:13px;font-weight:600;',
        '}',
        '[data-dsh-input-enhancer][data-dsh-tap-flash="1"]{',
        'animation:dsh-enter-tap-flash-1 .35s ease-in-out;',
        'box-shadow:0 0 0 2px var(--dsw-alias-state-warning-primary);',
        '}',
        '[data-dsh-input-enhancer][data-dsh-tap-flash="2"]{',
        'animation:dsh-enter-tap-flash-2 .35s ease-in-out;',
        'box-shadow:0 0 0 4px var(--dsw-alias-state-warning-primary);',
        '}',
        '@keyframes dsh-enter-tap-flash-1{',
        '0%{transform:scale(1)}50%{transform:scale(1.15)}100%{transform:scale(1)}',
        '}',
        '@keyframes dsh-enter-tap-flash-2{',
        '0%{transform:scale(1)}50%{transform:scale(1.3)}100%{transform:scale(1)}',
        '}',
        // Unlock firework (3rd tap): a 1s firework bursts from the lock
        // button's center. It is a fixed overlay so particles escape the
        // 28px button bounds; each particle flies outward (--dsh-fw-dx/dy),
        // falls with slight drift, and fades. The button itself also does a
        // quick snap-back while the firework plays.
        '[data-dsh-firework]{',
        'position:fixed;transform:translate(-50%,-50%);pointer-events:none;z-index:9999;',
        'width:0;height:0;',
        '}',
        // Central flash: a bright ball that swells and fades at the origin.
        '.dsh-firework-core{',
        'position:absolute;left:0;top:0;transform:translate(-50%,-50%);',
        'width:34px;height:34px;border-radius:50%;',
        'background:radial-gradient(circle,#fff 0%,#ffd166 40%,rgba(255,209,102,0) 70%);',
        'animation:dsh-firework-core 1s ease-out forwards;',
        '}',
        '.dsh-firework-flash{',
        'position:absolute;left:0;top:0;transform:translate(-50%,-50%);',
        'width:8px;height:8px;border-radius:50%;background:#fff;',
        'box-shadow:0 0 18px 6px rgba(255,255,255,.9);',
        'animation:dsh-firework-flash .5s ease-out forwards;',
        '}',
        '.dsh-firework-particle{',
        'position:absolute;left:0;top:0;',
        'width:var(--dsh-fw-size,8px);height:var(--dsh-fw-size,8px);border-radius:50%;',
        'background:var(--dsh-fw-color,#ffd166);',
        'box-shadow:0 0 8px 2px var(--dsh-fw-color,#ffd166);',
        'animation:dsh-firework-fly 1s ease-out forwards;',
        '}',
        '@keyframes dsh-firework-core{',
        '0%{transform:translate(-50%,-50%) scale(.4);opacity:1}',
        '40%{transform:translate(-50%,-50%) scale(1.4);opacity:.9}',
        '100%{transform:translate(-50%,-50%) scale(2.2);opacity:0}',
        '}',
        '@keyframes dsh-firework-flash{',
        '0%{transform:translate(-50%,-50%) scale(.6);opacity:1}',
        '100%{transform:translate(-50%,-50%) scale(2.4);opacity:0}',
        '}',
        '@keyframes dsh-firework-fly{',
        '0%{transform:translate(0,0) scale(1);opacity:1}',
        '30%{opacity:1}',
        '100%{transform:translate(var(--dsh-fw-dx),var(--dsh-fw-dy)) scale(.4);opacity:0}',
        '}',
        // ---- character count badge ----------------------------------------
        '[data-dsh-char-count]{',
        'box-sizing:border-box;min-width:20px;height:20px;padding:0 6px;',
        'display:inline-flex;align-items:center;justify-content:center;flex:none;',
        'border-radius:10px;font-size:12px;line-height:20px;',
        'color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);',
        '}',
        // Long-text warning: the same badge turns amber once the draft reaches
        // the threshold, as a persistent pre-send hint.
        '[data-dsh-char-count][data-dsh-long-text]{',
        'color:var(--dsw-alias-state-warn-label);',
        'background:var(--dsw-alias-state-warn-tertiary);',
        '}',
        // ---- draft slot (stage/restore) ----------------------------------
        '[data-dsh-stage]{',
        'box-sizing:border-box;width:28px;height:28px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:50%;',
        'display:inline-flex;align-items:center;justify-content:center;flex:none;cursor:pointer;',
        'color:var(--dsw-alias-label-secondary);background:transparent;',
        '}',
        '[data-dsh-stage]:hover:not(:disabled){',
        'color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);',
        '}',
        '[data-dsh-stage]:disabled{',
        'cursor:default;opacity:.45;',
        '}',
        // Filled (staged draft waiting): highlight so the slot is visible at a
        // glance — this is the "you have something to restore" cue.
        '[data-dsh-stage][data-dsh-stage-filled]{',
        'color:#fff;',
        'background:var(--dsw-alias-state-business-primary);',
        'border:1px solid var(--dsw-alias-state-business-primary);',
        '}',
        '[data-dsh-stage][data-dsh-stage-filled]:hover{',
        'color:#fff;',
        'background:var(--dsw-alias-state-business-secondary);',
        'border:1px solid var(--dsw-alias-state-business-secondary);',
        '}',
        '[data-dsh-stage]:focus-visible{',
        'outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;',
        '}',
      ].join('')
      document.head.appendChild(style)
      return function () { style.remove() }
    }

    /* =========================================================================
     * Plugin entry: thin orchestration only.
     * ======================================================================= */

    var inject = ['slots', 'locale']

    function apply(ctx) {
      var lockFeature = createLockFeature()
      var stageFeature = createStageFeature()

      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en })
      }, 'dsh-input-enhancer: dictionaries')

      ctx.effect(function () {
        return adoptStyles()
      }, 'dsh-input-enhancer: styles')

      lockFeature.mountEffects(ctx)
      stageFeature.mountEffects(ctx)

      // Draft-slot button (order 10) then lock button (order 20) then
      // char-count badge (order 30), all in the `conversation.input.right` slot.
      ctx.slots.inject('conversation.input.right', function () {
        return ctx.slots.register({
          name: 'conversation.input.right',
          id: 'dsh-input-enhancer-stage',
          order: 10,
          locale: NS,
          inject: function (sessionId) {
            return { sessionId: sessionId }
          },
        }, stageFeature.StageButton)
      })

      ctx.slots.inject('conversation.input.right', function () {
        return ctx.slots.register({
          name: 'conversation.input.right',
          id: 'dsh-input-enhancer',
          order: 20,
          locale: NS,
          inject: function (sessionId) {
            return { sessionId: sessionId }
          },
        }, lockFeature.LockButton)
      })

      ctx.slots.inject('conversation.input.right', function () {
        return ctx.slots.register({
          name: 'conversation.input.right',
          id: 'dsh-input-enhancer-char-count',
          order: 30,
          locale: NS,
          inject: function () {
            return {}
          },
        }, CharCountBadge)
      })
    }

    module.exports = { name: 'dsh-input-enhancer', inject: inject, apply: apply }
    return module.exports
  },
})
