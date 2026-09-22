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

- 命名：`<包名>-v<该分支 package.json 的完整版本号>`，例 `dsh-newbe-my-favorites-v0.5.8-alpha`、`dsh-newbe-ide-v0.4.2-alpha`。**包名前缀不能省**：一个仓库共用一个 tag 命名空间，裸 `v0.5.8-alpha` 看不出属于哪个插件，不同包的版本号还会直接撞名。
- 必须是 annotated tag，指向该包该版本的发布提交（= 打 tag 时该通道分支上的 tip）。
- Release 标题写成 `<包名> v<版本>`，通道 Release 一律勾 pre-release。

### 文档里的安装命令

README 里的 Git 安装命令必须锁通道分支。不锁就会静默装到默认分支 `main`（集成分支、不发版）上：

```bash
dsh plugin --profile web add 'github:qiqiangvae/dsh-newbe-plugins#alpha&path:packages/<包名>'
```

`&` 会被 shell 当成后台执行，所以整条 spec 必须加引号（`#path:` 时代没有 `&`，历史命令可以不加）。npm 侧只有 `latest`（最近一次稳定发布）；要装通道版本就用上面的 Git 方式。

## Release notes

CHANGELOG entries and GitHub Release notes are user-visible prose: one or two lines saying what changed in behaviour and what the user now sees. A short mechanism clause is fine when it explains the effect.

Everything deeper stays in the commit message body — file, function, or class names; CSS declarations; measured pixel or DOM values; root-cause code paths; and how the cause was found. Commit bodies are the record; release notes are the announcement.

Before publishing, re-read each line: if it needs the deep detail to make sense, rewrite it as the visible symptom plus the visible fix.
