# dsh-newbe-plugins

**newbe** 品牌的 DeepSeek Harness (DSH) Web 插件合集，pnpm workspace monorepo。每个插件位于 `packages/<name>/`，可独立安装。

## 插件列表

| 插件 | 目录 | 说明 | 版本 |
| --- | --- | --- | --- |
| [dsh-newbe-response-window](./packages/dsh-newbe-response-window) | `packages/dsh-newbe-response-window` | 每轮响应窗口：把 think/工具调用收进有限高度的可滚动 slide，文字回复原生展示 | 0.2.0 |
| [dsh-newbe-input-enhancer](./packages/dsh-newbe-input-enhancer) | `packages/dsh-newbe-input-enhancer` | 增强输入框：Enter 锁定防误发、三击发送、字数统计、长文本提醒、草稿交换 | 1.1.0 |

## 安装

每个插件从 monorepo 的对应子目录独立安装（`#path:` 语法）：

```bash
# response-window
dsh plugin --profile web add github:qiqiangvae/dsh-newbe-plugins#path:packages/dsh-newbe-response-window

# input-enhancer（Git）
dsh plugin --profile web add github:qiqiangvae/dsh-newbe-plugins#path:packages/dsh-newbe-input-enhancer

# input-enhancer（npm，发布后）
dsh plugin --profile web add dsh-newbe-input-enhancer
```

锁定 commit（`&path:` 同时锁定子目录）：

```bash
dsh plugin --profile web add 'github:qiqiangvae/dsh-newbe-plugins#<commit-sha>&path:packages/dsh-newbe-response-window'
```

## 迁移

本仓库由独立插件仓库重组而来：

- `dsh-newbe-response-window`：原装在仓库根（`github:qiqiangvae/dsh-newbe-plugins`），现迁到子目录。插件名不变，`remove` 后用上方新地址重装。
- `dsh-newbe-input-enhancer`：由独立仓库 `qiqiangvae/dsh-input-enhancer`（npm 包 `dsh-input-enhancer`）迁入并改名。先 `dsh plugin --profile web remove dsh-input-enhancer`，再 `add dsh-newbe-input-enhancer`。

## 开发

```bash
pnpm install          # 安装 workspace 依赖
pnpm -r run check     # 每个插件的结构/语法检查
pnpm -r run test      # 每个插件的单元测试
pnpm -r run build     # 需要构建的插件（如 input-enhancer 的 src → lib）
```

- `dsh-newbe-response-window`：纯 JS，无构建，`lib/` 直接提交；E2E 用 `python3 packages/dsh-newbe-response-window/test/e2e.py`（需已启动的 `dsh web`）。
- `dsh-newbe-input-enhancer`：`src/` 为源码，`lib/` 为提交的预构建产物（`node scripts/build.mjs` 生成）。

## License

[MIT](./LICENSE)
