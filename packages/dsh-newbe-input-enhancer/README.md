# dsh-input-enhancer

中文 | [English](README.en.md)

一个 **DeepSeek Harness Web 插件**，让聊天输入框更适合长文本编辑。

## 功能

| 功能 | 说明 | 触发方式 |
| --- | --- | --- |
| 🔒 **锁定 Enter 发送** | 锁定后按 Enter 不会误发消息，仍可正常编辑 | 点击锁按钮 / `Cmd/Ctrl+Alt+L` |
| ⚡ **三击发送** | 连按 3 次 Enter（每次间隔 ≤800ms）解锁并立即发送 | 锁定态按回车 |
| 🔢 **字数统计** | 输入框非空时，锁按钮后方实时显示字符总数 | 自动 |
| ⚠️ **长文本提醒** | 超过 800 字时，字数徽标变琥珀色警示，发送前一眼看清长度 | 自动 |
| 🔐 **自动锁定 / 解锁** | 字数超过 80 时自动锁定；输入框清空时自动解锁 | 自动 |
| ⇄ **草稿交换** | 在输入框与暂存区之间交换内容，暂存半成品草稿留到后续轮次再发 | 点击交换按钮 / `Cmd/Ctrl+Opt+K` |

- **锁形按钮**：注册在官方 `conversation.input.right` 槽位，位于输入框右下角、发送按钮附近；锁定为醒目红色填充，悬浮可看当前状态提示。也可用快捷键 `Ctrl/Cmd+Alt+L` 切换（仅在输入框聚焦时生效）。
- **字数统计为独立功能**：与锁状态无关，输入框非空即显示（锁定与否都显示）。
- **长文本提醒**：草稿达到阈值（默认 800 字符）时，字数徽标切换为琥珀色警示态，悬浮提示「内容较长」。
- **自动锁定 / 解锁**：默认开启（源码常量 `AUTO_LOCK_ENABLED` / `AUTO_LOCK_THRESHOLD`）。字数从 `≤80` 上升到 `>80` 的那一次变化（上升沿）自动锁定；输入框被完全清空（字数归 0）时自动解锁。锁没有「手动 / 自动」来源之分，锁上就是锁上了——两条沿只负责加锁/解锁，其他中间状态（删到非零字数、或在 80 上下波动）不改变锁状态。清空解锁后再次输入并越过 80 会重新自动锁。此「80 锁」与上一条「800 提醒」互相独立。
- **按会话隔离**：每个会话独立保存锁状态，切换会话互不影响。

### 锁状态与输入框

| 状态 | 锁图标 | 输入框 | Enter 行为 |
| --- | --- | --- | --- |
| 解锁 | 灰色描边 | 默认大小 | 正常发送 |
| 锁定 | **红色填充 + 白色锁图标** | 默认大小 | 不发送（连按 3 次可解锁并发送） |

悬浮提示：

- 解锁：`已解锁，输入框为默认大小，Enter 可正常发送`
- 锁定：`已锁定，Enter 不会发送；连按 3 次 Enter 可解锁并立即发送`

### 三击回车（锁定态的逃生门）

锁定状态下临时想发送，无需先点锁：**连按 3 次 Enter** 即可解锁并立即发送。

- 前两次 Enter 无副作用（不发送、不换行），只累计计数；锁图标会**变成当前次数**（第 1 次显示「1」、第 2 次显示「2」），并伴随递增的脉冲闪烁；
- 第 3 次 Enter 触发**烟花爆炸动画**（彩色粒子从锁按钮向四周飞散、持续约 1 秒），随即解锁并发送当前内容；
- 超时、按其他键、切换会话都会重置计数。

> 三击仅对锁定态生效；空输入框不会发送空消息。

### 草稿交换（暂存半成品）

agent 还在思考/执行时，你往往想先把「下一轮要说的话」打在输入框里。但有时打到一半才意识到——这份草稿要等几轮之后才该发。此时用一个无方向的交换按钮（⇄）把它暂存起来，继续写别的、发送，等合适的轮次再取回继续编辑。

- **交换按钮**：注册在 `conversation.input.right` 槽位，位于锁按钮左侧；图标为 ⇄（双箭头互换，无方向语义）。点一下即在「输入框」和「暂存区」之间交换内容。
- **原子交换语义**：
  - 暂存区**空** → 输入框内容移入暂存区，输入框清空；
  - 暂存区**满** → 两侧**互换**：暂存区的旧草稿回到输入框，输入框当前内容移入暂存区（不丢任何一边）；
  - 暂存区满时按钮**高亮填充**，一眼可知暂存区里有内容。
- **快捷键** `Cmd+Opt+K`（macOS）/ `Ctrl+Alt+K`（Windows/Linux，另见下方相邻快捷键提示）等价于点击交换按钮，仅在输入框聚焦时生效。
- **按会话隔离、不持久化**：每个会话各有自己的暂存区（单槽），刷新页面或重启即清空——它只服务于「本会话内暂存几轮」的临时场景，不跨会话、不落盘。

> 两个按钮都在输入框内时，若输入框有字、暂存区也有字，点交换会把两者对调，请按需使用。

## 实现保证

- **不替换官方输入框**：只拦截键盘提交路径，保留官方的输入状态机、命令菜单、队列、附件等能力。
- **中文输入法友好**：IME 组合期间的 Enter 永远放行。
- 锁定状态下被阻止：普通 `Enter`、`Ctrl+Enter` / `Cmd+Enter`、其他触发官方提交路径的 Enter 组合。
- 保留正常行为：`Shift+Enter` 换行、IME 候选词确认、编辑/复制/粘贴/附件、鼠标点发送按钮（锁只防键盘误触）。

## 快捷键

**`Ctrl+Alt+L`**（Windows/Linux）或 **`Cmd+Alt+L`**（macOS）可切换当前输入框的锁定状态，无需鼠标点锁按钮。仅在输入框聚焦时生效。

> 为什么不是 `Ctrl/Cmd+L`：Chrome / Edge 把 `Ctrl+L`、macOS 把 `Cmd+L` 保留给地址栏，浏览器会先截获；故改用 `Ctrl/Cmd+Alt+L` 避开冲突。

**`Ctrl+Alt+K`**（Windows/Linux）或 **`Cmd+Opt+K`**（macOS）可触发草稿交换。仅在输入框聚焦时生效。

> 相邻快捷键提示：`Cmd/Ctrl+Opt/Alt+K`（草稿交换）与 `Cmd/Ctrl+Opt/Alt+L`（锁定）相邻，且 Opt 即 Alt，容易误触——若频繁误按，可优先用对应的图标按钮。

## 环境要求

- DeepSeek Harness `0.1.2-alpha.1`（已验证版本；`0.1.0-rc.6` 亦可运行）；
- `web` profile；
- 基于 Chromium 的现代浏览器（Chrome / Edge 均可）。

> 本插件通过 `[data-composer-card]`、`[data-composer-input]`、`[role="listbox"]` 等 DSH 内核内部 DOM 契约工作（源码里集中在 `src/client.js` 顶部的 `SEL` 常量表）。DSH `0.1.2-alpha.1` 把输入框从 `<textarea>` 升级为 Lexical `contenteditable` 宿主（`data-composer-input` / `role="textbox"`），插件已适配；升级 DSH 到更高版本后，若锁定/字数/暂存/候选菜单相关行为异常，请先对这些功能做一次回归，并核对 `SEL` 表中的选择器是否仍与内核一致。

## 安装

### 方式一：从 npm 安装

```sh
dsh plugin --profile web add dsh-input-enhancer
```

建议锁定到具体版本以保证可重复安装：

```sh
dsh plugin --profile web add 'dsh-input-enhancer@1.1.0'
```

### 方式二：从本仓库 GitHub 安装

```sh
dsh plugin --profile web add github:qiqiangvae/dsh-input-enhancer
```

也可以显式使用 Git URL：

```sh
dsh plugin --profile web add https://github.com/qiqiangvae/dsh-input-enhancer.git
```

建议锁定到某个 commit 以保证可重复安装：

```sh
dsh plugin --profile web add 'github:qiqiangvae/dsh-input-enhancer#<commit-sha>'
```

### 方式三：从本地目录安装

```sh
git clone https://github.com/qiqiangvae/dsh-input-enhancer.git
dsh plugin --profile web add ./dsh-input-enhancer
```

### 验证安装

```sh
dsh --profile web --dump-config | grep dsh-input-enhancer
```

应能看到类似输出：

```yaml
# == dsh-input-enhancer
- id: dsh-input-enhancer
  name: dsh-input-enhancer
```

安装完成后重启 `dsh web` 并刷新页面。

## 使用方法

1. 启动 DeepSeek Harness Web：

   ```sh
   dsh web
   ```

2. 在聊天输入框右下角、模型选择器和发送按钮附近找到锁形按钮。

3. 锁定 / 解锁方式：

   - 点击输入框右下角的锁形按钮；
   - 或按快捷键 `Ctrl+Alt+L`（Windows/Linux）/ `Cmd+Alt+L`（macOS），仅在输入框聚焦时生效。

4. 锁定状态下：

   - 普通 `Enter`：不发送。
   - `Ctrl+Enter` / `Cmd+Enter`：不发送。
   - `Shift+Enter`：仍然插入换行。
   - 输入法组合期间的 Enter：正常用于候选词确认，不受影响。
   - 点击官方发送按钮：仍可发送，锁只防键盘误触。
   - **连按 3 次 `Enter`**（每次间隔 800ms 内）：解锁并立即发送（前两下锁图标变「1」「2」闪烁，第三下触发解锁爆炸动画）。

5. 锁状态按会话独立保存，刷新页面或重启后自动清除。

6. 字数统计与锁状态无关：只要输入框非空（无论锁没锁），锁按钮后方都会实时显示字符数徽标。

7. 暂存半成品草稿：

   - 点击输入框右下角锁按钮左侧的交换按钮（⇄），或按 `Cmd+Opt+K`（macOS）/ `Ctrl+Alt+K`（Windows/Linux）；
   - 暂存区空时，当前草稿移入暂存区、输入框清空；
   - 暂存区满时，两侧互换（暂存草稿回到输入框、当前输入移入暂存区）；
   - 暂存区内容为内存态，刷新页面即清空。

## 配置

插件默认零配置，不需要填写 API Key、设置项或 `settings.yaml`。锁状态与暂存区内容仅保存在浏览器内存中。

## 功能与限制

- 锁定状态只保存在浏览器内存中，不写 `settings.yaml`，不发起网络请求。
- 草稿暂存区同样为浏览器内存态（每会话一个槽），刷新/重启即清空，不跨会话、不落盘、不发起网络请求。
- 插件使用官方 `conversation.input.right` 槽位，不替换官方 composer。
- 自动锁定/解锁只由两条「长度沿」触发：字数上升越过 80 则加锁，输入框完全清空（归 0）则解锁；其余中间状态不改变锁状态。
- 不干扰其他输入框、按钮、浏览器快捷键或全局快捷键。

## 疑难排查

### 输入框旁边看不到锁按钮

1. 确认插件已挂载：

   ```sh
   dsh --profile web --dump-config | grep dsh-input-enhancer
   ```

2. 重启 `dsh web` 并强制刷新页面（`Ctrl+F5`）。
3. 确认当前使用的是 `web` profile。

### 快捷键无法使用

1. 确认焦点在输入框内（快捷键仅在输入框聚焦时生效）。
2. 确认按的是 `Ctrl+Alt+L`（Windows/Linux）或 `Cmd+Alt+L`（macOS），而不是 `Ctrl/Cmd+L`（被浏览器地址栏占用）。
3. 部分 Linux 桌面环境可能把 `Ctrl+Alt+L` 用于系统级操作（如锁屏/切换布局），此时该组合会被系统截获；请改用锁按钮。

### 锁定后仍然“发送”了

- `Shift+Enter` 是换行，不是发送。
- 鼠标点击官方发送按钮是刻意操作，锁不会阻止。
- 如果输入框中的内容意外发送，请检查锁按钮是否显示为红色填充的锁定状态，以及是否使用了其他 Enter 组合键。

## 卸载

```sh
dsh plugin --profile web remove dsh-input-enhancer
```

## 开发与构建

安装本仓库不需要构建：`lib/` 已提交预构建产物，且没有 `prepare` / `postinstall` 脚本。

如需修改源码后重新生成构建产物：

```sh
npm run build   # 生成 lib/index.js 与 lib/client.js
npm run check   # 结构检查
```

## 目录结构

```text
dsh-input-enhancer/
├── package.json          # dsh.bundle + dsh.client 插件声明
├── cordis.patch.yml      # profile bundle patch
├── src/
│   ├── index.js          # Host 半部（无依赖 no-op）
│   └── client.js         # Web 半部：分层编排（锁 feature + 字数统计 + 长文本提醒 + 草稿交换）
├── lib/                  # 构建产物
├── scripts/
│   ├── build.mjs
│   └── check.mjs
├── README.md
├── README.en.md
└── LICENSE
```

## 更新说明（从 dsh-enter-lock fork 而来）

本插件由 `dsh-enter-lock` 更名并增强而来。若你之前安装了旧名插件，请先卸载再安装本插件：

```sh
dsh plugin --profile web remove dsh-enter-lock
dsh plugin --profile web add github:qiqiangvae/dsh-input-enhancer
```

相较 `dsh-enter-lock`，本插件新增：

- **三击发送**：连按 3 次 Enter 解锁并立即发送（含次数闪烁与解锁爆炸动画）；
- **字数统计**：输入框非空即实时显示字符数（独立于锁状态）；
- **长文本提醒**：超过 800 字符时字数徽标变琥珀色警示；
- **自动锁定 / 解锁**：字数超过 80 时沿上升沿自动锁定，输入框清空时自动解锁；
- **草稿交换**：⇄ 交换按钮 + `Cmd/Ctrl+Opt/Alt+K`，在输入框与暂存区之间交换半成品草稿（每会话单槽、内存态）。

## License

[MIT](./LICENSE)
