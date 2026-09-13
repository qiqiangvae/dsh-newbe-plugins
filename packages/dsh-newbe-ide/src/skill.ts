/**
 * 内置 skill：教 agent 怎么把「这个目录怎么跑起来」写进 IDE 面板的**启动配置**模块。
 *
 * 命名收敛到「启动配置」：插件叫 IDE，将来还会有别的模块（任务、调试…），
 * 所以工具与 skill 都只声明自己管的这一块，不占 `ide_*` 这个总前缀。
 *
 * 为什么走运行时注册（`ctx.skills.register`）而不是往 `~/.agents/skills` 放一份：
 * 用户的要求是**装完即用**。DSH 的六个 skill 根目录没有一个会扫已安装插件包里的 `skills/`
 * （`@liustack/modsearch`/`modlens` 都带了 `skills/` 却不在会话目录里，就是反证），
 * 而运行时注册随包发布、零手工步骤，且**与工具同版本**——不可能出现 skill 说一套、工具做一套。
 *
 * 正文用中文：它讲的是本机项目（Maven 聚合工程、IDEA 运行配置、子模块目录）的约定，
 * 而工具描述保持英文，与 DSH 自带工具一致。
 */

const IDE_SKILL_NAME = 'ide-launch-config';

const IDE_SKILL_DESCRIPTION =
  '把某个目录的启动方式写进 DSH IDE 面板的一条启动配置：定位工作目录与命令、登记环境变量（密钥只登记名字），再启动一次验证。' +
  '用户要把某个服务或目录跑起来、嫌命令行太长、或问某个目录怎么启动时用它。';

const IDE_SKILL_BODY = `# 把目录配成 IDE 面板里的启动配置

IDE 面板（会话视图的 tab「IDE」）按项目组织**启动配置**：一条 = 名称 + 启动命令 + 工作目录 + 环境变量。
人在面板上点「启动/停止/重启」，日志留在面板里——**日志不会自动进你的上下文**。

你的活是把配置**写对**：找到真正该跑的目录和命令，写进去，启动一次证明它能跑。

## 什么时候动手

- 用户说"把 X 跑起来 / 配一下 X / 帮我加条启动配置 / 这个命令太长了"。
- 用户正想跑某个目录，而面板里还没有它的启动配置。

**不要**在没被要求的时候自己翻目录去配东西。

## 流程

1. \`ide_launch_list\` 先看面板里已有什么（路径、名字、命令、状态、端口）。
   同名就是同一条配置，别重复建；已经有能跑的就跳到第 6 步。

2. 找出**真正该跑的目录**。这一步最容易错：**工作目录往往是子模块目录，不是仓库根**
   （例：仓库根 \`/repo\` 下真正要跑的是 \`/repo/kun-ai\`，命令还得再指到 \`kun-ai-web\` 模块）。

3. 按目录里的清单文件决定命令形状：

   - **\`pom.xml\`**：根 pom 是 \`<packaging>pom</packaging>\` 就是聚合工程，能跑的是带
     \`@SpringBootApplication\` 的子模块。命令形状：
     \`mvn -o -pl <模块> spring-boot:run -Dspring-boot.run.main-class=<全限定类名>\`。
     **不要加 \`-am\`**：它会把上游工程一起放进 reactor，而 \`spring-boot:run\` 对 reactor 里每个工程执行，
     先在没有主类的聚合工程上失败。
   - **\`package.json\`**：看 \`scripts\` 里的 \`dev\` / \`start\` 与 README 里那句"本地启动"；
     有 \`.nvmrc\` / \`packageManager\` 时注意 node 版本。包的目录就是工作目录。
   - **\`pyproject.toml\` + \`uv.lock\`**：\`uv run <模块/命令>\`。应用自己读 \`.env\` 时
     （\`pydantic-settings\` 的 \`env_file\`），**一个变量都不用往面板里抄**。
   - **\`.idea/workspace.xml\`**：往往就是现成答案（模块名、主类、环境变量都在），先读它再自己拼。
   - **什么都没找到**：看 \`README.md\` 与 \`scripts/*.sh\`，并区分"常驻服务"与"一次性脚本"——
     \`./scripts/setup.sh --link\` 那种跑完就退出的，不该配成启动配置。

4. 环境变量：**只抄变量名**。名字里含 KEY / SECRET / TOKEN / PASSWORD 的，
   **不要读它的值、不要写进配置或消息**——\`ide_launch_save\` 只登记名字，值由用户在面板里填
   （面板写进 DSH 凭据库，不落面板存储）。

5. \`ide_launch_save\` 写进去（一次一条）。同名幂等：内容一致就是 no-op，不一致会告诉你改了哪些字段。

6. \`ide_launch_run\` 启动并等判决；失败时回执带最后几十行输出，照它修。**注意它报的端口是从输出里认的**，
   一个进程开多个端口时（例如指标端口先打印）可能认错，必要时向用户核实。

7. 回报用户：配了什么、在哪个目录、跑没跑起来、端口多少，以及**有什么需要他做的**
   （典型情况：填密钥；或者命令里某个参数只有他知道）。

## 硬边界

- **不要直接编辑** \`~/.dsh/storages/dsh-newbe-ide.json\`。写配置只走 \`ide_launch_save\`：
  面板是唯一写者、整份原子提交，绕过它自己改文件会和面板撞成读-改-写竞态，把用户刚改的东西冲掉。
- **密钥值永远不经过你**。工具会丢掉密钥值，你也别去读 \`.env\` 或 \`.idea/workspace.xml\` 里的密钥值。
- **不要删用户的配置**（\`remove: true\`）除非用户明确要求删哪一条。
- 工作目录留空会回落到项目路径；写的时候别留空，除非确实就是项目根。
- 同一个路径在面板里可能有多条项目配置（人手工建的），工具按路径找**第一条**。
`;

/** 注册进去的那个对象：字段与 `@mengyuly/dsh-ponytail` 的活样本一致。 */
export const IDE_SKILL = {
  name: IDE_SKILL_NAME,
  description: IDE_SKILL_DESCRIPTION,
  source: 'runtime',
  content: IDE_SKILL_BODY,
  invocation: { modelInvocable: true, userInvocable: true },
};
