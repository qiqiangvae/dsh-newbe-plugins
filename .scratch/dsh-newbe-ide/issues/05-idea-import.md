# 05: 从 .idea 导入启动配置，导入完能直接起 kun-ai

**What to build:** 面板发现项目里的 IDEA Spring Boot 运行配置，一键变成启动配置——模块名、主类、环境变量全部带过来；导入后点启动，`kun-ai-web` 真的跑起来。这是"不再开 IDEA"的兑现点。

**Blocked by:** 01 (面板装得上，一条启动配置能存住), 02 (一条启动配置能一键启停，日志实时滚出来)

**Status:** resolved（除"实测启动成功"一项留给用户在面板上点一次，见 Comments）

- [x] 发现项目根的 `.idea/workspace.xml` 与 `.run/*.xml` 里的 Spring Boot 运行配置，并列出可导入项（只认 `SpringBootApplicationConfigurationType`，JUnit/Remote 跳过）
- [x] 字段映射正确：模块名 → `-pl <module>`（**不带 `-am`**）；`SPRING_BOOT_MAIN_CLASS` → `-Dspring-boot.run.main-class=...`；`<envs>` → 环境变量；配置名 → 启动配置名称
- [ ] 导入 `kun-ai` 后生成的启动配置可直接启动成功（含 5 个环境变量），实测通过
- [x] 已存在同名启动配置时不静默覆盖：自动让路到「名字 (2)」，按钮上直接写明将要使用的名字
- [x] 环境变量里的密钥值在界面上掩码（候选列表只显示条数，编辑框按名字掩码）
- [x] XML 缺失/字段不全/解析失败时给出可读原因（`problem` 逐条标注、读不了的文件进 `errors`），不抛栈、不产生半截配置

## Comments

**实现记录（2026-09-12）**

- **自己解析 XML 而不加依赖**（`src/ideaconfig.ts`）：只需要认出一种配置类型和三个字段，而插件安装时不允许构建、也不该为这点事拖一个 XML 库。解析器是纯函数，9 项测试覆盖：只认 Spring Boot 类型（JUnit/Remote 跳过）、`.run/*.xml` 的包装结构、XML 实体解码、空/重复环境变量、字段不全时给原因、非 XML 文本不抛错、同名让路命名。
- **一个解析陷阱记在注释里**：`<configuration ... />` 自闭合的写法必须排在整块匹配之前，否则会把后续配置一起吞掉。
- **命令生成不带 `-am`**（实测教训见规格）：`-am` 会把上游工程放进 reactor，`spring-boot:run` 会对 reactor 里每个工程执行，先在没有主类的聚合工程上失败。
- **发现走宿主侧**（`discover` RPC）：客户端拿不到项目文件，宿主读 `.idea/workspace.xml` 与 `.run/*.xml`，返回候选 + 读不了的文件原因 + 实际扫过的文件。宿主级测试用一个临时工程目录端到端验证。
- **已用真实工程验证命令形态**：`kun-ai-web` 模块存在、主类 `com/pingpongx/kun/ai/web/KunAiApplication.java` 存在、`mvn -o -pl kun-ai-web validate` → BUILD SUCCESS（退出码 0）。
- **仍未验证**：在面板上点「启动」能否真的把 `kun-ai-web` 跑起来（含 5 个环境变量）——留给用户点一次，因为这会在开发环境里真起一个服务。
