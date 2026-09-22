#!/usr/bin/env python3
"""E2E test for dsh-response-window against a running `dsh web` instance.

Usage:
    uv run --with playwright python3 test/e2e.py [--url http://127.0.0.1:3639] \
        [--session "修复 dsh 升级后的插件不兼容"]

Requires: python3 + playwright (chromium). Assumes a session with tool calls
(and ideally some reasoning/think blocks).

Asserts the DSH 0.1.7-alpha.1 contract, i.e. the regressions this file exists
to catch:
  * the client half ACTIVATES at all (a missing inject service parks it and
    renders zero slides),
  * per-turn slides render bounded + scrollable,
  * think rows are one line each and expand on click,
  * native Think rows are hidden wherever the segment has a slide — including
    inside the process-group containers 0.1.7 nests flow rows in,
  * the two Settings -> General rows mount and are wired,
  * switching sessions does not crash (rows are never reparented).
"""
import argparse, json, sys

from playwright.sync_api import sync_playwright

# Native Think rows are hidden by the plugin; a visible one whose segment owns
# a slide would be a duplicate of that slide's own Think row. Flow rows are read
# in document order because 0.1.7 nests them inside process-group containers.
NATIVE_DUPLICATE_PROBE = """() => {
  const rows = Array.from(document.querySelectorAll('[data-chat-flow-kind]'));
  const keyOf = (n) => n.getAttribute('data-chat-flow-key');
  const boundary = (n) => {
    const kind = n.getAttribute('data-chat-flow-kind');
    return kind === 'user' || kind === 'steering' || kind === 'turn-tail' || kind === 'turn-process';
  };
  const inSlideSegment = (i) => {
    for (let j = i - 1; j >= 0; j--) {
      if (boundary(rows[j])) break;
      if (rows[j].querySelector('.drw-slide')) return true;
    }
    for (let k = i + 1; k < rows.length; k++) {
      if (boundary(rows[k])) break;
      if (rows[k].querySelector('.drw-slide')) return true;
    }
    return false;
  };
  const visible = [];
  rows.forEach((row, i) => {
    const own = row.matches('[data-variant="think"]')
      ? row
      : row.querySelector('[data-variant="think"]:not([data-drw-hidethink])');
    if (own && inSlideSegment(i)) visible.push(keyOf(row));
  });
  return visible;
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:3639")
    ap.add_argument("--session", default="修复 dsh 升级后的插件不兼容")
    ap.add_argument("--workspace", default="dsh-newbe-plugins",
                    help="workspace node to expand when the session list hides the session")
    ap.add_argument("--channel", default=None,
                    help="use an installed browser instead of the bundled one, e.g. 'chrome'")
    args = ap.parse_args()

    errors = []
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, channel=args.channel, args=["--no-sandbox"])
        pg = b.new_page(viewport={"width": 1440, "height": 900})
        pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        # Console noise from unrelated profile plugins (e.g. their own API
        # endpoints 404ing) must not fail this plugin's run; only record
        # console errors that concern this plugin or are not resource-404s.
        def on_console(m):
            if m.type != "error":
                return
            text = m.text or ""
            if "Failed to load resource" in text and "response-window" not in text:
                return
            errors.append("console: " + text)
        pg.on("console", on_console)
        pg.goto(args.url, wait_until="domcontentloaded", timeout=30000)
        pg.wait_for_timeout(3500)

        def open_session(title):
            probe = """(t) => {
                const el = Array.from(document.querySelectorAll('[role=treeitem]'))
                  .find(e => (e.innerText||'').includes(t));
                if (el) { el.click(); return true; }
                return false;
            }"""
            if pg.evaluate(probe, title):
                return True
            # The session sits under its workspace node; that node is collapsed
            # unless that workspace is the active one. Clicking through the page
            # goes through plain .click() because the first-run notice mounts a
            # pointer-blocking mask.
            pg.evaluate("""(w) => {
                const el = Array.from(document.querySelectorAll('[role=treeitem]'))
                  .find(e => (e.innerText||'').trim().startsWith(w));
                if (el) el.click();
            }""", args.workspace)
            pg.wait_for_timeout(1500)
            # history beyond the newest few hides behind "展开其余 N 个会话"
            pg.evaluate("""() => {
                const more = Array.from(document.querySelectorAll('button,div'))
                  .find(e => (e.innerText||'').trim().startsWith('展开其余'));
                if (more) more.click();
            }""")
            pg.wait_for_timeout(800)
            return pg.evaluate(probe, title)

        if not open_session(args.session):
            sys.exit("session not found: " + args.session)
        pg.wait_for_timeout(4500)

        info = pg.evaluate("""() => {
          const thinks = Array.from(document.querySelectorAll('.drw-think'));
          return {
            slides: document.querySelectorAll('.drw-slide').length,
            heads: Array.from(document.querySelectorAll('.drw-slide .drw-head-title')).map(e=>e.textContent),
            bounded: Array.from(document.querySelectorAll('.drw-slide .drw-body')).every(bb => {
              const cs = getComputedStyle(bb);
              return bb.style.maxHeight !== '' && cs.overflowY === 'auto';
            }),
            calls: document.querySelectorAll('.drw-call').length,
            thinks: thinks.length,
            thinkExpanded: thinks.filter(t => t.getAttribute('data-open') === '1').length,
            nativeThinkVisible: document.querySelectorAll('[data-variant="think"]:not([data-drw-hidethink])').length,
            nativeThinkHidden: document.querySelectorAll('[data-variant="think"][data-drw-hidethink="1"]').length,
            dock: document.querySelectorAll('[data-drw-dock]').length,
            slotErrors: Array.from(document.querySelectorAll('[data-slot-error]'))
              .map(e => e.getAttribute('data-slot-error')),
          };
        }""")
        # Activating the client half is the regression this test guards: a
        # declared-but-unprovided inject service parks the plugin with zero
        # slides and a "waiting for service" boot error.
        assert info["slides"] >= 1, "no slides rendered (client half did not activate?)"
        assert info["bounded"], "not all tool-slide bodies are bounded"
        # The session dock is this plugin's own entry; the crash placeholder is
        # per slot, not per entry, so other profile plugins sharing
        # conversation.input.dock can legitimately own one (the web profile does
        # on 0.1.7-alpha.1, with this plugin disabled too) — report, don't fail.
        assert info["dock"] == 1, "the session dock entry did not mount (no [data-drw-dock])"
        if info["slotErrors"]:
            print("WARN other slot entries crashed:", info["slotErrors"])

        # With per-response segmentation each segment is usually short and fits
        # without scrolling, so prove the mechanism directly: clamp bodies to a
        # tiny height (DOM-only, nothing persisted) and require a real overflow
        # -> the bounded window genuinely scrolls.
        pg.evaluate("() => { const bs = Array.from(document.querySelectorAll('.drw-slide .drw-body')); bs.forEach(b => { b.style.maxHeight = '40px'; }); }")
        pg.wait_for_timeout(250)
        scrollable = pg.evaluate("Array.from(document.querySelectorAll('.drw-slide .drw-body')).some(bb => bb.scrollHeight > bb.clientHeight)")
        assert scrollable, "no bounded body overflows once clamped (check session has content)"

        duplicates = pg.evaluate(NATIVE_DUPLICATE_PROBE)
        assert duplicates == [], "native Think rows still visible in slide segments: %s" % duplicates
        if info["thinks"]:
            assert info["thinkExpanded"] == 0, "think rows should be collapsed by default (one line each)"
        print("PASS slides:", info["slides"], "heads:", json.dumps(info["heads"], ensure_ascii=False),
              "calls:", info["calls"], "thinks:", info["thinks"],
              "(native hidden:", info["nativeThinkHidden"], "/ visible:", info["nativeThinkVisible"], ")")

        # a think row is a single collapsed line and expands on click
        if info["thinks"]:
            h0 = pg.evaluate("Math.round(document.querySelector('.drw-think').getBoundingClientRect().height)")
            assert h0 <= 44, "think row is not single-line (height %s px)" % h0
            pg.evaluate("document.querySelector('.drw-think .drw-think-head').click()")
            pg.wait_for_timeout(250)
            expanded = pg.evaluate("""() => {
                const t = document.querySelector('.drw-think');
                return t && t.getAttribute('data-open') === '1' && !!t.querySelector('.drw-think-body');
            }""")
            assert expanded, "think row did not expand on click"
            pg.evaluate("document.querySelector('.drw-think .drw-think-head').click()")

        # collapse/expand toggle
        before = pg.evaluate("document.querySelector('.drw-slide .drw-body').className")
        pg.evaluate("document.querySelector('.drw-slide .drw-head').click()")
        pg.wait_for_timeout(200)
        after = pg.evaluate("document.querySelector('.drw-slide .drw-body').className")
        assert "drw-collapsed" in after and "drw-collapsed" not in before, "collapse toggle failed"

        # Settings -> General rows (durable namespace migrated off settingsScope)
        opened = pg.evaluate("""() => {
            const el = Array.from(document.querySelectorAll('button')).find(e => (e.innerText||'').trim() === '设置');
            if (el) { el.click(); return true; }
            return false;
        }""")
        assert opened, "settings button not found"
        pg.wait_for_timeout(2000)
        rows = pg.evaluate("""() => Array.from(document.querySelectorAll('.drw-set-row')).map(r => ({
            title: (r.querySelector('.drw-set-title')||{}).textContent,
            control: (r.querySelector('.drw-set-control')||{}).innerText,
            input: (r.querySelector('.drw-set-input')||{}).value,
        }))""")
        assert len(rows) == 2, "expected 2 settings rows, got %s" % json.dumps(rows, ensure_ascii=False)
        assert rows[0]["title"] and rows[0]["title"].startswith("响应窗口大小"), "settings row 1 wrong: %s" % rows[0]
        assert rows[0]["input"] == "10", "settings row 1 did not show the durable/default value: %s" % rows[0]
        print("PASS settings rows:", json.dumps([r["title"] for r in rows], ensure_ascii=False))
        pg.evaluate("""() => {
            const el = Array.from(document.querySelectorAll('button')).find(e => (e.getAttribute('aria-label')||'').includes('关闭'));
            if (el) el.click();
        }""")
        pg.wait_for_timeout(500)

        # switch session and come back (crash-safety: rows are not reparented)
        switched = pg.evaluate("""() => {
            const el = Array.from(document.querySelectorAll('[role=treeitem],[role=button],button,div'))
              .find(e => (e.innerText||'').trim() === 'dsh-newbe-plugins');
            if (el) { el.click(); return true; } return false;
        }""")
        pg.wait_for_timeout(3500)
        if switched:
            open_session(args.session)
            pg.wait_for_timeout(3000)
        assert pg.evaluate("!!document.querySelector('[data-chat-flow]')"), "chat flow gone after switch"
        # Only errors naming this plugin are ours: a full profile's other
        # plugins can log their own (the web profile does on 0.1.7-alpha.1).
        ours = [e for e in errors if "dsh-newbe-response-window" in e]
        assert not ours, "errors about this plugin: " + "; ".join(ours[:5])
        print("PASS session-switch crash-safety")

        if errors:
            print("WARN other console/page errors:", "; ".join(errors[:8]))
        b.close()
    print("ALL PASS")


if __name__ == "__main__":
    main()
