# 13: 让 agent 来配置（内置工具 + 内置 skill）

**要解决的问题:** 配一条能跑的启动配置太麻烦。实测的九步（总览 →「＋ 添加项目配置」→ 选路径 →「打开」→ `⚙ 配置` → 左列「＋ 启动配置」→ 改名称 → 手打命令 → 手打工作目录 → 逐条加变量 → 保存 → 启动），其中**命令与变量是没人手打得出来的那一步**：`mvn -o -pl kun-ai-web spring-boot:run -Dspring-boot.run.main-class=com.pingpongx.kun.ai.web.KunAiApplication` 加 5 个环境变量（含一个密钥）。

**结论：换作者，不是换表单。** 配置的作者从「人 + 启发式解析器」改成 **agent**：插件内置一个模型工具（写配置）+ 一个内置 skill（教它这个领域怎么配、什么不许做）。人保留面板作为查看与兜底手改的出口。

## 已定决策

**作者与入口**

- 工具从**宿主行**注册（`ctx.tools.register`），落在**全局层**：每个会话可见，**不需要改任何 preset**（`restrict()` 对全局上下文直接抛错，preset 也藏不掉）。
- skill 走**运行时注册**（`ctx.skills.register`，`source: 'runtime'`）：**装完即在会话目录里，零手工步骤**，不进 `~/.agents/skills`。
  DSH 的六个 skill 根目录**没有一个**会扫已安装插件包里的 `skills/`——`@liustack/modsearch`/`modlens` 都带了 `skills/` 却不在目录里，就是反证；`@mengyuly/dsh-ponytail` 用运行时注册，五个 skill 正常可见（活样本）。
- skill 正文与工具同包同版发布，**不可能出现"skill 说一套、工具做一套"**。
- 分工：**工具描述写短**（它的描述每次请求都在上下文里，全局可见是永久开销），**流程与约定写进 skill 正文**（目录行常驻，正文按需加载）。

**不做的事（明确砍掉）**

- **不写启发式推断**（扫 `package.json`/`pom.xml` 猜命令）。模型自己会读这些文件，为它写一套浅搜 + 推断 + 排序的代码是白干。
- **不做变量共享层**（变量组 / 项目级继承）。agent 能在多处同时改，重复的代价已经很小。
- **不删**「从 IDEA 导入」（`src/ideaconfig.ts` 107 行 + `discover` 端点 + 客户端导入 UI）。它技术上被 agent 覆盖了，但删它是同时改三条路，且宿主端点删了要重启 `dsh web` 才验证得了——先用两三次再说。

**密钥（本票里最危险的一处）**

- 密钥值**不写进 `~/.dsh/storages/dsh-newbe-ide.json`**，改走 DSH 原生凭据库：`CredentialRef` 的定义就是"POSIX 风格的环境变量名"，`ctx.get('credentials')` 在宿主进程里可用（`dsh-base/cordis.patch.yml:97` 挂着），磁盘是 `~/.dsh/.credentials.yaml`（0600）。
- 环境变量有两个来源：`literal`（明文值，写进插件存储）与 `credential`（只存**变量名**，启动时由宿主 `credentials.resolve(name)` 取值注入）。判断依据复用现成的 `isSecretName`。
- 工具**永不写密钥值**（硬拒绝，无逃生阀）：遇到 `isSecretName` 命中的变量只登记成凭据引用，并明确告诉 agent「值需要用户提供」。值只能由人在面板里输入，面板经宿主写进凭据库。
- **回执里永不出现密钥值**：写入成功只说"N 个变量，其中 M 个按凭据处理"。
- 启动时凭据缺失必须**报一条明确错误**（点名是哪个变量缺），不许空值悄悄跑起来。

**幂等与覆盖**

- 同一路径 + 同一配置名重复写入：内容一致 → **no-op**；不一致 → 更新，并在回执里说明**改了哪些字段**。
- 这是唯一同时做到"可重跑"和"不静默覆盖"的语义；「让路新建 `名字 (2)`」会堆重复条目（用户现在那两条空的「启动配置」就是这类堆积），「直接覆盖」会吃掉用户手调过的参数。

**验证闭环**

- 工具能启停并回执**结论**：状态、认出来的端口、失败时最后 ≤40 行错误。默认**不**把日志交给模型——不破坏"日志永不自动进模型上下文"这条既有不变量，失败时才把那一小段错误拉进来说清原因。

**人在回路**

- agent **直接写盘**（不设"待确认"队列）；面板给 agent 写的条目打**写入来源**标记。
- agent 只在**明确要求**时动手（用户说"把 X 配好"/ skill 被调用），不做"见到没配置的目录就自动配"。

**表单**

- 手搓表单**保留**（agent 猜错时唯一的即时出口），但「保存」从「名称」那一行挪到表单底部固定位置——它现在离命令/变量行太远，改完容易忘了点。

## 验收标准

- [ ] 装完即用：skill 出现在会话目录里，**不需要任何手工步骤**（不写 `~/.agents/skills`，不改 preset）
- [ ] 工具在**所有会话**可见，且不需要改 preset
- [ ] 工具描述短；流程细节在 skill 正文里
- [ ] 密钥：工具拒绝写入 `isSecretName` 命中的变量值，只登记凭据引用；回执里永不出现值；启动时凭据缺失 → 点名报错
- [ ] 幂等：同一路径 + 同一名称重跑 → 一致则 no-op，不一致则更新并说明改了哪些字段
- [ ] 面板：agent 写入的条目显示写入来源
- [ ] 启停经面板自己的运行注册表（状态/端口/日志与面板一致），失败时回执带最后 ≤40 行错误
- [ ] 单一写者不破：工具走 `store.submit`，不直接改 JSON 文件
- [ ] 旧「从 IDEA 导入」一行未动

## Comments

**事实核查（2026-09-13，只读）**

- 工具注册面：`ctx.tools` = `ToolRuntime`，`register(definition)` 返回 disposer；`defineTool` 要求必填 `output: { schema, render }`，参数用 DSH 自己的 JSON-Schema 风格 DSL（逐属性 `required: true`），**不是 zod**；发给模型的 schema 只有 `{name, description, parameters}`——**工具定义里没有 `dangerous`/`readOnly` 这类声明式护栏**，所以"先问用户"只能写死在 `execute` 里。第三方 `@liustack/modsearch` 直接注册**裸对象**即可（本包 `@deepseek-ai/dsh-tools` 不可解析，正好照这条走，不新增依赖）。
- 可见性链：`dsh-tools` 通过 `ctx.systemPrompt.tools(...)` 把 schema 交给每次请求 → `PromptAssembly.tools` → 请求的 `tools` 字段；全局行注册即全局可见。
- skill 面：`ctx.skills.register(SkillRegistration)`，需要 `name`/`description`/`source`/`content`，`source` 值形如 `'runtime'`；重复名"first-wins 并记一条警告、给一个 no-op disposer"。
- 凭据面：`CredentialProvider` 提供 `resolve(ref)` / `set(ref, value)` / `describe(ref)`（`{configured, source, writable}`，**视图里没有装值的地方**）；信任分层 `进程环境 > .credentials.yaml > invocation cwd/.env > $DSH_HOME/.env`，进程环境层只读。
- 已确认的取舍代价：凭据**按变量名寻址、全局一份**——将来两个项目需要同名不同值的密钥时必须改名。

**实现记录（2026-09-13）**

- 新增 `src/tools.ts`（纯逻辑 + 三个工具对象，宿主接缝全挂在注入的 `IdeToolDeps` 上）与 `src/skill.ts`（skill 正文）。
- 三个工具的粒度是按"一次往返解决一件事"切的：`ide_config_list`（读，无参）/ `ide_config_save`
  （写一条，同名幂等，`remove: true` 删一条）/ `ide_config_run`（启停查 + **等判决**）。
  描述写短是刻意的——它们每次请求都在上下文里；流程与 `-am` 那类约定放在 skill 正文里按需加载。
- 写路径复用既有的单一写者：工具 → `planSave`（纯函数，算出"下一份完整状态"与回执）→ `store.submit`。
  删配置前先按 `vanishedTargets` 停掉进程（否则进程没主人、端口占到 DSH 退出）。
- 密钥：`planSave.toEnvs` 里 `isSecretName` 命中的变量直接丢值写 `{ name, value: '', from: 'credential' }`，
  **没有逃生阀**。启动时 `specFor` 用 `ctx.get('credentials').resolve(name)` 取值注入 env，取不到就点名报错。
  面板侧新增两个端点 `secretInfo`（只回 `{configured, writable, source}`）与 `secretSet`
  （人填的值直接 `credentials.set` 进 `$DSH_HOME/.credentials.yaml`）。
- schema 新增两个**带默认值**的字段：`launchConfig.origin`（human/agent）与 `envVar.from`（literal/credential）。
  老文件缺它们时读回来是 `human` / `literal`——`test/store.test.mjs` 加了一条专门守"老文件不被判损坏、
  明文值原样留着"。
- 面板：`from: 'credential'` 的变量行显示"凭据 / 已配置（来源）/ 未配置" + 掩码输入 + 「存凭据」；
  agent 写的条目在左列与表单里带「agent」标记（人保存一次就归人，标记消失）；「保存」从「名称」行挪到表单底部。
- 测试 101 项全绿（新增 `test/tools.test.mjs` 14 项 + `test/host.test.mjs` 4 项集成：
  apply 即注册好工具与 skill、agent 写配置后面板读得到且密钥不落盘、凭据缺失时不启动进程、
  `secretInfo/secretSet` 不回传值）。
- `lib/` 三个产物已重建；`pnpm run check` 与 `pnpm -r run check` 四条全 Done。
  **真机验证要重启 `dsh web`**（宿主端点与工具在进程启动时装配）。

**已知未做（下一步）**

- 「从 IDEA 导入」那条路仍然把 `.idea/workspace.xml` 里的密钥**明文**写进配置（`from: 'literal'`）。
  本票 Q9 决定不动导入路径，所以留着。想摘掉现有那份明文值：让 agent 重写一遍那条配置
  （`ide_config_save` 会把密钥变量改成凭据引用），再在面板里把值填进凭据库一次即可。

**实测教训：裸注册的工具 schema 必须是标准 JSON Schema（2026-09-13，重启失败）**

第一次重启 `dsh web` 直接 **fatal load failure**：

```
JsonSchemaError: unsupported JSON schema: schema.properties.projects.required is not supported on type "array"; …
    at assertSupportedJsonSchema (dsh-tools/lib/index.js:325)
    at Proxy.register (dsh-tools/lib/index.js:2777)
```

根因：三个工具的 `output.schema` 写成了**逐属性 `required: true`**——那是 `defineTool` 的*规格 DSL*，
由 `valueSchemaSpecToJsonSchema` 负责转换；而我们注册的是**裸对象**（本包 resolve 不到
`@deepseek-ai/dsh-tools`），没人替我们转，`assertSupportedJsonSchema` 当场拒绝。

**为什么之前的验证没抓住**：`test/host.test.mjs` 用的是**假 tools 服务**（只记录 `register` 收到了什么），
于是证明的是"我以为的契约"，不是真契约。教训：只在假实现上验证的接缝，等于没验证。

**改法与守卫**

- 三份 schema 重写为标准 JSON Schema：`required` 改成字符串数组放在 object 节点上；
  `exitCode` 可空用 `oneOf: [{type:'number'},{type:'null'}]`（子集不支持 `type` 数组）。
- `test/tools.test.mjs` 增加一条**复刻该子集**的检查（对应 `dsh-tools` 的 `checkSchemaNode`）：关键字白名单、
  `required` 必须是字符串数组且名字都在 `properties` 里、`properties`/`required`/`additionalProperties`
  只许出现在 object 上、`items` 只许出现在 array 上、`type` 不能是数组。
  **做过变异测试**：把 `required: true` 植回一个 array 属性 → 该测试变红（报
  `ide_config_list.output.schema.properties.projects.required 不支持类型 array`），还原后 103 项全绿。

**改工具 schema 之后的真校验**（`dsh-tools` 只在全局 DSH 安装里、profile 里没有，所以做成一次性命令）：

```bash
cd packages/dsh-newbe-ide && DSH_HOME=$(mktemp -d) node --input-type=module -e '
const B="/Users/qiqiang/.local/share/fnm/node-versions/v22.20.0/installation/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai";
const { assertSupportedJsonSchema } = await import(B+"/dsh-tools/lib/index.js");
const { createIdeTools } = await import("./lib/index.js");
const t = createIdeTools({ state:()=>({projects:[],activeWorkspaceId:"",showOverview:false}), runs:()=>[], apply:async n=>n, start:async()=>{}, stop:async()=>{}, tail:()=>[] });
for (const x of t) for (const s of [x.parameters, x.output.schema]) assertSupportedJsonSchema(s);
console.log("6/6 通过");'
```

同一轮还拿**真类**（不是桩）验过另外三处装载期路径：`ToolRuntime.register` 三个工具全部注册成功、
且出现在 `rt.schemas()`；真 cordis 下 `ctx.provide` 晚挂载会触发 `internal/service`（`whenService` 依赖它）；
`SkillRegistry.register(IDE_SKILL)` 通过 `validateRuntimeSkill`，`list()` 里能看到 `ide-config`。

**注意**：`dsh --profile web --dump-config` **只组装 YAML、不跑 `apply()`**（`apply` 第一句的日志不出现），
所以它**不能**用来预检这类错误——别拿它当"启动前自检"。

**命名收敛到「启动配置」模块（2026-09-13，用户要求）**

插件叫 IDE、将来还会有别的模块（任务、调试…），所以模型可见的名字只声明自己管的那一块，
不占 `ide_*` 总前缀、也不叫笼统的 `config`：

| 旧 | 新 | 为什么 |
| --- | --- | --- |
| `ide_config_list` | **`ide_launch_list`** | 列的是启动配置（连同它们的项目配置） |
| `ide_config_save` | **`ide_launch_save`** | 写的是启动配置；路径未知时顺带建项目配置 |
| `ide_config_run` | **`ide_launch_run`** | 跑的是启动配置 |
| skill `ide-config` | **skill `ide-launch-config`** | 同上；斜杠命令变成 `/ide-launch-config` |

描述一并收紧（它们每次请求都在上下文里）：
`list` 247→218、`save` 383→313、`run` 247→245、skill 描述 ~124→101 字符。
`run` 的描述同时改得更准：原来的"a detected port means it came up"是**过度承诺**——端口是从输出里
正则认的，一个进程开多个端口时会认错（实测：`ai-review-agents` 认成了 Prometheus 的 7999，
API 其实在 8080，见 `src/rundisplay.ts` 的 `parsePort` 只认 `\bport\s+(\d+)`，而 uvicorn 横幅
`running on http://0.0.0.0:8080` 里没有 "port" 这个词）。现在描述说的是机制："在输出里认到端口、
或进程退出时给判决"。

**没有跟着改的**：宿主服务名与端点命名空间仍是 `ideConfig`（`remote.ideConfig.*`、`ideConfig/load`…）。
它是**面板级**的存储/运行服务，不是模型可见的名字，将来别的模块进来时再按模块拆；
这次改它只会同时动 typert + 客户端 + 测试三处，收益是零。

**已验证**（真类，不是桩）：`ToolRuntime.register` 收到的是
`["ide_launch_list","ide_launch_save","ide_launch_run"]` 且六份 schema 仍过 `assertSupportedJsonSchema`；
`SkillRegistry.register` 通过 `validateRuntimeSkill`，`list()` 里是 `["ide-launch-config"]`；
`pnpm run check` + 103 项测试全绿。
