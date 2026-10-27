# dsh-newbe-plugins

## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

Skill defaults kept: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: root `CONTEXT-MAP.md` points at one `CONTEXT.md` per package under `packages/`. See `docs/agents/domain.md`.

## 发布通道（分支 / 版本 / tag）

只发 rc 稳定线：长期存在 `rc` 通道分支，`main` 是集成分支。**2026-10 起不再支持 alpha 版本**——不再维护 `alpha` 通道分支、不再发 npm `alpha` dist-tag，npm 上已有的 alpha 版本只作留档。

- `main`：集成分支、默认分支。修复与特性先落到这里；**不在 main 上 bump 版本，也不在 main 上打 tag**——main 的 `package.json` 停在「上一个稳定号」，版本只在 `rc` 上说话。
- `rc`：发布线。版本号**不带后缀**（`1.0.0`），发到 npm `latest`。

发版流程：**先发 npm**（子包）→ 改动合进 `main` → 合并进 `rc` 并在 `rc` 上改版本号 → 回归验证 → 在 `rc` 上打**仓库级**统一 tag `v<y.y.y>`、建 Release。

### 子包版本号

- 裸稳定号（`0.5.8`），发到 npm `latest`；同一个版本号只发一次，再发修版就 bump 补丁号。
- 只改了 README / 注释而没有行为变化时，不为它 bump 版本号、不发包。

### 仓库版本（GitHub 侧）

- `y.y.y` = **仓库根 `package.json` 的 `version`**，每发一批就 bump 一次（`main` 上 bump，合并进 `rc` 后打 tag）。
- tag 命名 `v<y.y.y>`（如 `v0.1.0`），annotated，指向 `rc` 上该批次的提交；Release 标题同样只写 `v<y.y.y>`（不带仓库名），不勾 pre-release。
- **不再打子包级 tag**（`<包名>-v<子包版本>` 那一套作废）：一个仓库一个 tag 命名空间，子包版本号会互相撞名。子包的版本记录在 npm 与 Release 说明里。
- GitHub 的 tag / Release **只作留档**，不是安装来源。

### Release 说明写什么

- 这批把哪些子包更新到了哪个版本，逐条写「将 `dsh-newbe-response-window` 更新至 `0.3.1`」。
- 安装命令只给 npm：`dsh plugin --profile web add <包名>`（写完整，不要只写"包名后加版本号"）。
- **不写 GitHub 安装命令**（`github:…#…&path:…` 那套已废弃），README 里也不留。

### 文档里的安装命令

README 只写 npm（GitHub 只作留档，不算安装渠道）：

```bash
dsh plugin --profile web add <包名>          # npm latest
```

开发调试仍可用 `link:` 本地软链。

**从 `link:` / Git 件换成 npm 件时要带显式版本号**（`… add <包名>@<版本>`）：依赖已存在时 pnpm 不会因为裸包名就改写 spec——实测 `add dsh-newbe-ide` 会原样留着 `link:…`，`add dsh-newbe-ide@0.4.1` 才换成 npm 件。

## Release notes

CHANGELOG entries and GitHub Release notes are user-visible prose: one or two lines saying what changed in behaviour and what the user now sees. A short mechanism clause is fine when it explains the effect.

Everything deeper stays in the commit message body — file, function, or class names; CSS declarations; measured pixel or DOM values; root-cause code paths; and how the cause was found. Commit bodies are the record; release notes are the announcement.

Before publishing, re-read each line: if it needs the deep detail to make sense, rewrite it as the visible symptom plus the visible fix.
