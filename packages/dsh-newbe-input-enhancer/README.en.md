# dsh-input-enhancer

[中文](README.md) | English

A **DeepSeek Harness Web plugin** that makes the chat composer better suited to long-form editing.

## Features

| Feature | What it does | How |
| --- | --- | --- |
| 🔒 **Lock Enter-send** | While locked, Enter won't accidentally send; you can keep editing | Click the lock button / `Cmd/Ctrl+Alt+L` |
| ⚡ **Triple-Enter send** | Press Enter 3 times (≤800ms apart) to unlock and send immediately | Press Enter while locked |
| 🔢 **Character count** | A live character-count badge appears after the lock button while non-empty | Automatic |
| ⚠️ **Long-text warning** | Past 800 characters the badge turns amber, so the length is clear before sending | Automatic |
| 🔐 **Auto-lock / unlock** | Past 80 characters the composer auto-locks; clearing the composer auto-unlocks | Automatic |
| ⇄ **Draft swap** | Swap content between the composer and a staging slot, to park a half-finished draft for a later turn | Click the swap button / `Cmd/Ctrl+Opt+K` |

- **Lock button**: registered in the official `conversation.input.right` slot, near the send button; a prominent red fill when locked, with a state tooltip on hover. It can also be toggled with `Ctrl/Cmd+Alt+L` (only while the composer is focused).
- **Character count is independent**: it shows whenever the composer is non-empty, locked or not.
- **Long-text warning**: once the draft reaches the threshold (800 chars by default), the count badge turns amber with a "long text" hover hint.
- **Auto-lock / unlock**: on by default (source constants `AUTO_LOCK_ENABLED` / `AUTO_LOCK_THRESHOLD`). The composer locks the moment the length crosses from `≤80` up to `>80` (rising edge), and unlocks when the draft is fully cleared (length back to zero). The lock has no "manual vs automatic" source distinction — once it is on, it is on; the two length edges simply add and remove it. Shrinking to a non-empty length or hovering around 80 leaves the lock untouched, and after a clear-then-unlock, typing past 80 again re-locks. This `80`-lock is independent of the `800` warning above.
- **Per-session state**: each conversation keeps its own lock flag.

### Lock state & composer

| State | Lock icon | Composer | Enter behavior |
| --- | --- | --- | --- |
| Unlocked | Gray outlined | Default size | Sends normally |
| Locked | **Red fill + white lock icon** | Default size | Does not send (3× Enter unlocks and sends) |

Tooltip:

- Unlocked: `Unlocked: composer is normal size, Enter sends normally`
- Locked: `Locked: Enter will not send. Press Enter 3 times to unlock and send`

### Triple-Enter (locked-state escape hatch)

While locked, to send without first unlocking: **press Enter 3 times** to unlock and send immediately.

- The first two Enters have no side effect (no send, no newline); they only count. The lock icon turns into the current count (1st shows "1", 2nd shows "2") with a growing pulse.
- The 3rd Enter plays a **firework burst** (colored particles flying out from the lock button for ~1 second), then unlocks and sends the current content.
- Timeout, any other key, or a session switch resets the count.

> Triple-tap applies only while locked; an empty composer will not send.

### Draft swap (park a half-finished draft)

While the agent is still thinking or executing, you'll often want to type the next message in advance. But sometimes you realize mid-draft that this text should wait a few turns. Park it with a direction-agnostic swap button (⇄), keep writing and sending other things, and swap it back in the right turn.

- **Swap button**: registered in the `conversation.input.right` slot, just left of the lock button; the icon is ⇄ (opposing arrows, no direction bias). Clicking it swaps content between the composer and the staging slot.
- **Atomic swap semantics**:
  - Slot **empty** → the composer's text moves into the slot, and the composer empties;
  - Slot **full** → the two swap: the staged draft returns to the composer, and the composer's current text moves into the slot (neither side is lost);
  - When the slot is full the button is **highlighted**, so you can tell at a glance that a draft is parked.
- **Shortcut** `Cmd+Opt+K` (macOS) / `Ctrl+Alt+K` (Windows/Linux) is equivalent to clicking the swap button; it only acts while the composer is focused.
- **Per-session, in-memory only**: each conversation has its own single slot; it is cleared on refresh or restart — it only serves the temporary "park for a few turns" case, never crossing sessions or touching disk.

> When both the composer and the slot hold text, clicking swap will exchange them; use accordingly.

## Guarantees

- **No composer replacement**: intercepts only the keyboard submit path, keeping the official input state machine, command menu, queue, and attachments.
- **IME-friendly**: Enter during composition is never intercepted.
- Blocked while locked: plain `Enter`, `Ctrl+Enter` / `Cmd+Enter`, other Enter combos that reach the official submit path.
- Preserved: `Shift+Enter` newline, IME candidate confirmation, edit/copy/paste/attachments, and mouse-click send (the lock only guards the keyboard).

## Keyboard shortcut

**`Ctrl+Alt+L`** (Windows/Linux) or **`Cmd+Alt+L`** (macOS) toggles the current composer's lock without reaching for the lock button. It only acts while the composer is focused.

> Why not `Ctrl/Cmd+L`: Chrome / Edge reserve `Ctrl+L` and macOS reserves `Cmd+L` for the address bar, which intercepts them first; hence `Ctrl/Cmd+Alt+L`.

**`Ctrl+Alt+K`** (Windows/Linux) or **`Cmd+Opt+K`** (macOS) triggers the draft swap. It only acts while the composer is focused.

> Adjacent-shortcut note: `Cmd/Ctrl+Opt/Alt+K` (draft swap) and `Cmd/Ctrl+Opt/Alt+L` (lock) are adjacent, and Opt is Alt, so mis-presses are possible — if you hit the wrong one often, prefer the corresponding icon button.

## Requirements

- DeepSeek Harness `0.1.2-alpha.1` or newer (verified; `0.1.0-rc.6` also runs);
- the `web` profile;
- a modern Chromium-based browser (Chrome or Edge).

> This plugin works through DSH's internal DOM contract — `[data-composer-card]`,
> `[data-composer-input]`, `[role="listbox"]` etc. — collected in the `SEL` table
> at the top of `src/client.js`. DSH `0.1.2-alpha.1` replaced the composer
> `<textarea>` with a Lexical `contenteditable` host (`data-composer-input` /
> `role="textbox"`); the plugin has been adapted. After further DSH upgrades, if
> the lock / char-count / draft-slot / candidate-menu behavior misbehaves, run a
> regression against those features and check whether the `SEL` selectors still
> match the core.


## Installation

### Install from npm

```sh
dsh plugin --profile web add dsh-input-enhancer
```

For reproducible installs, pin to a specific version:

```sh
dsh plugin --profile web add 'dsh-input-enhancer@1.1.0'
```

### Install from this GitHub repository

```sh
dsh plugin --profile web add github:qiqiangvae/dsh-input-enhancer
```

Or use the explicit Git URL:

```sh
dsh plugin --profile web add https://github.com/qiqiangvae/dsh-input-enhancer.git
```

For reproducible installs, pin a commit:

```sh
dsh plugin --profile web add 'github:qiqiangvae/dsh-input-enhancer#<commit-sha>'
```

### Install from a local directory

```sh
git clone https://github.com/qiqiangvae/dsh-input-enhancer.git
dsh plugin --profile web add ./dsh-input-enhancer
```

### Verify

```sh
dsh --profile web --dump-config | grep dsh-input-enhancer
```

Then restart `dsh web` and refresh the page.

## Usage

1. Start DeepSeek Harness Web:

   ```sh
   dsh web
   ```

2. Find the lock button in the composer tool row, near the model selector and the send button.

3. Toggle the lock:

   - Click the lock button in the composer tool row;
   - or press `Ctrl+Alt+L` (Windows/Linux) / `Cmd+Alt+L` (macOS), which only acts while the composer is focused.

4. While locked:

   - Plain `Enter` does not send.
   - `Ctrl+Enter` / `Cmd+Enter` does not send.
   - `Shift+Enter` still inserts a newline.
   - IME composition Enter still confirms the candidate.
   - Clicking the official send button still sends; the lock only guards keyboard input.
   - Press **Enter 3 times** (within 800ms each) to unlock and send immediately (the lock icon shows "1"/"2" on the first two taps, then plays an unlock burst on the third).

5. Lock state is per session and is kept in memory only. It is cleared on refresh or restart.

6. The character count is independent of the lock: whenever the composer is non-empty (locked or not), a character-count badge appears right after the lock button.

7. Park a half-finished draft:

   - Click the swap button (⇄) left of the lock button, or press `Cmd+Opt+K` (macOS) / `Ctrl+Alt+K` (Windows/Linux);
   - When the slot is empty, the composer's draft moves into the slot and the composer empties;
   - When the slot is full, the two swap (the staged draft returns to the composer, the current input moves into the slot);
   - The slot is in-memory only and is cleared on refresh.

## Configuration

The plugin is zero-configuration. It requires no API key, no settings fields, and no `settings.yaml` entry. Lock state and the staging slot live in browser memory only.

## Limitations

- Lock state is browser-memory only; it does not write `settings.yaml` and makes no network requests.
- The staging slot is likewise browser-memory only (one slot per conversation); it is cleared on refresh/restart, never crosses sessions, and is never written to disk or sent over the network.
- The plugin uses the official `conversation.input.right` slot and does not replace the composer.
- Auto lock/unlock is driven only by the two length edges: crossing past 80 upward locks, clearing the composer to zero unlocks; any intermediate length leaves the lock state unchanged.

## Troubleshooting

### The lock button is not visible

1. Verify that the plugin is mounted:

   ```sh
   dsh --profile web --dump-config | grep dsh-input-enhancer
   ```

2. Restart `dsh web` and force-refresh the page (`Ctrl+F5`).
3. Make sure you are using the `web` profile.

### The shortcut is unavailable

1. Make sure the composer is focused (the shortcut only acts while it is).
2. Use `Ctrl+Alt+L` (Windows/Linux) or `Cmd+Alt+L` (macOS), not `Ctrl/Cmd+L` (reserved for the address bar).
3. Some Linux desktop environments bind `Ctrl+Alt+L` to a system action (lock screen / layout switch), which will intercept it; use the lock button instead.

### A message was sent while locked

- `Shift+Enter` inserts a newline; it is not a send.
- Clicking the official send button is a deliberate mouse action and is not blocked.
- Check that the lock button shows the red filled locked state and review which Enter combination was pressed.

## Uninstall

```sh
dsh plugin --profile web remove dsh-input-enhancer
```

## Development and build

No build step is required to install this repository: `lib/` contains committed prebuilt artifacts and the package has no `prepare` / `postinstall` scripts.

After changing the source, regenerate the artifacts with:

```sh
npm run build   # generate lib/index.js and lib/client.js
npm run check   # structural checks
```

## Project layout

```text
dsh-input-enhancer/
├── package.json          # dsh.bundle + dsh.client plugin manifest
├── cordis.patch.yml      # profile bundle patch
├── src/
│   ├── index.js          # Host half (dependency-free no-op)
│   └── client.js         # Web half: layered orchestration (lock feature + char count + long-text warning + draft swap)
├── lib/                  # prebuilt artifacts
├── scripts/
│   ├── build.mjs
│   └── check.mjs
├── README.md
├── README.en.md
└── LICENSE
```

## Migration from dsh-enter-lock

This plugin was renamed and enhanced from `dsh-enter-lock`. If you previously installed the old name, uninstall it first, then install this plugin:

```sh
dsh plugin --profile web remove dsh-enter-lock
dsh plugin --profile web add github:qiqiangvae/dsh-input-enhancer
```

Compared with `dsh-enter-lock`, this plugin adds:

- **Enlarge composer**: locking grows the composer for long-form editing;
- **Triple-Enter send**: press Enter 3 times to unlock and send immediately (with count flashes and an unlock-burst animation);
- **Character count**: a live character count, independent of the lock;
- **Long-text warning**: past 800 characters the badge turns amber;
- **Auto-lock / unlock**: past 80 characters the composer locks on the rising length edge, and clearing the composer unlocks it;
- **Draft swap**: a ⇄ swap button + `Cmd/Ctrl+Opt/Alt+K` to exchange half-finished drafts between the composer and a staging slot (one slot per conversation, in-memory).

## License

[MIT](./LICENSE)
