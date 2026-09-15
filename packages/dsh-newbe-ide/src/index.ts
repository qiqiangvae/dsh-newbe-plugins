/**
 * dsh-newbe-ide Host 侧：
 * 1. 启动配置持久化到 `$DSH_HOME/storages/dsh-newbe-ide.json`（原子写、0600）。
 * 2. 提供 `ideConfig` 服务，经手写 Typert 清单
 *    （./typert → lib/typert.host.js，由 typert-loader 自动注册）暴露给 Web 客户端。
 *
 * 3. 运行受管进程：`start` / `stop` / `read` / `runs`（输出实时泵入环形缓冲并落盘，
 *    跨 DSH 重启可用 `history` 读回），以及 `discover`（扫项目里的 IDEA 运行配置）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { createConfigStore } from './store.js';
import { createRunRegistry, type RunSpec } from './runtime.js';
import { createFileLogSink } from './logsink.js';
import { parseSpringBootConfigurations } from './ideaconfig.js';
import { IDE_SKILL } from './skill.js';
import { createIdeTools, vanishedTargets, type IdeToolDeps } from './tools.js';
import { DEFAULT_HISTORY_LINES, runKeyOf, type IdeaDiscovery, type IdeLoad, type IdeProjectView, type IdeState, type LogHistory, type LogHistoryRequest, type RunRead, type RunSnapshot, type SecretStatus } from './schema.js';

export { createConfigStore } from './store.js';
export { DEFAULT_HISTORY_LINES, availableWorkspaces, basenameOf, defaultState, pickActiveConfig, runKeyOf, uniqueTitle } from './schema.js';
export { cleanLine, isSecretName, maskSecrets, splitLines } from './lines.js';
export { DEFAULT_LEVELS, LEVELS, compileMatcher, filterLines, levelOf } from './filter.js';
export { createFileLogSink } from './logsink.js';
// 只导出有消费者的东西：测试是 .mjs（导入值），客户端直接从各自模块取类型，
// 因此这里不再转发类型（曾经转发过一批，0 个消费者）。
export { aggregateStatus, formatUptime, parsePort, readLostLines } from './rundisplay.js';
export { buildLaunchConfig, parseSpringBootConfigurations, plannedConfigName } from './ideaconfig.js';
export { createRunRegistry } from './runtime.js';
export { awaitVerdict, createIdeTools, planSave, resolveTarget, toolView, vanishedTargets } from './tools.js';
export { IDE_SKILL } from './skill.js';

/** 持久化文件：$DSH_HOME/storages/dsh-newbe-ide.json。 */
export const STORAGE_PATH = dshHomePath('storages', 'dsh-newbe-ide.json');

export const name = 'dsh-newbe-ide';

/** 从 DSH 工作区注册表取可选项目；注册表尚未就绪时返回空列表，面板显示空态而不是崩。 */
function listProjects(ctx: any): IdeProjectView[] {
  const registry = ctx.get('workspaceRegistry');
  if (registry === undefined) return [];
  const projects: IdeProjectView[] = [];
  for (const workspace of registry.list()) {
    projects.push({
      workspaceId: String(workspace.id),
      title: String(workspace.title),
      path: String(workspace.path),
    });
  }
  return projects;
}

export function apply(ctx: any): void {
  const store = createConfigStore(STORAGE_PATH);
  // 日志落盘：$DSH_HOME/storages/dsh-newbe-ide/logs/<键>.log（保留一代 .1）
  const sink = createFileLogSink(join(dirname(STORAGE_PATH), 'dsh-newbe-ide', 'logs'));
  const registry = createRunRegistry(() => ctx.get('shell'), { sink });
  console.log(`[dsh-newbe-ide] 存储文件：${STORAGE_PATH}`);

  // 定时把在跑进程的输出读进缓冲：客户端轮询只是取，不负责采集，避免读得太慢丢输出。
  // **这个间隔不能随便放大**：DSH shell 侧每个流只有 64,000 B 的内存尾窗（实测均值 145.68 B/行
  // ≈ 439 行），窗口溢出后多出来的部分会被丢掉（就是面板上那个"早期部分已丢弃"）。
  // 250ms 对应约 1,750 行/秒的安全线，500ms 会掉到约 880 行/秒——比用户假设的峰值还低。
  // 想省 CPU 应该从"别重复 drain"入手（见 runtime.snapshots），不是放大这个间隔。
  ctx.effect(() => {
    const timer = setInterval(() => registry.pump(), 250);
    return () => {
      clearInterval(timer);
      registry.dispose();
    };
  }, 'dsh-newbe-ide: run pump');

  /**
   * 从持久化配置里取出要跑的命令；找不到就把原因说清楚，而不是抛栈。
   *
   * `from: 'credential'` 的变量**值不在面板的存储里**：按变量名去 DSH 凭据库取
   * （`$DSH_HOME/.credentials.yaml`，服务键 `credentials`）。
   * 取不到就报一条点名错误——绝不空值悄悄跑起来（空的环境变量会让进程用默认配置启动，
   * 那种"跑起来了但连的是错的库"最难查）。
   */
  async function specFor(target: { workspaceId: string; configId: string }): Promise<RunSpec> {
    const state = store.getState();
    const project = state.projects.find((p) => p.workspaceId === target.workspaceId);
    if (project === undefined) throw new Error('这个项目不在面板配置里');
    const config = project.configs.find((c) => c.id === target.configId);
    if (config === undefined) throw new Error('找不到这条启动配置');
    const envs: { name: string; value: string }[] = [];
    const missing: string[] = [];
    for (const entry of config.envs) {
      if (entry.name === '') continue;
      if (entry.from !== 'credential') {
        envs.push({ name: entry.name, value: entry.value });
        continue;
      }
      const provider = ctx.get('credentials');
      const resolved = provider === undefined ? undefined : await provider.resolve(entry.name);
      if (resolved === undefined || resolved.value === '') {
        missing.push(entry.name);
        continue;
      }
      envs.push({ name: entry.name, value: resolved.value });
    }
    if (missing.length > 0) {
      throw new Error(`凭据库里没有 ${missing.join('、')}：需要在面板的配置块里填入值（值只写进 DSH 凭据库，不落面板存储）`);
    }
    return { command: config.command, cwd: config.cwd !== '' ? config.cwd : project.path, envs };
  }

  /**
   * 唯一写者：落盘，并把**在新状态里已经消失的启动配置**的日志一并删掉。
   * 两条路都必须走这里——面板 RPC（`submit`）与模型工具（`IdeToolDeps.apply`）：
   * 绕过去就会留下谁也够不着的孤儿日志（键已不在状态里，面板再也指不到它）。
   * 停进程由调用方负责（面板的 removeConfig/removeProject、工具 save 里的 vanishedTargets 循环都停过）。
   */
  async function applyState(next: unknown): Promise<IdeState> {
    const before = store.getState();
    const saved = await store.submit(next);
    for (const target of vanishedTargets(before, saved)) sink.remove(runKeyOf(target));
    return saved;
  }

  const service = {
    load(): IdeLoad {
      return { config: store.getState(), projects: listProjects(ctx), warning: store.warning };
    },
    submit(next: unknown): Promise<IdeState> {
      return applyState(next);
    },
    /** 启动是异步的：`from: 'credential'` 的变量要等凭据库解析。客户端本来就是 await 调用。 */
    async start(target: { workspaceId: string; configId: string }): Promise<RunSnapshot> {
      return registry.start(runKeyOf(target), await specFor(target));
    },
    stop(target: { workspaceId: string; configId: string }): RunSnapshot {
      return registry.stop(runKeyOf(target));
    },
    /** 一组凭据变量的状态。**只回状态，值不可能出现在这里**——`CredentialInfo` 没有装值的字段。 */
    async secretInfo(request: { names: string[] }): Promise<SecretStatus[]> {
      const provider = ctx.get('credentials');
      const out: SecretStatus[] = [];
      for (const name of request.names ?? []) {
        if (name === '') continue;
        if (provider === undefined) {
          out.push({ name, configured: false, writable: false, source: '' });
          continue;
        }
        const info = await provider.describe(name);
        out.push({ name, configured: info.configured, writable: info.writable, source: info.source ?? '' });
      }
      return out;
    },
    /**
     * 人在面板里填一个密钥值：直接写进 DSH 凭据库。
     * 值**不回传、不落面板存储**，面板只拿到状态；空值会被 provider 拒绝（这正是我们要的）。
     */
    async secretSet(request: { name: string; value: string }): Promise<SecretStatus> {
      const provider = ctx.get('credentials');
      if (provider === undefined) throw new Error('凭据服务不可用，无法保存密钥');
      await provider.set(request.name, request.value);
      const info = await provider.describe(request.name);
      return { name: request.name, configured: info.configured, writable: info.writable, source: info.source ?? '' };
    },
    read(request: { workspaceId: string; configId: string; from: number }): RunRead {
      return registry.read(runKeyOf(request), request.from);
    },
    runs(): RunSnapshot[] {
      return registry.snapshots();
    },
    /** 扫项目里的 IDEA 运行配置文件，认出可以导入的 Spring Boot 配置。 */
    discover(request: { workspaceId: string }): IdeaDiscovery {
      const project = store.getState().projects.find((p) => p.workspaceId === request.workspaceId);
      if (project === undefined) throw new Error('这个项目不在面板配置里');
      const runDir = join(project.path, '.run');
      const files = [join(project.path, '.idea', 'workspace.xml')];
      if (existsSync(runDir)) {
        try {
          for (const entry of readdirSync(runDir)) {
            if (entry.endsWith('.xml')) files.push(join(runDir, entry));
          }
        } catch { /* 目录读不了就当没有：下面按文件缺失处理 */ }
      }
      const candidates: IdeaDiscovery['candidates'] = [];
      const errors: string[] = [];
      const scanned: string[] = [];
      for (const file of files) {
        if (!existsSync(file)) continue;
        scanned.push(file);
        try {
          const xml = readFileSync(file, 'utf8');
          for (const found of parseSpringBootConfigurations(xml)) candidates.push({ ...found, source: file });
        } catch (error) {
          errors.push(`${file}：${String((error as Error)?.message ?? error)}`);
        }
      }
      if (scanned.length === 0) {
        errors.push('没找到 .idea/workspace.xml 或 .run/*.xml —— 导入只认 IDEA 工程根目录（多模块 Maven 工程的根，不是某一个模块）');
      }
      return { candidates, errors, scanned };
    },
    history(request: LogHistoryRequest): LogHistory {
      const key = runKeyOf(request);
      const tail = Number.isFinite(request.tail) && request.tail > 0 ? Math.floor(request.tail) : DEFAULT_HISTORY_LINES;
      const result = sink.tail(key, tail);
      return { lines: result.lines, truncated: result.truncated, path: sink.path(key) };
    },
  };

  Object.defineProperty(service, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service, serviceKey: 'ideConfig', namespace: 'ideConfig' },
  });

  // 客户端经 remote.ideConfig.* 调用（./typert 清单由 typert-loader 自动注册）。
  ctx.provide('ideConfig', service);

  // 内置 skill：**装完即用**。DSH 的六个 skill 根目录都不扫已安装插件包里的 skills/，
  // 所以走运行时注册（与工具同版本发布，不可能出现 skill 说一套、工具做一套）。
  whenService(ctx, 'skills', (skills: any) => {
    ctx.effect(() => skills.register(IDE_SKILL), 'dsh-newbe-ide: built-in skill');
  });

  // 内置模型工具：从宿主行注册 → 落在**全局层**，每个会话可见，不需要改任何 preset。
  whenService(ctx, 'tools', (tools: any) => {
    const deps: IdeToolDeps = {
      state: () => store.getState(),
      runs: () => registry.snapshots(),
      // 与面板同一条写路径：删掉的配置连日志一起清（applyState 的注释）
      apply: (next) => applyState(next),
      start: async (target) => registry.start(runKeyOf(target), await specFor(target)),
      stop: async (target) => registry.stop(runKeyOf(target)),
      // 失败回执里那几十行错误从磁盘尾部取：宿主缓冲可能已经滚过去了
      tail: (target, lines) => sink.tail(runKeyOf(target), lines).lines,
    };
    for (const tool of createIdeTools(deps)) {
      ctx.effect(() => tools.register(tool), `dsh-newbe-ide: tool ${String(tool.name)}`);
    }
  });
}

/**
 * 等服务出现再注册。**只 `ctx.get` 一次是不够的**：profile 里 bundles 的顺序不保证谁先挂载，
 * 晚挂载时那一次 get 拿到 undefined，工具就**静默**不存在了——面板照旧能用，最难发现。
 * （不写进 `inject`：那是硬依赖，服务真缺席时整个插件都不挂载，连面板一起没了。）
 */
function whenService(ctx: any, name: string, use: (service: any) => void): void {
  const ready = ctx.get(name);
  if (ready !== undefined) {
    use(ready);
    return;
  }
  if (typeof ctx.on !== 'function') return;   // 极简 ctx（测试里那种）没有事件面
  const off = ctx.on('internal/service', (serviceName: string, value: unknown) => {
    if (serviceName !== name || value === undefined) return;
    off();
    use(value);
  });
}
