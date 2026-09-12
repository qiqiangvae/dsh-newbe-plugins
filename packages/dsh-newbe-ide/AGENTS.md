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

**CSS 触发条件用 `.ide-view`**。收起底部消息输入框、把视图高度夹到面板高度，都挂在
`[data-conversation-scroll]:has(.ide-view)` 上；`.ide-root` 只是共用样式类，拿它当触发条件会波及另一个面。

**导入生成的命令不带 `-am`**。`-am` 会把上游工程放进 reactor，而 `spring-boot:run` 对 reactor 里
每个工程执行，先在没有主类的聚合工程上失败。原因写在 `src/ideaconfig.ts` 的头注释里。

**DSH 的 `ShellProcess` 没有 pid**。它只暴露 status / exitCode / done / readOutput / kill / sandbox。
面板因此显示端口（从输出里认）与运行时长（宿主记启动时刻），不显示 pid。

## 分层

纯函数模块（`lines` / `filter` / `ideaconfig` / `rundisplay`）不碰 DOM、不碰进程、不读盘，
可以直接 `node --test`。其余各有各的接缝：`logsink` 真读写文件（用临时目录验证）、
`store` 用临时文件、`runtime` 注入假进程（实现 DSH 的 `ShellProcess` 形状）、
`index` 的 `apply` 注入假 ctx。

测试从 `lib/index.js` 取值，所以 `src/index.ts` 只导出**当前有消费者**的东西——
转发一批没人导入的类型会让"公开面"和实际用途对不上。
