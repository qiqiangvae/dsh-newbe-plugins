# Changelog

All notable changes to this project are documented in this file.

## [0.5.4] - 2026-09-03

### Fixed

- 适配 DSH `v0.1.2-rc.1`，修复宿主启动崩溃（`Cannot find package '@deepseek-ai/dsh-home-paths'`）：`@deepseek-ai/dsh-home-paths` 现已发布到公共 npm，重新把它声明为 `dependencies`（`^0.1.2-rc.1`），宿主编译产物 `lib/index.js` 经普通 Node ESM 解析加载即可找到该包。
- 移除 `dsh.client.inject` 中两个已收编为 Web 外壳「基线静态模块」的包（`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-primitives`）：它们在 `v0.1.2-rc.1` 中不再是独立包行，仍声明在 `inject` 里会导致模块图/插件组合解析失效。
- `dsh.client.inject` 中插件设置标签页依赖由 `@deepseek-ai/dsh-client-ui-settings` 改为 `@deepseek-ai/dsh-client-ui-settings-plugins`（`v0.1.2-rc.1` 中 `settings.plugins.tab` 槽位改由该包声明）。

## [0.5.3] - 2026-08-29

### Fixed

- 修复 `dsh plugin add` 安装失败（`ERR_PNPM_NO_MATCHING_VERSION`）：`0.5.2` 把 `@deepseek-ai/dsh-home-paths@0.1.2-alpha.1` 写进了 `dependencies`，且把五个 `@deepseek-ai/dsh-client-*@0.1.2-alpha.1` 写进 `peerDependencies`，而这些 DSH 私有包均未发布到公共 npm，导致 pnpm 无法解析。现从 `dependencies` 移除 `dsh-home-paths`、移除全部 `peerDependencies`（这些包运行时由 DSH 宿主注入，构建时已按 `external` 处理，无需插件声明为可安装依赖）。版本升至 `0.5.3`。

## [0.5.2] - 2026-08-29

### Changed

- 会话收藏夹中「当前会话」的高亮由「标题字变品牌蓝」改为「整行常驻 hover 背景」：与鼠标悬浮同一背景色，选中后保持该背景，视觉更一致、不再强调字体颜色。
- 折叠头标题由「会话 (N)」改为「收藏会话 (N)」。
- 折叠头图标由「金色 ★ + 灰色 › 箭头」改为 DSH 官方「文件夹关/开」图标（`IconFolderClose16` ↔ `IconFolderOpen16`）：展开/收起靠同一文件夹对象的开合状态区分，去掉黄色星标与冗余箭头，颜色改用主文本色。
- 依赖新增 `@deepseek-ai/dsh-client-ui-primitives`（官方图标集），并在 README 显式声明兼容性：要求 DSH ≥ `v0.1.2-alpha.1`，不兼容 `v0.1.1-rc.2` 及更早版本。

## [0.5.1] - 2026-08-29

### Fixed

- 适配 DSH `v0.1.2-alpha.1` 的破坏性更新：`@deepseek-ai/dsh-client-runtime` 包已被移除（`createSnapshotStore` 合并进新的私有包 `@deepseek-ai/dsh-client-store`，并从包根导出，不再有 `/client` 子路径）。客户端入口 `src/client.tsx` 的导入、`package.json` 的 `dsh.client.inject` 与 `peerDependencies` 全部改为 `@deepseek-ai/dsh-client-store`，并将相关依赖版本对齐到 `0.1.2-alpha.1`。
- 为缺失类型声明的 `@deepseek-ai/dsh-client-store` 增加 `src/dsh-shims.d.ts` 垫片（与宿主编译产物签名一致），`pnpm run typecheck` 恢复通过。

## [0.5.0] - 2026-08-26

### Changed

- **收藏数据不再写入 `settings.yaml`**：移除 Host 侧 settings 命名空间注册，数据改为持久化到 `$DSH_HOME/storages/dsh-my-favorites.json`（原子写、仅属主可访问、单写链串行化）。
- 客户端与宿主的通信从 `settingsScope` 迁移到 Typert Remote RPC：Host 新增手写 `./typert` 清单（`lib/typert.host.js`，由 typert-loader 自动注册）并提供 `myFavorites` 服务（`getState` / `setField`），客户端经 `ctx.remote.$mount` + `remote.myFavorites.*` 读写，`settingsScope` 契约保持不变。
- 从 0.4.x 升级时，原有 `settings.yaml` 中 `my-favorites` 段的数据需一次性迁移到 `~/.dsh/storages/dsh-my-favorites.json`（本机已完成迁移；插件本身不再读写 settings.yaml）。
- 依赖调整：移除 `@deepseek-ai/dsh-settings` 与 `@deepseek-ai/schemastery`，新增 `zod`（wire schema）与 `@deepseek-ai/dsh-home-paths`（存储路径解析）。

## [0.4.1] - 2026-08-26

### Added

- 网址收藏新增「启用收藏的网站」开关（默认开启）：关闭后侧栏不再显示网址快捷标签，仅保留会话收藏夹；已保存的网址收藏与设置项完整保留，重新开启即恢复显示。

### Changed

- 补齐开发依赖 `esbuild` 与 `@types/react-dom`，修复此前 `build` / `typecheck` 因缺失依赖而失败的问题。

## [0.4.0] - 2026-08-25

### Added

- 切换会话弹框显示所属工作区的项目名称：
  - 注入宿主 `workspaces` 服务，按 `sessionIds` 反查每个会话所属工作区，项目名取显式 `title`（缺失时回退路径 basename）。
  - 弹框列表每项右侧显示项目名标签（胶囊底色、次要文字色、超长省略）；顶部标题下方副标题同样优先显示项目名，替代冗长的 cwd 完整路径。
  - 订阅工作区变化，工作区增删/改名后实时刷新。

## [0.3.2] - 2026-08-25

### Changed

- 全部颜色收敛到 DSH 语义设计 token（`--dsw-alias-*`），插件样式随 UI 皮肤切换自动适配：
  - 删除不存在的 `--dsw-alias-brand-primary` / `bg-layer-1/2` token，主色改用 `--dsw-alias-state-business-primary`，浮层底色改用 `--dsw-specific-menu`（+ `border-inverted` + `shadow-lv3`）。
  - 危险色 → `state-error-primary`、警告/星标金 → `state-warn-primary`、反白前景 → `label-primary-inverted`、hover 背景 → `interactive-bg-hover`。
- 网址收藏 favicon 增加三重硬约束（`width/max-width/flex-basis` 固定 16px + `align-self`），杜绝超大 `.ico`（256×256）间歇性回退到固有尺寸撑破标签。
- 「★ 会话 (N)」折叠头与会话子项对齐 DSH 工作区 folder/row 观感：34px 分组头 / 32px 行高、8px 圆角、hover 高亮、16px 状态槽占位，展开箭头动画与字级对齐。
- 快捷键切换器弹框对齐 DSH 浮层菜单：面板底色随皮肤、列表项 reset `appearance`/`transparent`（修复浏览器默认 buttonface 灰底）、激活项改 `interactive-bg-hover`、底部提示弱化为 caption 字色 + 淡分隔线。

### Fixed

- 会话被宿主删除后，仅在会话列表「就绪」态下判定失效并清除收藏残留，避免列表 pending 期间误删有效收藏。

## [0.3.1] - 2026-08-24

### Fixed

- 侧边栏收起（折叠为 56px rail）后，收藏网址标签与「★ 会话 (N)」收藏夹仍以展开态渲染，文字横排挤压、与图标列错位。现改为消费宿主槽位下发的 `wide` 状态：折叠时不渲染任何收藏内容，并隐藏空容器避免残留间距；展开后恢复原样。

## [0.3.0] - 2026-08-24

### Added

- 会话切换器新增「最近模式」：在设置中可切换为「最近的 N 个会话」而非「收藏的会话」。
  - 排序源为浏览器内 LRU（最近访问），切换会话即时反映顺序；冷启动时以宿主 `updatedAt` 倒序兜底。
  - N 可配置（数字输入，范围 5–20，默认 10，失焦/回车自动 clamp 到边界）。
  - 过滤空会话（blank）与子 agent 会话（origin=subagent），仅保留可切换的顶层会话。
  - 边界场景（无目标可切）弹出短暂 toast 提示。

### Changed

- 设置页拆分为「会话切换」与「网址设置」两部分。
- 提取 `MIN_RECENT` / `MAX_RECENT` / `DEFAULT_RECENT` 常量到 `src/constants.ts`，作为边界值的单一事实来源。

### Removed

- 移除未使用的 `@deepseek-ai/cordis` 依赖（代码中无引用）。

## [0.2.0] - 2026-08-24

### Added

- 快捷键会话切换器：`⌘+⌥+`` `（macOS）或 `Ctrl+`` `（其它平台）。
  - 快速按：回溯到上一个收藏会话（不弹列表）。
  - 长按（约 0.25s）：弹出居中切换列表，继续按住循环高亮，松开确认切换，`Esc` 或点击遮罩取消。
  - 兼容死键（dead key）键盘：切换器不依赖 `` ` `` 的 keyup 事件。
- 侧栏收藏夹中，当前会话显示低调的激活标记（左侧品牌色竖条 + 品牌色标题）。

### Fixed

- 设置页“收藏网址”表单因缺少 `display:grid` 导致字段与“添加”按钮挤在一起。

## [0.1.0] - 2026-08-24

### Added

- 收藏或取消收藏当前 DSH 会话，并从侧栏收藏夹切换会话。
- 左侧侧栏“新会话”下方的可折叠会话收藏夹，支持 `⌘ Command` 拖动排序。
- 网址收藏：在系统浏览器打开、网站 favicon / 自定义 icon / 名称回退展示。
- 插件配置页中的网址收藏新增、编辑、删除和排序。
