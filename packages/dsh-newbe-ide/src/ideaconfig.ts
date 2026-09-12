/**
 * IDEA 运行配置解析：从 `.idea/workspace.xml` 与 `.run/*.xml` 里认出 Spring Boot 配置，
 * 并生成可以直接执行的 Maven 命令。
 *
 * 为什么要自己解析而不加依赖：只需要认出一种配置类型和三个字段，
 * 而插件安装时不允许构建、也不该为这点事拖一个 XML 库进来。
 *
 * **生成命令不能带 `-am`**（实测踩过）：`-am` 会把目标模块的上游工程一起放进 reactor，
 * 而 `spring-boot:run` 这类 CLI 目标会对 reactor 里每一个工程执行，
 * 于是先在没有主类的聚合工程上失败：Unable to find a suitable main class。
 */

import type { EnvVar, IdeaCandidateView, LaunchConfig } from './schema.js';

/** 解析结果就是 wire 候选去掉 `source`（那是扫描时补的）。 */
export type IdeaCandidate = Omit<IdeaCandidateView, 'source'>;

/** 生成的启动配置 = 启动配置去掉 id（id 由调用方发）。 */
export type BuiltLaunchConfig = Omit<LaunchConfig, 'id'>;

const SPRING_BOOT_TYPE = 'SpringBootApplicationConfigurationType';

/** 自闭合的写在前面：否则 `<configuration ... />` 会匹配到"第一个 >"后面的内容，把后续配置一起吞掉。 */
const CONFIGURATION_BLOCK = /<configuration\b[^>]*\/>|<configuration\b[^>]*>[\s\S]*?<\/configuration>/g;

/** XML 实体解码；`&amp;` 必须最后解，否则 `&amp;lt;` 会被二次解码成 `<`。 */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 从一段标签里取属性值；属性名要求后接 `=`，因此 `factoryName=` 不会被当成 `name=`。 */
function attribute(tag: string, name: string): string {
  const found = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return found === null ? '' : decodeEntities(found[1]);
}

export function parseSpringBootConfigurations(xml: string): IdeaCandidate[] {
  const blocks = xml.match(CONFIGURATION_BLOCK) ?? [];
  const candidates: IdeaCandidate[] = [];

  for (const block of blocks) {
    const openTag = /<configuration\b[^>]*>/.exec(block)?.[0] ?? block;
    if (attribute(openTag, 'type') !== SPRING_BOOT_TYPE) continue;

    const module = attribute(/<module\b[^>]*>/.exec(block)?.[0] ?? '', 'name');
    const mainClass = attribute(
      /<option\b[^>]*name\s*=\s*"SPRING_BOOT_MAIN_CLASS"[^>]*>/.exec(block)?.[0] ?? '',
      'value',
    );

    const envs: EnvVar[] = [];
    for (const envTag of block.match(/<env\b[^>]*?\/?>/g) ?? []) {
      const key = attribute(envTag, 'name');
      if (key === '') continue;
      const value = attribute(envTag, 'value');
      const seen = envs.findIndex((entry) => entry.name === key);
      if (seen >= 0) envs[seen] = { name: key, value };
      else envs.push({ name: key, value });
    }

    const problems: string[] = [];
    if (module === '') problems.push('缺少模块名（<module>）');
    if (mainClass === '') problems.push('缺少主类（SPRING_BOOT_MAIN_CLASS）');

    candidates.push({
      name: attribute(openTag, 'name') || module || '未命名配置',
      module,
      mainClass,
      envs,
      problem: problems.join('；'),
    });
  }

  return candidates;
}

/** 把候选配置变成启动配置：模块 → `-pl <模块>`，主类 → run 目标参数。 */
export function buildLaunchConfig(candidate: IdeaCandidate, projectPath: string): BuiltLaunchConfig {
  // `-o`（离线）：与规格一致，也是本项目一贯的跑法——依赖都已在本机仓库里。
  const parts = ['mvn', '-o'];
  if (candidate.module !== '') parts.push('-pl', candidate.module);
  parts.push('spring-boot:run');
  if (candidate.mainClass !== '') parts.push(`-Dspring-boot.run.main-class=${candidate.mainClass}`);
  return {
    name: candidate.name,
    command: parts.join(' '),
    cwd: projectPath,
    envs: candidate.envs.map((entry) => ({ ...entry })),
  };
}

/**
 * 导入时的命名规则：同名不覆盖，改成 `名字 (2)`、`名字 (3)`…
 * 静默覆盖会毁掉用户手改过的启动配置，所以这里只让路、不覆盖。
 */
export function plannedConfigName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  let index = 2;
  while (taken.includes(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
}
