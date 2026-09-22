# dsh-newbe-response-window

DeepSeek Harness (DSH) Web 插件：把一轮里的 think（推理）和工具调用放进**有限高度的可滚动窗口**（默认 10 行），以**阶段性文字回复为界分段**，每个分段一个 **slide**；文字回复保持原生完整显示、不做限高。中间过程**始终可见**（只是不撑爆页面）——Grok Build 风格。

> 已验证 DSH 版本：**0.1.7-alpha.1**（2026-09）。
> 与「全部折叠成 summary」类插件（如 `dsh-tool-summary`）不同：本插件**不隐藏**任何内容。think 与工具调用一条条列在 slide 里，每段都能展开翻到底；文字回复完全原生展示。
> 只包 bash + think：阶段性/最终文字 response **不**加限高、**不**加「展开全部/收起」按钮。
> **0.1.7 起的一轮折叠**：DSH 0.1.7 原生把「已完成的一轮」的中间过程折叠成一行「已完成工作 N 个工具调用」（简洁/详细/完全展开三种「工作过程展示」模式都折叠）。进行中的一轮 slide 照常常显；已完成的一轮点开这一行后，看到的就是本插件的 slide。

## 效果

一个 prompt 之后有 100 次 tool call + 长回复时：

- **think（推理）和工具调用** → 合并为 slide（think 与 tool call 都是 implementation，不做区分）：
  - **以「阶段性文字回复」为界分段**：模型中途直接返回给用户的每条文字 response 是天然分隔点；两个分隔点之间的一段 think+bash 是一个 slide。不会两个 input prompt 之间挤成一整个 slide
  - 头部：`10 个工具调用 · 5 Think`（无 emoji、无冗余序号）+ 进行中 / 失败徽标，可点击收起/展开
  - 主体：`max-height: N 行`（默认 10）的**内部滚动区**
    - **think 与工具调用严格按真实输出顺序交错排列**（不做「think 全在上 / bash 全在下」的强行分区）
    - 每段 think 一行（Think + 单行摘要 + 展开箭头），默认折叠，点击展开完整推理（内部限高滚动）；展开文字与工具输出同字号（同一 mono 字体）
    - **think 流式显示三种模式**（`liveStreamThink`，默认 `'out'`）：
      - `'out'`（默认）：正在流式的 think 在 **slide 外**（原生位置）实时显示，流式结束后**收进 slide 折叠**成单行摘要
      - `'in'`：流式 think 在 **slide 内**自动展开、正文实时滚动，结束后自动收起为单行摘要
      - `'off'`：think 全程折叠为单行摘要，不做流式展开
    - 每条工具调用一行（状态点 + 工具名 + 单行摘要），点击展开参数/输出（输出再限高一档，内部滚动）
  - 执行中自动跟随底部
- **原生 Think 行从消息流中隐藏**（该段已并入 slide，避免重复显示），与 slide 内展示共用同一份内容
- **阶段性文字回复与最终回复** → 完全原生展示，保持全文可见，**不套 slide 窗口**、不加任何按钮
- 用户消息始终是「整轮的分隔点」，保持原位

> 效果预览见 GitHub 仓库页面或自行安装体验（仓库不再内置运行截图，避免暴露会话内容）。

## 安装

从 npm 安装：

```bash
dsh plugin --profile web add dsh-newbe-response-window
```

或从合集仓库 GitHub 子目录安装：

```bash
dsh plugin --profile web add github:qiqiangvae/dsh-newbe-plugins#path:packages/dsh-newbe-response-window
```

或本地 link 方式（开发调试）：

```bash
git clone https://github.com/qiqiangvae/dsh-newbe-plugins.git
cd dsh-newbe-plugins
dsh plugin --profile web add "link:$(pwd)/packages/dsh-newbe-response-window"
```

装完重启 `dsh web`（或等 profile HMR）生效。

卸载：`dsh plugin --profile web remove dsh-newbe-response-window`

> 迁移提示：本插件已从独立仓库迁入 newbe monorepo，老安装地址（仓库根 `github:qiqiangvae/dsh-newbe-plugins`）已失效。插件名仍是 `dsh-newbe-response-window`——先 `dsh plugin --profile web remove dsh-newbe-response-window`，再用上方新地址重装即可。

## 配置

`cordis.patch.yml` 里插入了默认配置，可改：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `lines` | `10` | 窗口高度（行）。`0` = 不限高（等价于关闭窗口） |
| `collapsed` | `false` | slide 本身是否默认收起成一行 bar。默认 `false`：展开、内容可见（已完成轮次的外层折叠由 DSH 原生「已完成工作」那行控制） |
| `showReadOnly` | `true` | 是否在 slide 里列出 read/grep/web_search 等只读调用（默认全列出，不藏） |
| `minCollapseRows` | `3` | 仅 `collapsed: true` 时生效：少于该数量的轮次不收起 |
| `liveStreamThink` | `'out'` | 流式 think 的显示模式：`'out'` 盒外流式结束后进盒折叠 / `'in'` 盒内自动展开 / `'off'` 全程折叠 |

### 设置页（Settings → General）

插件在 Web UI 的 **Settings → General** 里注册了两项：

- **「响应窗口大小（行数）」**：`−` / 数值输入 / `+` 调整 `lines`（0–200，`0` = 不限高，默认 10）
- **「流式思考显示」**：三选一（关闭 / 盒内 / 出盒），对应 `liveStreamThink`（默认出盒）
- 均**即时生效**：改动后已渲染的 slide 立刻变化（经宿主 settings namespace `dsh-newbe-response-window` 持久化）

## 实现说明（为什么安全）

- 工具调用 slide 通过 `conversation.chat.node`（`tool-call` key，`priority: -100`）的 **slot shadow** 在 React 层实现：每轮第一个 tool-call 节点渲染整个 slide，同轮其余 tool-call 节点渲染空，任何渲染异常由 slot 运行时的 entry boundary **自动 abdicate** 回内置渲染。
- **绝不移走 React 拥有的 `[data-chat-anchor-key]` 行节点**。实测：把行移进自定义容器后，一旦 DSH 后续移除该行（会话切换/编辑/压缩），React 会调用 `parent.removeChild(row)` 抛 `NotFoundError`，整个会话树被卸载——因此本插件只用「slot shadow + 类/CSS」两种方式，对 React 行结构零改动。
- 原生 Think 行隐藏与 slide 内的 think 同步：只对「该段内有 slide」的原生 `data-variant="think"` 行加 `display:none`（DOM 类/CSS，无重挂、无删除），其余（无工具调用的纯 Think 段）保持原生显示。0.1.7 把消息流行套进了 process-group 容器（`[data-chat-flow] > group root > content > 行`），行不再是 flow 的直接子节点，所以这段判定改成按文档顺序读全部 `[data-chat-flow-kind]` 行。（改动前 `flow.children` 只看到组外壳，永远匹配不到 Think，导致 slide 与原生 Think 双份显示。）
- 插件只读会话快照，不写快照、不调宿主 API。0.1.2-alpha 起快照从 slot 标准 prop **`useChat`** 读取（`{ locations.getTurn(turn), nodes.get(key) }` 形状），不再走 `useSession` 的 `chat` 字段；「幽灵行」判定通过 DOM 行上的 `data-chat-flow-key` 与该快照对号，不再嗅探 markdown CSS 类名（新版 CSS Module 类名已不含 `_markdown`）。
- 浏览器半依赖 `@deepseek-ai/dsh-client-store`（`createSnapshotStore`，shell 内置 seed module），替代旧版的 `@deepseek-ai/dsh-client-runtime`（该包在新 alpha 已移除）。旧版 `dsh.plugin.json` 清单在新 alpha 不再被读取，已删除。
- **设置持久化走 `configForms`**：0.1.7 移除了 `settingsScope` 服务，改为每个 profile 条目一个 controller（`ctx.configForms.get(条目 id)`，id 即 settings namespace）。宿主半的 `Config` 必须把用户可改字段标 `.volatile()`（settings 文档只投影 volatile 字段），并 `settings.configure({ auto: false }, ctx.fiber)` 退出自动生成的配置页。旧写法（`settingsScope` + `settings.register()`）会让 `inject` 永远等不到服务、整个插件静默不挂载——这正是 0.1.7 升级后 slide 全消失的原因。
- 宿主半因此要求 `@deepseek-ai/schemastery` **≥ 3.18.3**（`.volatile()` 的引入版本；随 DSH 0.1.7-alpha.1 发布）。

## 开发 / 测试

纯 JS，无构建步骤：

```bash
npm run check   # node --check lib/index.js && node --check lib/client.js
```

E2E（需要已启动的 `dsh web`；用 uv 起 python playwright）：

```bash
dsh --profile web --no-open --port 3639 &
uv run --with playwright playwright install chromium   # 首次
uv run --with playwright python3 test/e2e.py --url http://127.0.0.1:3639 --session "修复 dsh 升级后的插件不兼容"
```

断言含：客户端半确实挂载（slide ≥ 1，服务缺失时这里会先失败）、窗口限高且内部真能滚动、think 单行且点击展开、有 slide 的段落里原生 Think 不重复显示、Settings → General 两行挂载并读到持久值、会话切换不崩。

- 宿主半：`lib/index.js`（声明 volatile 设置字段并退出自动配置页，依赖 `@deepseek-ai/schemastery` ≥ 3.18.3）
- 浏览器半：`lib/client.js`（`window.__ModuleLoader__.load`，require `react` 与 shell seed 的 `@deepseek-ai/dsh-client-store`，设置走 `configForms`）

## License

MIT
