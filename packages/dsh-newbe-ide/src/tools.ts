/**
 * 内置模型工具：让 agent 替你写启动配置。
 *
 * 三条边界**写死在这里**，不靠提示词自觉（工具定义里没有 dangerous/readOnly 这类声明式护栏，
 * 护栏只能写在 execute 与规划函数里）：
 *
 * 1. **单一写者**：工具只把「下一份完整状态」交给 `apply` 回调，绝不碰存储文件。
 *    绕过去自己改 JSON 就会和面板的整份提交撞成读-改-写竞态，吃掉用户刚在面板上改的东西。
 * 2. **密钥只登记变量名**：`isSecretName` 命中的变量一律写成 `from: 'credential'`，
 *    agent 传来的值**直接丢掉**；列表与回执里也永不出现值（列表连普通变量的值都不回，只回名字）。
 * 3. **同名幂等**：同一路径 + 同一配置名重复写入，内容一致就是 no-op，不一致才更新并列出改了哪些字段。
 *
 * 本模块是纯逻辑（可用假 deps 直接跑），宿主侧的接缝在 index.ts。
 */
import { isSecretName } from './lines.js';
import type { EnvVar, IdeState, LaunchConfig, ProjectEntry, RunSnapshot, RunStatus, RunTarget } from './schema.js';
import { basenameOf, runKeyOf, uniqueTitle } from './schema.js';

/** agent 视角的一条变量：**只有名字与来源，没有值**。 */
export interface ToolEnv {
  name: string;
  from: 'literal' | 'credential';
}

export interface ToolConfig {
  name: string;
  origin: 'human' | 'agent';
  command: string;
  cwd: string;
  envs: ToolEnv[];
  status: RunStatus;
  port: string;
}

export interface ToolProject {
  path: string;
  title: string;
  configs: ToolConfig[];
}

/** 当前面板里有什么（给 agent 看的投影）。值一个都不出现——密钥因此不可能顺着这条路进模型上下文。 */
export function toolView(state: IdeState, runs: readonly RunSnapshot[]): ToolProject[] {
  const byKey = new Map(runs.map((snapshot) => [snapshot.key, snapshot]));
  return state.projects.map((project) => ({
    path: project.path,
    title: project.title,
    configs: project.configs.map((config) => {
      const snapshot = byKey.get(runKeyOf({ workspaceId: project.workspaceId, configId: config.id }));
      return {
        name: config.name,
        origin: config.origin,
        command: config.command,
        cwd: config.cwd,
        envs: config.envs.map((env) => ({ name: env.name, from: env.from })),
        status: snapshot?.status ?? 'idle',
        port: snapshot?.port ?? '',
      };
    }),
  }));
}

export interface SaveEnvInput {
  name: string;
  /** 省略 = 保持原有值（agent 常常只记得变量名）；显式空串 = 清空。 */
  value?: string;
}

export interface SaveRequest {
  path?: string;
  title?: string;
  name?: string;
  command?: string;
  cwd?: string;
  /** 省略 = 保持原有变量；空数组 = 清空。 */
  envs?: SaveEnvInput[];
  remove?: boolean;
}

export type SaveAction = 'created' | 'updated' | 'noop' | 'removed' | 'error';

export interface SaveResult {
  ok: boolean;
  action: SaveAction;
  path: string;
  title: string;
  name: string;
  /** 改动了哪些字段（noop 时为空）。只列字段名，不列内容。 */
  changed: string[];
  envs: { total: number; credential: string[] };
  error: string;
}

export type SavePlan =
  | { ok: true; next: IdeState; result: SaveResult }
  | { ok: false; result: SaveResult };

/** 路径归一：去空白、去尾斜杠（`/a/b/` 与 `/a/b` 是同一条项目配置）。 */
export function normalizePath(path: string): string {
  return path.trim().replace(/[/\\]+$/, '');
}

function breakdown(request: SaveRequest, error: string): SavePlan {
  return {
    ok: false,
    result: {
      ok: false,
      action: 'error',
      path: normalizePath(String(request.path ?? '')),
      title: '',
      name: String(request.name ?? ''),
      changed: [],
      envs: { total: 0, credential: [] },
      error,
    },
  };
}

function envSummary(envs: readonly EnvVar[]): SaveResult['envs'] {
  return {
    total: envs.length,
    credential: envs.filter((env) => env.from === 'credential').map((env) => env.name),
  };
}

function sameEnvs(a: readonly EnvVar[], b: readonly EnvVar[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    return right !== undefined && left.name === right.name && left.value === right.value && left.from === right.from;
  });
}

/** agent 传来的变量 → 落盘变量。密钥命名的只留名字，值一律丢掉。 */
function toEnvs(input: readonly SaveEnvInput[], existing: readonly EnvVar[] | undefined): EnvVar[] {
  const out: EnvVar[] = [];
  for (const raw of input) {
    const name = String(raw?.name ?? '').trim();
    if (name === '') continue;
    if (isSecretName(name)) {
      out.push({ name, value: '', from: 'credential' });     // ← 值在这里被丢掉，且没有任何开关能绕过
      continue;
    }
    const prior = existing?.find((env) => env.name === name && env.from === 'literal');
    const value = raw.value === undefined ? prior?.value ?? '' : String(raw.value);
    out.push({ name, value, from: 'literal' });
  }
  return out;
}

/**
 * 规划一次写入：返回「下一份完整状态」与给 agent 的回执，**不落盘**（落盘由宿主的 store 负责）。
 * 纯函数——这是本票里最该被测试覆盖的一段。
 */
export function planSave(state: IdeState, request: SaveRequest): SavePlan {
  const path = normalizePath(String(request.path ?? ''));
  if (path === '') return breakdown(request, 'path 不能为空');
  if (!path.startsWith('/')) return breakdown(request, `path 必须是绝对路径，收到：${path}`);
  const name = String(request.name ?? '').trim();
  if (name === '') return breakdown(request, 'name 不能为空');

  const projectIndex = state.projects.findIndex((project) => normalizePath(project.path) === path);
  const project: ProjectEntry | undefined = projectIndex >= 0 ? state.projects[projectIndex] : undefined;

  if (request.remove === true) {
    const victim = project?.configs.find((config) => config.name === name);
    if (project === undefined || victim === undefined) {
      return breakdown(request, `${path} 下没有叫 ${name} 的启动配置`);
    }
    const rest = project.configs.filter((config) => config.id !== victim.id);
    const next: IdeState = {
      ...state,
      projects: state.projects.map((entry, index) => index !== projectIndex ? entry : {
        ...entry,
        configs: rest,
        // 删掉的正好是被记住的那条时，落到剩下的第一条（与面板 removeConfig 的行为一致）
        activeConfigId: entry.activeConfigId === victim.id ? rest[0]?.id ?? '' : entry.activeConfigId,
      }),
    };
    return {
      ok: true,
      next,
      result: { ok: true, action: 'removed', path, title: project.title, name, changed: [], envs: { total: 0, credential: [] }, error: '' },
    };
  }

  const command = String(request.command ?? '').trim();
  // 空命令的启动配置没有任何意义（面板允许存，因为人在场；agent 这里直接不许）
  if (command === '') return breakdown(request, 'command 不能为空（要删掉这条配置请传 remove: true）');

  const existing = project?.configs.find((config) => config.name === name);
  const envs = request.envs === undefined || !Array.isArray(request.envs)
    ? undefined
    : toEnvs(request.envs, existing?.envs);

  const cwdInput = request.cwd === undefined ? existing?.cwd : String(request.cwd).trim();
  // 空工作目录回落到项目路径——与面板 saveDraft 同一套约定，否则两边写出来的"同一条配置"不相等
  const cwd = cwdInput === undefined || cwdInput === '' ? path : cwdInput;

  if (existing === undefined) {
    const fresh: LaunchConfig = {
      id: `c${crypto.randomUUID()}`,
      name,
      command,
      cwd,
      envs: envs ?? [],
      origin: 'agent',
    };
    const title = uniqueTitle(
      String(request.title ?? '').trim() || basenameOf(path),
      state.projects.map((entry) => entry.title),
    );
    const next: IdeState = project === undefined
      ? { ...state, projects: [...state.projects, { workspaceId: `p${crypto.randomUUID()}`, path, title, configs: [fresh], activeConfigId: fresh.id, hidden: false }] }
      // hidden 一并放开：agent 配好的东西用户看不见就等于没配
      : { ...state, projects: state.projects.map((entry, index) => index !== projectIndex ? entry : { ...entry, hidden: false, configs: [...entry.configs, fresh], activeConfigId: fresh.id }) };
    return {
      ok: true,
      next,
      result: { ok: true, action: 'created', path, title: project?.title ?? title, name, changed: ['project', 'config'], envs: envSummary(fresh.envs), error: '' },
    };
  }

  const finalEnvs = envs ?? existing.envs;
  const changed: string[] = [];
  if (existing.command !== command) changed.push('command');
  if (existing.cwd !== cwd) changed.push('cwd');
  if (!sameEnvs(existing.envs, finalEnvs)) changed.push('envs');

  if (changed.length === 0) {
    // 内容一致 → 一个字节都不写，也**不认领**这条配置（origin 保持原样：agent 什么都没改）
    return {
      ok: true,
      next: state,
      result: { ok: true, action: 'noop', path, title: project!.title, name, changed: [], envs: envSummary(finalEnvs), error: '' },
    };
  }

  const updated: LaunchConfig = { ...existing, command, cwd, envs: finalEnvs, origin: 'agent' };
  const next: IdeState = {
    ...state,
    projects: state.projects.map((entry, index) => index !== projectIndex ? entry : {
      ...entry,
      hidden: false,
      configs: entry.configs.map((config) => config.id === existing.id ? updated : config),
    }),
  };
  return {
    ok: true,
    next,
    result: { ok: true, action: 'updated', path, title: project!.title, name, changed, envs: envSummary(finalEnvs), error: '' },
  };
}

/** 写盘前要停掉的进程：它们在新状态里已经不存在了（否则进程没了主人、端口占到 DSH 退出）。 */
export function vanishedTargets(before: IdeState, after: IdeState): RunTarget[] {
  const alive = new Set<string>();
  for (const project of after.projects) {
    for (const config of project.configs) alive.add(runKeyOf({ workspaceId: project.workspaceId, configId: config.id }));
  }
  const gone: RunTarget[] = [];
  for (const project of before.projects) {
    for (const config of project.configs) {
      if (!alive.has(runKeyOf({ workspaceId: project.workspaceId, configId: config.id }))) {
        gone.push({ workspaceId: project.workspaceId, configId: config.id });
      }
    }
  }
  return gone;
}

export interface Verdict {
  snapshot: RunSnapshot;
  waitedMs: number;
  settled: 'port' | 'exited' | 'timeout';
}

export interface VerdictOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** 注入睡眠，便于测试。 */
  sleep?: (ms: number) => Promise<void>;
  /** 注入时钟，便于测试。 */
  now?: () => number;
}

/**
 * 启动后**等到判决**再回话：认出端口 = 起来了；进程结束 = 失败；超时 = 还在启动。
 * 一次调用给结论，agent 不用自己 sleep 轮询。
 */
export async function awaitVerdict(
  first: RunSnapshot,
  poll: () => RunSnapshot,
  options: VerdictOptions = {},
): Promise<Verdict> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 500;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());

  const began = now();
  let snapshot = first;
  for (;;) {
    if (snapshot.port !== '' && snapshot.status === 'running') return { snapshot, waitedMs: now() - began, settled: 'port' };
    if (snapshot.status === 'failed' || snapshot.status === 'exited' || snapshot.status === 'stopped') {
      return { snapshot, waitedMs: now() - began, settled: 'exited' };
    }
    if (now() - began >= timeoutMs) return { snapshot, waitedMs: now() - began, settled: 'timeout' };
    await sleep(intervalMs);
    snapshot = poll();
  }
}

/** 工具真正要干的事，由宿主注入（这样工具本身不用认识 store / registry / 凭据库）。 */
export interface IdeToolDeps {
  state(): IdeState;
  runs(): RunSnapshot[];
  /** 落盘并返回宿主认可的状态；宿主负责原子提交与停掉消失的进程。 */
  apply(next: IdeState): Promise<IdeState>;
  start(target: RunTarget): Promise<RunSnapshot>;
  stop(target: RunTarget): Promise<RunSnapshot>;
  /** 失败时回执里那几十行错误从磁盘尾部取。 */
  tail(target: RunTarget, lines: number): string[];
}

/** 按「路径 + 配置名」定位：这两样是 agent 眼前就有的信息，内部 id 不必让它抄。 */
export function resolveTarget(state: IdeState, path: string, name: string): { ok: true; target: RunTarget } | { ok: false; error: string } {
  const wanted = normalizePath(String(path ?? ''));
  const project = state.projects.find((entry) => normalizePath(entry.path) === wanted);
  if (project === undefined) return { ok: false, error: `面板里没有 ${wanted} 这条项目配置（先用 ide_launch_save 建）` };
  const config = project.configs.find((entry) => entry.name === name);
  if (config === undefined) return { ok: false, error: `${project.title} 下没有叫 ${name} 的启动配置` };
  return { ok: true, target: { workspaceId: project.workspaceId, configId: config.id } };
}

const RUN_ERROR_TAIL_LINES = 40;

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function envNote(result: SaveResult): string {
  const parts = [`${result.envs.total} 个变量`];
  if (result.envs.credential.length > 0) {
    parts.push(`其中 ${result.envs.credential.length} 个是密钥（${result.envs.credential.join('、')}）——只登记了变量名，值需要用户自己填`);
  }
  return parts.join('，');
}

function renderSave(result: SaveResult): string {
  if (!result.ok) return `没有写入：${result.error}`;
  const where = `${result.path} / ${result.name}`;
  if (result.action === 'noop') return `没有变化（${where} 已经是这个样子），未写入。`;
  if (result.action === 'removed') return `已删除启动配置 ${where}。`;
  const head = result.action === 'created' ? `已新建启动配置 ${where}` : `已更新启动配置 ${where}（改了 ${result.changed.join('、')}）`;
  return `${head}：${envNote(result)}。`;
}

function renderRun(action: string, path: string, name: string, value: Record<string, unknown>): string {
  const where = `${path} / ${name}`;
  if (value.ok !== true) return `${where} 没有执行：${String(value.error ?? '')}`;
  const status = String(value.status);
  const port = String(value.port ?? '');
  if (action === 'status') return `${where} 当前状态：${status}${port === '' ? '' : `，端口 :${port}`}。`;
  if (action === 'stop') return `已停止 ${where}（状态：${status}）。`;
  const waited = seconds(Number(value.waitedMs ?? 0));
  if (value.settled === 'port') return `${where} 起来了：端口 :${port}（等了 ${waited}）。`;
  if (value.settled === 'timeout') return `${where} 还在启动中（等了 ${waited}，尚未认出端口）。可以再看一次 status，或让用户看面板日志。`;
  const tail = Array.isArray(value.errorTail) ? (value.errorTail as string[]) : [];
  const exit = value.exitCode === null || value.exitCode === undefined ? '' : `，退出码 ${String(value.exitCode)}`;
  return `${where} 没起来（状态：${status}${exit}）。最后 ${tail.length} 行输出：\n${tail.join('\n')}`;
}

/**
 * 三个模型工具。描述写短是刻意的：它们的描述**每次请求都在上下文里**（全局注册，每个会话可见），
 * 而流程与约定放在同包发布的 skill 正文里按需加载。
 * 描述用英文（与 DSH 自带工具一致），render 出来的正文用中文（用户要读它）。
 *
 * 注册成**裸 JSON-Schema 对象**：本包解析不到 `@deepseek-ai/dsh-tools`（它不可从本包 resolve），
 * 参数校验只能自己写在 `execute` 里。代价是 **`output.schema` 必须是标准 JSON Schema**——
 * 逐属性 `required: true` 那种规格 DSL 是 `defineTool` 才负责转的，裸注册交上去会被
 * `assertSupportedJsonSchema` 拒绝，而且是在 **`dsh web` 启动时 fatal**（实测踩过：重启直接失败）。
 * 支持的关键字只有 type / oneOf / properties / required / additionalProperties / items / enum / const
 * ＋ 注解；`required` 必须是字符串数组，`type` 不能是数组（用 `oneOf` 表达可空）。
 * `test/tools.test.mjs` 里有一条复刻这套子集的测试守着。
 */
export function createIdeTools(deps: IdeToolDeps): Record<string, unknown>[] {
  const list = {
    name: 'ide_launch_list',
    description:
      "List the IDE panel's projects and their launch configurations (path, name, command, working directory, env var names, status, port). Never returns env values. Read it before writing, so you update instead of duplicate.",
    parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projects: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string' },
                title: { type: 'string' },
                configs: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      name: { type: 'string' },
                      origin: { type: 'string' },
                      command: { type: 'string' },
                      cwd: { type: 'string' },
                      envs: {
                        type: 'array',
                        items: {
                          type: 'object',
                          additionalProperties: false,
                          properties: { name: { type: 'string' }, from: { type: 'string' } },
                          required: ['name', 'from'],
                        },
                      },
                      status: { type: 'string' },
                      port: { type: 'string' },
                    },
                    required: ['name', 'origin', 'command', 'cwd', 'envs', 'status', 'port'],
                  },
                },
              },
              required: ['path', 'title', 'configs'],
            },
          },
        },
        required: ['projects'],
      },
      render: (_args: unknown, value: unknown) => {
        const projects = (value as { projects?: ToolProject[] }).projects ?? [];
        if (projects.length === 0) return [{ type: 'text', text: '面板里还没有任何项目配置。' }];
        const lines: string[] = [];
        for (const project of projects) {
          lines.push(`${project.path}（${project.title}）`);
          if (project.configs.length === 0) lines.push('  （没有启动配置）');
          for (const config of project.configs) {
            const where = config.port === '' ? '' : ` -> :${config.port}`;
            lines.push(`  - ${config.name}${config.origin === 'agent' ? ' [agent]' : ''}：${config.status}${where}`);
            lines.push(`    命令：${config.command === '' ? '（未设置）' : config.command}`);
            lines.push(`    目录：${config.cwd}`);
            if (config.envs.length > 0) {
              lines.push(`    变量：${config.envs.map((env) => env.from === 'credential' ? `${env.name}(凭据)` : env.name).join('、')}`);
            }
          }
        }
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    async execute() {
      return { projects: toolView(deps.state(), deps.runs()) };
    },
  };

  const save = {
    name: 'ide_launch_save',
    description:
      'Create, update, or delete ONE launch configuration (name + command + working directory + env vars) in the IDE panel; an unknown path creates its project entry. Repeating a name with identical content is a no-op. Secret-named variables (KEY/SECRET/TOKEN/PASSWORD) store only the name — the user fills in the value.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute project directory (often a submodule, not the repository root). An unknown path creates a project entry.' },
        title: { type: 'string', description: 'Title for a newly created project entry; defaults to the last path segment.' },
        name: { type: 'string', description: 'Launch configuration name. The same name means the same configuration.' },
        command: { type: 'string', description: 'Shell command to run. Required unless remove is true.' },
        cwd: { type: 'string', description: 'Working directory. Omit to keep the current value; for a new configuration the project path is used.' },
        envs: {
          type: 'array',
          description: 'Env vars. Omit to keep the current ones, pass [] to clear; omit a value to keep the existing one. Secret-named values are discarded.',
          items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name'] },
        },
        remove: { type: 'boolean', description: 'true deletes this launch configuration after stopping its process.' },
      },
      required: ['path', 'name'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          action: { type: 'string' },
          path: { type: 'string' },
          title: { type: 'string' },
          name: { type: 'string' },
          changed: { type: 'array', items: { type: 'string' } },
          envs: {
            type: 'object',
            additionalProperties: false,
            properties: {
              total: { type: 'number' },
              credential: { type: 'array', items: { type: 'string' } },
            },
            required: ['total', 'credential'],
          },
          error: { type: 'string' },
        },
        required: ['ok', 'action', 'path', 'title', 'name', 'changed', 'envs', 'error'],
      },
      render: (args: unknown, value: unknown) => [{ type: 'text', text: renderSave(value as SaveResult) }],
    },
    async execute(args: unknown) {
      const request = (args ?? {}) as SaveRequest;
      const before = deps.state();
      const plan = planSave(before, request);
      // 领域错误用结构化回执（模型能直接反应），不抛栈
      if (!plan.ok) return plan.result;
      if (plan.result.action === 'noop') return plan.result;
      // 先停掉在新状态里已经消失的进程：否则进程没了主人、端口要占到 DSH 退出
      for (const target of vanishedTargets(before, plan.next)) {
        try { await deps.stop(target); } catch { /* 已经停了 */ }
      }
      await deps.apply(plan.next);
      return plan.result;
    },
  };

  const run = {
    name: 'ide_launch_run',
    description:
      'Start, stop, or inspect ONE launch configuration and wait for a verdict: it settles when a port shows up in the output or the process exits, and a failure returns the last output lines. Use it after ide_launch_save to prove a configuration runs.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute project directory of the configuration.' },
        name: { type: 'string', description: 'Launch configuration name.' },
        action: { type: 'string', description: "One of: start, stop, status." },
      },
      required: ['path', 'name', 'action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          action: { type: 'string' },
          status: { type: 'string' },
          port: { type: 'string' },
          // 没启动过是 null、启动过是数字：子集不支持 type 数组，用 oneOf 表达
          exitCode: { oneOf: [{ type: 'number' }, { type: 'null' }] },
          settled: { type: 'string' },
          waitedMs: { type: 'number' },
          errorTail: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
        },
        required: ['ok', 'action', 'status', 'port', 'settled', 'waitedMs', 'errorTail', 'error'],
      },
      render: (args: unknown, value: unknown) => {
        const args2 = (args ?? {}) as RunRequest;
        return [{ type: 'text', text: renderRun(String(args2.action ?? ''), String(args2.path ?? ''), String(args2.name ?? ''), (value ?? {}) as Record<string, unknown>) }];
      },
    },
    async execute(args: unknown) {
      const request = (args ?? {}) as RunRequest;
      const path = String(request.path ?? '');
      const name = String(request.name ?? '');
      const action = String(request.action ?? '');
      if (action !== 'start' && action !== 'stop' && action !== 'status') {
        return blankRun(action, `action 只能是 start / stop / status，收到：${action || '(空)'}`);
      }
      const found = resolveTarget(deps.state(), path, name);
      if (!found.ok) return blankRun(action, found.error);

      const current = (): RunSnapshot | undefined => deps.runs().find((snapshot) => snapshot.key === runKeyOf(found.target));
      const shape = (snapshot: RunSnapshot, settled: string, waitedMs: number, errorTail: string[]) => ({
        ok: true,
        action,
        status: snapshot.status,
        port: snapshot.port,
        exitCode: snapshot.exitCode,
        settled,
        waitedMs,
        errorTail,
        error: '',
      });

      if (action === 'status') {
        const snapshot = current();
        if (snapshot === undefined) return blankRun(action, '这条配置还没启动过');
        return shape(snapshot, 'known', 0, []);
      }
      if (action === 'stop') return shape(await deps.stop(found.target), 'stopped', 0, []);

      const first = await deps.start(found.target);
      const verdict = await awaitVerdict(first, () => current() ?? first);
      // 日志只有**失败时**才进回执，而且只取尾巴——"日志永不自动进模型上下文"这条不变量不破
      const failed = verdict.settled === 'exited' && verdict.snapshot.status !== 'stopped';
      const tail = failed ? deps.tail(found.target, RUN_ERROR_TAIL_LINES) : [];
      return shape(verdict.snapshot, verdict.settled, verdict.waitedMs, tail);
    },
  };

  return [list, save, run];
}

function blankRun(action: string, error: string): Record<string, unknown> {
  return { ok: false, action, status: 'idle', port: '', exitCode: null, settled: 'error', waitedMs: 0, errorTail: [], error, };
}

interface RunRequest {
  path?: string;
  name?: string;
  action?: string;
}
