# DSH My Favorites

DSH Desktop 的本机收藏插件。

> **兼容性**：要求 DSH ≥ `v0.1.2-rc.1`，**不兼容 `v0.1.2-alpha.1` 及更早版本**。`v0.1.2-rc.1` 把 `dsh-client-store` / `dsh-client-ui-primitives` 收编为 Web 外壳注入的基线静态模块，并把插件设置标签页 `settings.plugins.tab` 改由 `dsh-client-ui-settings-plugins` 声明。`@deepseek-ai/dsh-home-paths` 已发布到公共 npm，插件在 `dependencies` 中声明它；其余 `@deepseek-ai/dsh-client-*` 基线模块仍由 DSH 宿主运行时注入。

- 在会话标题栏 Preset 后用星标收藏或取消收藏会话。
- 侧栏「新会话」按钮下方的「收藏」入口提供会话收藏与网址收藏。
- 快捷键切换：快速按 `⌘+⌥+`` `（macOS）/ `Ctrl+`` `（其它平台）切回上一个收藏会话；长按弹出切换列表。
- 在 **设置 → 插件 → 插件配置 → 收藏** 中管理网址收藏，并可用「启用收藏的网站」开关控制侧栏网址快捷标签的显隐。

## 安装

```bash
# 从合集仓库 GitHub 安装（子目录）
dsh plugin --profile web add github:qiqiangvae/dsh-newbe-plugins#path:packages/dsh-newbe-my-favorites

# 本机开发：本地路径软链接
dsh plugin --profile web add "link:$(pwd)/packages/dsh-newbe-my-favorites"
```

并确认 `dsh-newbe-my-favorites` 已列入该 profile `package.json` 的 `dsh.profile.bundles`。

详情请参阅 [README.md](./README.md)。
