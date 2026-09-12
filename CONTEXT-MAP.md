# Context Map

A pnpm workspace of independent DSH Web plugins. Each package under `packages/` is its own context with its own `CONTEXT.md` and `docs/adr/`.

| Context | Path | Covers |
| --- | --- | --- |
| dsh-newbe-ide | `packages/dsh-newbe-ide/` | Session-view tab「IDE」: launch configurations per workspace (start/stop/restart, logs kept in the browser and on disk), plus import of Spring Boot run configurations from `.idea`. |
| dsh-newbe-input-enhancer | `packages/dsh-newbe-input-enhancer/` | Chat input box for long-text editing: Enter-send lock, triple-Enter send. All state and interception live in the Web client half. |
| dsh-newbe-my-favorites | `packages/dsh-newbe-my-favorites/` | Local session and URL quick-favourites for the DSH Desktop GUI. |
| dsh-newbe-response-window | `packages/dsh-newbe-response-window/` | Bounds think + tool calls in a fixed-height scrollable window, split into per-segment slides, without hiding anything. |

## System-wide decisions

Cross-package decisions — release process, plugin packaging contract, DSH compatibility floor — live in `docs/adr/`.

## Not yet documented

`dsh-newbe-my-favorites` and `dsh-newbe-ide` have a `CONTEXT.md` today. `/domain-modeling` fills the others in lazily, when terms or decisions actually get resolved.
