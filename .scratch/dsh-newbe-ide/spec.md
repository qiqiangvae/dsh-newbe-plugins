# dsh-newbe-ide — 规格

**Status:** 设计已定稿，待实现
**原型:** [`prototype/dsh-newbe-ide.html`](../../prototype/dsh-newbe-ide.html)（一次性产物，定稿后丢弃，只保留选中的形态）

## 一句话

DSH 会话视图里的第四个 tab「IDE」（**对话 / 轨迹 / 上下文 / IDE**）：按项目组织**启动配置**，一键启停、日志留在浏览器里不进模型上下文——用来把"起服务/跑命令/看输出"这件事从 IntelliJ IDEA 搬到 DSH。

## 为什么做

用户不再想开 IDEA 起服务。证据（219 个 DSH 会话日志、3641 次 bash 调用）：

- `mvn spring-boot:run` / `java -jar` / `docker compose up` 在命令行里出现 **0 次**；服务一直是 IDEA 起的（`.idea/workspace.xml` 里有 `SpringBootApplicationConfigurationType` 运行配置）。
- 真实的高频循环是 `mvn -pl <mod> -am -o test -Dtest=<类>` 单类重跑（最多同一类重跑 7 次，90 条命令重复 ≥3 次），看输出靠 `2>&1 | tail -30`（206 次），`tail -f` **0 次**。
- IDEA 的 Spring Boot 运行配置里不只有模块和主类，还有 **5 个环境变量**（含一个 API Key）——不搬这些，服务起不来。

## 术语

| 术语 | 含义 | 不要叫 |
| --- | --- | --- |
| 项目 | DSH 工作区（`workspaceRegistry` 里的实体，有路径和标题） | 工程、repo、workspace |
| **启动配置** | 一条具名的可启动条目：名称 + 启动命令 + 工作目录 + 环境变量 | ~~命令~~、任务、run item |
| 启动命令 | 启动配置里那行 shell 字符串 | ~~脚本~~ |
| 面板 / 视图 | 会话视图 tab「IDE」，即 `conversation.view` 里 id=`dsh-newbe-ide`、order=30 的那一格（对话 0 / 轨迹 10 / 上下文 20）。**只读**：展示与操作（启停、看日志），不放任何输入控件 | 全局面板、侧栏入口 |
| 配置页 | 设置 → 插件 → IDE（`settings.plugins.tab`）：项目与启动配置的增删改都在这里 | 面板里的编辑表单 |
| 运行态 | 一条启动配置的当前进程状态：未启动 / 启动中 / 运行中 / 已停止 / 启动失败 | 状态机 |
| 日志 | 该启动配置进程的 stdout+stderr 合并流 | 输出、terminal |

## 结构

```
会话视图 tab「IDE」（对话 / 轨迹 / 上下文 / **IDE**）—— 只读
├─ 一级 tab：项目（角标 = 该项目启动配置条数；状态点 = 聚合状态）
│   └─ 二级 tab：启动配置（各自独立启停/重启、端口/PID/时长、日志、环境变量）
├─ 「总览」tab          ← 配置项，默认关；按项目分卡，卡内逐条列启动配置
└─ 工具条：只看运行中 · 总览 tab 开关 · » 溢出菜单（全部 tab） · ＋添加项目
```

- 二级 tab 位置：**独立一行**（原型变体 A）。
- 头部一行：`● 项目名` `[二级 tab 或 / 配置名]` `端口` `PID` `运行时长` `重启` `停止`。
- **视图占满面板**：本视图在场时收起底部的消息输入框（`[data-composer-seat]`），与 上下文 tab 的行为一致。DSH 没有按视图隐藏输入框的 API（`conversation.composer` 链的 `select` 只能拿到 `sessionId`/`session`/`pendingInteraction`），因此与 `dsh-context` 同法用 CSS `:has()` 按视图根元素收起，并保留承载审批/追问/计划复核时的输入框。
- **视图里不出现输入控件**（对齐 `dsh-context`：它的视图里同样 0 个输入框）。配置在 设置 → 插件 → IDE 里改，视图每 3 次轮询顺带重读一次配置，因此设置页的改动近乎即时可见。
- tab 管理对齐主流 IDE：横向滑动（滚轮/拖动）、`»` 溢出菜单、`×` 关闭、只看运行中。
- 配置页：项目增删（从 DSH 工作区里挑）、每个项目下启动配置增删改（名称 / 启动命令 / 工作目录 / 环境变量），保存有反馈，失败回滚到磁盘真实状态。

## 持久化

- 单一存储：`$DSH_HOME/storages/dsh-newbe-ide.json`，权限 **0600**，原子写（tmp + fsync + rename）。
- 存：项目 tab 列表与顺序、每个项目的启动配置（名称/启动命令/工作目录/环境变量）、`总览 tab` 开关。**不存**视图的选中项——它是视图状态；也因此**视图从不写配置，只有设置页写**（单写者，避免两个面整份写盘互相覆盖）。
- **不存**：日志（日志落 `$DSH_HOME/storages/dsh-newbe-ide/logs/<键>.log`，键 = `workspaceId/configId` 经百分号编码——可逆且不会撞车；纯 append，超 8MB 轮转成 `.1` 只留一代，读尾部时两代都读）、进程状态（重启后一律未启动）。
- 密钥：环境变量里 `*_KEY`/`*_SECRET`/`*_TOKEN`/`*PASSWORD` 的值在 UI 掩码，进程日志里也掩码。
- **不做**项目内配置文件（`.dsh/ide.json`）：环境变量含密钥，放项目里有被提交的风险。全部集中在 DSH home。

## 进程语义

- 启动：`shell.resolve(request)` → `shell.start(spec)`；工作目录 = 项目路径。
- 停止：`ShellProcess.kill()`；超时未退再 SIGKILL。
- **实测结论**：DSH 的 shell 服务把每次运行放进独立进程组（`pgid == 顶层 pid`），杀组能连孙进程一起回收——所以 `mvn spring-boot:run` fork 出的 java 不会变孤儿占端口。
- 插件禁用 / DSH 退出：组合销毁时自动回收仍在跑的进程（`ctx.effect` 兜底再杀一次）。
- 重启 = 停止 + 启动。

## 迁移：从 IDEA 导入

扫项目根 `.idea/workspace.xml`（与 `.run/*.xml`），把 `SpringBootApplicationConfigurationType` 读成启动配置：

| IDEA 字段 | 变成 |
| --- | --- |
| `<module name>` | `-pl <module>`（**不能带 `-am`**） |
| `SPRING_BOOT_MAIN_CLASS` | `-Dspring-boot.run.main-class=<主类>` |
| `<envs><env name value>` | 环境变量（值原样，密钥掩码显示） |
| 配置名 | 启动配置名称 |

生成的启动命令形如 `mvn -o -pl kun-ai-web spring-boot:run -Dspring-boot.run.main-class=com.pingpongx.kun.ai.web.KunAiApplication`，导入后可编辑。

**为什么不能带 `-am`（实测踩过）**：`-am` 会把目标模块的上游工程（父工程与依赖模块）一起放进 reactor，而 `spring-boot:run` 这类 CLI 目标会对 reactor 里**每一个**工程执行，于是先在「没有主类的聚合工程」上失败：
`Unable to find a suitable main class, please add a 'mainClass' property`。依赖模块缺失时，先跑一次 `mvn -o -pl <module> -am install -DskipTests` 装进本地仓库，再单独对目标模块 `spring-boot:run`。

## 明确不做

语义引擎 / 符号索引、调用图、源码跳转、调试器（断点、单步、远程调试）、测试报告解析、多服务编排、自动探测 pom 猜命令、i18n、agent 可见性（v1 纯人用；`tools.register` 与 `systemPrompt.context` 是预留入口，但不建抽象层）。

## 验收标准（可观察）

1. 会话视图 tab 排里出现第四个 tab「IDE」（对话 / 轨迹 / 上下文 / IDE），点进去是**只读控制台**（无输入控件）；设置 → 插件 → IDE 里能增删改项目与启动配置；DSH 重启后配置与顺序仍在（持久化生效）。
2. 一个项目下建两条启动配置，分别启停互不影响；一级 tab 状态点为聚合。
3. 日志实时滚动；`ERROR` 过滤只剩匹配行；`仅看匹配` / 正则 / level 徽章都生效。
4. 点停止后 `ps aux | grep java` 无该项目残留，端口释放。
5. 从 `.idea/workspace.xml` 导入 `kun-ai`，生成的启动配置能直接启动成功（含 5 个环境变量）。
6. 关掉 DSH 无残留 java 进程；再次启动 DSH 时启动配置完整恢复。

## 技术要点（已实证，不是推测）

- 面板承载点：`conversation.view`（list，scope=session，注册 `{ id, order, label }`）——运行时 slot 树已确认占用者 对话 0 / 轨迹 10 / 上下文 20，`dsh-context` 插件是第三方先例；本插件注册 id `dsh-newbe-ide`、order 30、label「IDE」。
- Host：`shell`（`resolve`/`start`/`ShellProcess.readOutput`/`kill`）、`workspaceRegistry.list()`、`settings`、`clientModules`。
- Client：`host.call`、`styles.insert`、`ctx.interval`、`React.createElement`；注册点 `conversation.view`（只读视图）与 `settings.plugins.tab`（配置页，兄弟包 `dsh-newbe-my-favorites` 同样用它）。
- 打包契约：`dsh.bundle.patch` + `dsh.client`（`exports["./client"]` + `platform: web`）、`lib/` 预构建且提交、安装不触发构建、不声明未发布的 `@deepseek-ai/dsh-client-*` 依赖。
- 已验证 DSH 版本：`0.1.5-alpha.2`。

## 待办（见 `issues/`）

竖切，每票都能单独演示：
01 面板 + 启动配置持久化（无阻断）· 02 一键启停 + 日志实时滚动（←01）· 03 日志过滤 + 落盘历史（←02）· 04 一个项目多条启动配置、两层 tab（←02）· 05 从 .idea 导入（←01,02）· 06 tab 滑动与隐藏 + 总览（←04）· 07 文档与发布（←03,04,05,06）
