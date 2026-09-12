# 01: 面板装得上，一条启动配置能存住

**What to build:** 装完插件后会话视图里多出第四个 tab「IDE」（对话 / 轨迹 / 上下文 / IDE），点开是面板；面板按 DSH 工作区列出一级 tab（从工作区注册表里挑，不出现未注册目录）；能给一个项目新增一条启动配置（名称、启动命令、工作目录、环境变量）并保存；关掉 DSH 再启动，它还在。这一票不启动任何进程。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `dsh plugin --profile web add <本地路径>` 安装成功，会话视图 tab 排出现「IDE」（order 30，紧随 对话 / 轨迹 / 上下文），点击进入面板
- [ ] 一级 tab 只来自 DSH 工作区注册表（名称 + 路径），不出现未注册目录；移除 tab 不影响工作区本身
- [ ] 能给项目新增启动配置、编辑名称与启动命令、增删环境变量，保存后有可见反馈
- [ ] `⚙ 启动配置` 在头部行内展开，收起时零占位
- [ ] 关掉 DSH 再启动，启动配置、tab 顺序、总览开关完整恢复
- [ ] 存储文件权限 0600、写入原子（不产生半截文件）；文件损坏时降级为空配置 + 可见提示，不崩插件
- [ ] `lib/` 预构建并提交，安装不触发构建；不声明任何 `@deepseek-ai/dsh-client-*` 依赖
- [ ] `check` 接入根 `pnpm -r run check`，CI 绿；不改动另外三个包

## 决策（来自原型，不要重新发明）

启动配置的形状：

```ts
{ id: string, name: string, command: string, cwd: string, envs: { name: string, value: string }[] }
```

持久化形状：`{ projects: { workspaceId, path, title, configs[], activeConfigId }[], activeWorkspaceId, showOverview }`。

实现形态：TypeScript + esbuild（照 `dsh-newbe-my-favorites`），`lib/` 预构建提交。

## Comments

**实现记录（2026-09-12）**

- **承载点改为会话视图 tab**：本票最初写的是"全局面板 `main` + 侧栏图标"，后按用户指示改为 `conversation.view`（对话 / 轨迹 / 上下文 / **IDE**），注册为 id `dsh-newbe-ide`、order 30、label `IDE`。规格已同步。
- **保留多启动配置能力**：AC 只要求"能新增一条"，实现里 schema 与 UI 直接支持一个项目多条（新增/切换/删除）。这是按用户在评审中的明确要求（"一个项目一个 tab，项目里多个启动命令继续 sub tab 区分"）做的；二级 tab 的最终排布（独立一行）由 04 重做，本票的 chips 会被替换，不是最终形态。
- **对账规则**：持久化项目与 `workspaceRegistry` 对账——注册表已知时不渲染已失效的项目 tab，并给出可见提示与"移除这些配置"按钮；**注册表为空视为"尚未就绪"**，此时不做任何判失效，绝不静默删配置。
- **写失败回滚**：`commit()` 乐观更新后若落盘失败，重新 `load()` 回到磁盘真实状态；草稿只在写入成功后清除，避免"保存失败后再点保存提交同一份被拒载荷"。
- **验证证据**：`pnpm -r run check` 四包通过；本包 14 项 `node --test` 全绿——存储行为 6（往返/0600/损坏降级不覆盖/非法拒绝），Host 3（工作区映射、注册表缺失不崩、`typertRemote` 绑定满足网关 `readBinding`），客户端接线 5（bundle 自注册、tab 注册契约、`$mount` 失败降级、端点与宿主清单逐条一致）。
- **代码评审**：Standards 轴 10 条（含 1 条硬 bug：`typertRemote.service` 传字符串会让每次 RPC 抛 `gateway/binding-invalid`）与 Spec 轴 5 条（含乐观更新无回滚）已全部处理；多配置属 04 范围的重复，见上。
- **尚未验证**：装进 `~/.dsh/profiles/web` 后的真实渲染（需要重启 `dsh web`），以及真机上的读写往返。
