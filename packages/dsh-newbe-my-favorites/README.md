# DSH My Favorites

为 **DeepSeek Harness Desktop** 提供本机的会话与网址收藏功能。

## 兼容性

- 本插件要求 **DSH ≥ `v0.1.2-rc.1`**，并已针对 `v0.1.2-rc.1` 适配。
- **不兼容 DSH `v0.1.2-alpha.1` 及更早版本**：`v0.1.2-rc.1` 存在破坏性更新——
  - `@deepseek-ai/dsh-client-store` 与 `@deepseek-ai/dsh-client-ui-primitives` 不再是独立发布的 npm 包，而是由 Web 外壳以「基线静态模块」（`PLATFORM_MODULES`）注入浏览器模块表；插件 `dsh.client.inject` 已移除对这两个包的包级依赖。
  - 插件设置标签页 `settings.plugins.tab` 改由 `@deepseek-ai/dsh-client-ui-settings-plugins` 声明，`dsh.client.inject` 相应更新。
- `@deepseek-ai/dsh-home-paths` 已发布到公共 npm（`0.1.2-rc.1`），插件把它声明为 `dependencies`，宿主编译产物经普通 Node ESM 解析加载；其余 `@deepseek-ai/dsh-client-*` 基线模块由 DSH 宿主在运行时注入，不写入 `dependencies`/`peerDependencies`。请使用对应版本的 DSH Desktop 安装本插件。

## 功能

### 会话收藏

- 在会话标题栏中，紧邻 **Preset**（例如 `Coding 模式`）控件显示星标按钮。
- 点击 `☆` 收藏当前会话；点击 `★` 立即取消收藏。
- 在左侧侧栏 **“新会话”按钮正下方** 显示收藏区域：全部网址收藏以 icon/1–4 个字符的紧凑标签常驻显示，悬停可查看名称和 URL。
- `收藏会话 (N)` 为默认收起的会话收藏夹；点击展开或关闭，展开后点击会话会切换并自动收起。
- 在会话收藏夹中按住 `⌘ Command` 拖动会话项即可调整排序。
- 点击会话标签或完整收藏列表中的会话，即可切换到该会话。
- 会话标题变化后，侧栏和收藏列表优先显示最新标题；已删除或无法打开的会话可从收藏列表中移除。
- 当前会话在收藏夹中以「整行常驻 hover 背景」标注为激活状态。

### 快捷键切换

- **快速按** `⌘+⌥+`` `（macOS）或 `Ctrl+`` `（其它平台）并松开：立即切换到上一个收藏会话，不弹出列表。
- **长按**（约 0.25 秒）：弹出居中的收藏会话切换列表；继续按住则循环高亮，松开确认切换所选会话；`Esc` 或点击遮罩取消。
- 兼容死键（dead key）键盘布局：切换器依赖物理键位而非 `` ` `` 的 keyup 事件，在中文/多语言输入法下同样可靠。

### 网址收藏

- 侧栏“收藏”弹层同时展示已配置的网址收藏。
- 每个网址收藏包含名称、URL、可选自定义 icon 与“使用网站图标”开关；侧栏标签展示优先级固定为 **网站 favicon > 自定义 icon > 名称**。网站图标从 `{协议}://{域名}/favicon.ico` 加载，失败时自动回退。
- 点击网址会通过 DSH Desktop 的外部链接策略，在系统默认浏览器中打开。
- 仅允许 `http:`、`https:` 与 `mailto:` URL。
- 「启用收藏的网站」开关（默认开启）：关闭后侧栏不再显示网址快捷标签，仅保留会话收藏夹；已保存的网址收藏与设置项完整保留，重新开启即恢复显示。

### 插件配置

在 **设置 → 插件 → 插件配置 → 收藏** 中可以：

- 新增网址收藏；
- 编辑名称、URL 和自定义字母徽标；
- 删除网址收藏；
- 调整网址收藏的显示顺序；
- 用「启用收藏的网站」开关控制侧栏网址快捷标签的显隐。

## 安装与构建

### 构建

在插件目录执行：

```bash
pnpm install
pnpm run build
```

构建后的入口为：

- `lib/index.js`：Host 侧收藏存储服务（持久化到 `$DSH_HOME/storages/dsh-newbe-my-favorites.json`，并暴露 `myFavorites` RPC 服务）；
- `lib/typert.host.js`：Host 面 Typert 清单（`./typert`，由 DSH 的 typert-loader 自动注册）；
- `lib/client.js`：DSH Web 客户端 UI 扩展（经 `remote.myFavorites.*` 读写收藏数据）。

### 安装到 DSH

DSH 通过 `dsh plugin` 子命令管理 profile 插件（等价于在 profile 目录内执行 `pnpm`）。安装本插件：

```bash
# 从合集仓库 GitHub 安装（子目录；可加 #commit 锁定版本）
dsh plugin --profile web add github:qiqiangvae/dsh-newbe-plugins#path:packages/dsh-newbe-my-favorites

# 本机/开发：从本地路径软链接安装
dsh plugin --profile web add "link:$(pwd)/packages/dsh-newbe-my-favorites"

# 从 npm 安装
dsh plugin --profile web add dsh-newbe-my-favorites
```

将 `<profile>` 换成你的目标 profile（如 `web`、`desktop`、`tui`）。

> 从旧名 `dsh-my-favorites` 迁移：插件已随 newbe 合集改名。老用户先 `dsh plugin --profile web remove dsh-my-favorites`，再用上方命令安装新名；历史收藏数据会在首次启动时自动从旧存储文件 `dsh-my-favorites.json` 迁移到 `dsh-newbe-my-favorites.json`。

> **必须**同时把 `dsh-newbe-my-favorites` 列入该 profile `package.json` 的 `dsh.profile.bundles` 数组；只加入 `dependencies` 不会启用插件。安装后重启 DSH（或重新加载 profile）即可生效。

## 数据与限制

- 收藏数据保存在本机 `$DSH_HOME/storages/dsh-newbe-my-favorites.json`（默认 `~/.dsh/storages/dsh-newbe-my-favorites.json`）中，**不写入 `settings.yaml`**，不跨设备同步，也不提供导入/导出。
- 会话收藏保存的是当前 DSH 实例内的会话 ID，因此不适合跨机器、跨 DSH 数据目录迁移。
- 远程浏览器连接不具备宿主 RPC 写入权限时，收藏设置不会持久化。
- 若已收藏的会话被删除或当前实例不再能识别该 ID，切换会话会失败；请从收藏列表移除该条目。

## 开发验证

本项目已通过以下本地验证：

```bash
pnpm run typecheck
node --check lib/index.js
node --check lib/typert.host.js
node --check lib/client.js
```

> 本机若缺少 DSH 私有包的 pnpm 离线镜像元数据，`pnpm install --offline` 可能失败；可在具备 DSH 依赖源的环境中正常安装并构建。
