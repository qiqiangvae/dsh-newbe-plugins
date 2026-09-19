# dsh-newbe-plugins

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

Skill defaults kept: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: root `CONTEXT-MAP.md` points at one `CONTEXT.md` per package under `packages/`. See `docs/agents/domain.md`.

## Release notes

CHANGELOG entries and GitHub Release notes are user-visible prose: one or two lines saying what changed in behaviour and what the user now sees. A short mechanism clause is fine when it explains the effect.

Everything deeper stays in the commit message body — file, function, or class names; CSS declarations; measured pixel or DOM values; root-cause code paths; and how the cause was found. Commit bodies are the record; release notes are the announcement.

Before publishing, re-read each line: if it needs the deep detail to make sense, rewrite it as the visible symptom plus the visible fix.
