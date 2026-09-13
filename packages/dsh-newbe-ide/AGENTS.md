# packages/dsh-newbe-ide

DSH Web 的会话视图 tab「IDE」：按项目组织启动配置，一键启停，日志留在浏览器里。
宿主半边管进程与落盘，客户端半边只有一个注册面（`conversation.view`）。

## 先读什么

- **术语与命名**：`CONTEXT.md`（本目录）。改动用词之前先看它的 `_Avoid_`。
- **行为为什么长这样**：`../../.scratch/dsh-newbe-ide/spec.md` 与 `issues/`。
  票的 `## Comments` 记着被推翻的方案与实测教训——"配置编辑该不该在面板里"反复过两次，
  照着某一版结论重做会白干。
- **惯例参考**：`../dsh-newbe-my-favorites/src/`（同为 TypeScript + esbuild + Typert 的插件）。

## 起手三件事

1. **改 `src/` 之后跑构建**。`lib/` 是已提交的预构建产物，安装时不构建——忘了这一步，
   装上去的仍是旧代码。完成标准：`lib/` 的三个产物时间戳都晚于你最后一次 `src/` 改动。
2. **跑本包验证**：`pnpm run check`（tsc --noEmit + `node --check` ×3）与 `pnpm run test`。
   完成标准：两条都退出 0。
3. **动了共享模块再跑一次仓库根**：`pnpm -r run check`。完成标准：四个包全部 Done。

## 这个插件里容易踩的

**端点成对**。加一个宿主方法要同时改两处：`src/typert.ts`（宿主清单）与 `src/client.tsx` 的
`REMOTE_CONTRIBUTION`（客户端 descriptors）。`test/client.test.mjs` 会断言两边逐条一致，
它红了就是漏了一边。新端点还要**重启 `dsh web`** 才存在（端点在进程启动时装配），
客户端会把这种情况的 404 说成"重启后生效"。

**`typertRemote` 绑定必须是服务对象**。`value.service` 传服务名字符串，网关的 `readBinding`
会拒绝每一次调用（它校验 `Reflect.get(value,'service') === original`）。

**持久化字段必须带默认值**。在 `src/schema.ts` 里给持久化状态加字段时要 `.default(...)`：
老文件缺字段会被整份判为损坏，回退成空配置——等于把用户的启动配置全丢。
`test/store.test.mjs` 有一条专门守这个。

**单一写者**。只有面板写配置；再加第二个能写整份状态的面，两个面并发保存就会互相覆盖。
**这条对模型工具同样成立**：`ide_launch_save` 走 `store.submit(next)`，绝不直接改存储文件——
绕过 store 就会和面板的整份提交撞成读-改-写竞态，把用户刚在面板上改的东西冲掉。

**内置工具与 skill 都是运行时注册，装完即用**。工具 `ctx.get('tools').register(...)`、
skill `ctx.skills.register(...)`，都从宿主行进全局层，**不需要改任何 preset**。三个容易走偏的地方：
① 工具注册成**裸 JSON-Schema 对象**（本包解析不到 `@deepseek-ai/dsh-tools`，参数校验必须自己写在
`execute` 里，别指望 `defineTool`）；② 因此 **`output.schema` 必须是标准 JSON Schema**——逐属性
`required: true` 是 `defineTool` 的规格 DSL，裸注册交上去会被 `assertSupportedJsonSchema` 拒绝，
而且是在 **`dsh web` 启动时 fatal**（实测踩过：重启直接失败，web 起不来）。`required` 要写成字符串数组、
放在 object 节点上；可空用 `oneOf`（子集不支持 `type` 数组）；`test/tools.test.mjs` 复刻了这套子集校验守着。
③ skill **不能**改成往 `~/.agents/skills` 或包内 `skills/` 放文件——DSH 的六个 skill 根目录都不扫
已安装插件包，放文件等于没装（`@liustack/modsearch` 带了 `skills/` 却不在会话目录里，就是反例）。
工具的描述**每次请求都在上下文里**，所以描述写短、流程放 skill 正文。
**动完工具 schema，跑一次真校验器**（它只在全局 DSH 安装里、profile 里没有）：命令见
`../../.scratch/dsh-newbe-ide/issues/13-agent-configures.md` 的「实测教训」一节。
顺带：`dsh --profile web --dump-config` 只组装 YAML、**不跑 `apply()`**，不能拿它预检这类错误。

**密钥值永不经过模型、也不落插件存储**。`isSecretName` 命中的变量一律写成
`{ name, value: '', from: 'credential' }`：值由人在面板里填，宿主经 `credentials.set` 写进
`$DSH_HOME/.credentials.yaml`，启动时按名字 `resolve` 注入 env；取不到就**点名报错**，不许空值悄悄
跑起来。任何回执、列表、日志里出现密钥值都是 bug——`test/tools.test.mjs` 有断言守着。

**CSS 触发条件用 `.ide-view`**。收起底部消息输入框、把视图高度夹到面板高度，都挂在
`[data-conversation-scroll]:has(.ide-view)` 上；`.ide-root` 只是共用样式类，拿它当触发条件会波及另一个面。

**导入生成的命令不带 `-am`**。`-am` 会把上游工程放进 reactor，而 `spring-boot:run` 对 reactor 里
每个工程执行，先在没有主类的聚合工程上失败。原因写在 `src/ideaconfig.ts` 的头注释里。

**DSH 的 `ShellProcess` 没有 pid**。它只暴露 status / exitCode / done / readOutput / kill / sandbox。
面板因此显示端口（从输出里认）与运行时长（宿主记启动时刻），不显示 pid。

## 分层

纯函数模块（`lines` / `filter` / `ideaconfig` / `rundisplay` / `tools`）不碰 DOM、不碰进程、不读盘，
可以直接 `node --test`（`tools` 的宿主接缝全部挂在注入的 `IdeToolDeps` 上；`skill` 只有一段正文）。
其余各有各的接缝：`logsink` 真读写文件（用临时目录验证）、
`store` 用临时文件、`runtime` 注入假进程（实现 DSH 的 `ShellProcess` 形状）、
`index` 的 `apply` 注入假 ctx。

测试从 `lib/index.js` 取值，所以 `src/index.ts` 只导出**当前有消费者**的东西——
转发一批没人导入的类型会让"公开面"和实际用途对不上。
