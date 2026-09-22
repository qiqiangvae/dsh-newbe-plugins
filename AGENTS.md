# dsh-newbe-plugins

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

Skill defaults kept: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: root `CONTEXT-MAP.md` points at one `CONTEXT.md` per package under `packages/`. See `docs/agents/domain.md`.

## 发布通道（分支 / 版本 / tag）

上游 DSH 按 alpha / rc 通道发布，本仓库镜像这两个通道：长期并存 `alpha` 与 `rc` 两条通道分支，`main` 是集成分支。

- `main`：集成分支、默认分支。修复与特性先落到这里；**不在 main 上 bump 通道版本，也不在 main 上打 tag**。
- `alpha`：对应上游 DSH 的 alpha 通道（如 `0.1.7-alpha.1`）。
- `rc`：对应上游 DSH 的 rc 通道。

发版流程：改动合进 `main` → 合并进目标通道分支 → 在通道分支上改版本号 → 打 tag → 推送 → 建 Release。

### 版本号

通道分支上的版本后缀必须**等于分支名，且不带序号**：alpha 分支上是 `0.5.8-alpha`，rc 分支上是 `0.5.8-rc`。同一个版本号只发一次——同一通道上再发修版就 bump 补丁号（`0.5.9-alpha`），不要写成 `-alpha.1`。

### tag

- 命名：`v` + 该分支 `package.json` 的完整版本号，例 `v0.5.8-alpha`、`v0.5.8-rc`。必须是 annotated tag，且指向声明该版本的那个提交。
- 消歧：monorepo 内同版本号已被另一个包占用时，改用 `<包名>-v<版本>`，例 `dsh-newbe-ide-v0.4.2-alpha`。
- Release 标题写成 `<包名> v<版本>`，通道 Release 一律勾 pre-release。

## Release notes

CHANGELOG entries and GitHub Release notes are user-visible prose: one or two lines saying what changed in behaviour and what the user now sees. A short mechanism clause is fine when it explains the effect.

Everything deeper stays in the commit message body — file, function, or class names; CSS declarations; measured pixel or DOM values; root-cause code paths; and how the cause was found. Commit bodies are the record; release notes are the announcement.

Before publishing, re-read each line: if it needs the deep detail to make sense, rewrite it as the visible symptom plus the visible fix.
