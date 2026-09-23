# dsh-newbe-plugins

**newbe** 品牌的 DeepSeek Harness (DSH) Web 插件合集，pnpm workspace monorepo。每个插件位于 `packages/<name>/`，可独立安装。

## 插件列表

| 插件 | 目录 | 说明 | 版本（npm `latest`） |
| --- | --- | --- | --- |
| [dsh-newbe-ide](./packages/dsh-newbe-ide) | `packages/dsh-newbe-ide` | 会话视图 tab「IDE」：按项目组织启动配置，一键启停、重启（进程组回收），日志实时滚动 + 过滤 + 落盘（跨重启可读回），可从 `.idea` 导入 Spring Boot 运行配置；另内置三个模型工具 + skill「ide-launch-config」让 agent 替你配（密钥只登记变量名、值走 DSH 凭据库） | 0.4.1 |
| [dsh-newbe-response-window](./packages/dsh-newbe-response-window) | `packages/dsh-newbe-response-window` | 每轮响应窗口：把 think/工具调用收进有限高度的可滚动 slide，文字回复原生展示；流式 think 支持出盒/盒内/关闭三模式 | 0.3.1 |
| [dsh-newbe-input-enhancer](./packages/dsh-newbe-input-enhancer) | `packages/dsh-newbe-input-enhancer` | 增强输入框：Enter 锁定防误发、三击发送、字数统计、长文本提醒、草稿交换 | 1.1.0 |
| [dsh-newbe-my-favorites](./packages/dsh-newbe-my-favorites) | `packages/dsh-newbe-my-favorites` | 会话与网址的本机快捷收藏（标题栏星标 + 侧栏收藏入口 + 快捷切换） | 0.5.8 |

alpha 通道走 npm 的 `alpha` dist-tag：response-window `0.3.2-alpha`、my-favorites `0.5.9-alpha`；其余插件尚未出 alpha 版，与 `latest` 同号。

## 安装

只从 npm 装。`latest` 是 rc 稳定线，`@alpha` 是 alpha 通道（版本形如 `x.x.x-alpha`）：

```bash
# rc 稳定线（npm latest）
dsh plugin --profile web add dsh-newbe-ide
dsh plugin --profile web add dsh-newbe-response-window
dsh plugin --profile web add dsh-newbe-input-enhancer
dsh plugin --profile web add dsh-newbe-my-favorites

# alpha 通道（npm alpha dist-tag）
dsh plugin --profile web add dsh-newbe-response-window@alpha
```

GitHub 侧只保留仓库级 tag `v<y.y.y>`（每次版本更新的留档），**不再提供 GitHub 安装命令**；要回看某次更新改了什么，看对应的 Release 说明。

## 迁移

本仓库由独立插件仓库重组而来：

- `dsh-newbe-response-window`：原装在仓库根（`github:qiqiangvae/dsh-newbe-plugins`），现迁到子目录。插件名不变，`remove` 后用上方新地址重装。
- `dsh-newbe-input-enhancer`：由独立仓库 `qiqiangvae/dsh-input-enhancer`（npm 包 `dsh-input-enhancer`）迁入并改名。先 `dsh plugin --profile web remove dsh-input-enhancer`，再 `add dsh-newbe-input-enhancer`。
- `dsh-newbe-my-favorites`：由独立仓库 `qiqiangvae/dsh-my-favorites`（npm 包 `dsh-my-favorites`）迁入并改名。先 `dsh plugin --profile web remove dsh-my-favorites`，再 `add dsh-newbe-my-favorites`；历史收藏数据首次启动时自动迁移到新存储文件名。

## 开发

```bash
pnpm install          # 安装 workspace 依赖
pnpm -r run check     # 每个插件的结构/语法检查
pnpm -r run test      # 每个插件的单元测试
pnpm -r run build     # 需要构建的插件（如 input-enhancer 的 src → lib）
```

- `dsh-newbe-response-window`：纯 JS，无构建，`lib/` 直接提交；E2E 用 `python3 packages/dsh-newbe-response-window/test/e2e.py`（需已启动的 `dsh web`）。
- `dsh-newbe-input-enhancer`：`src/` 为源码，`lib/` 为提交的预构建产物（`node scripts/build.mjs` 生成）。
- `dsh-newbe-my-favorites`：TypeScript + esbuild，`src/` 为源码，`lib/` 为提交的预构建产物（`node build.mjs` 生成；`pnpm -r run typecheck` 做类型检查）。

## License

[MIT](./LICENSE)
