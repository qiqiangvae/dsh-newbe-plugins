/**
 * 启动配置的 wire schema（zod v4）。
 * Host 侧持久化校验、./typert 清单与客户端 Remote contribution 三方共用同一份定义，
 * 保证磁盘状态与 RPC 编解码使用同一份结构。
 *
 * 约定：空字符串表示"未选择"，不用 optional —— RPC 负载是 JSON，undefined 无法表达。
 */
import { z } from 'zod';

export const envVarSchema = z.object({
  name: z.string(),
  value: z.string(),
  /**
   * 值从哪来：`literal` 就是上面的 `value`；`credential` **忽略 value**，启动时由宿主按 `name`
   * 去 DSH 凭据库取（`$DSH_HOME/.credentials.yaml`）。
   *
   * 必须带默认值：老文件没有这个字段（那时密钥是明文存在 `value` 里的），
   * 缺字段会被整份判为损坏、用户的配置全丢。
   */
  from: z.enum(['literal', 'credential']).default('literal'),
});

/** 一条启动配置：名称 + 启动命令 + 工作目录 + 环境变量。 */
export const launchConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  cwd: z.string(),
  envs: z.array(envVarSchema),
  /** 最后一次是谁写的：面板（`human`）还是内置工具（`agent`）。老文件缺省视为人写的。 */
  origin: z.enum(['human', 'agent']).default('human'),
});

/** 一个项目（= DSH 工作区）在面板里的条目。 */
export const projectEntrySchema = z.object({
  workspaceId: z.string(),
  path: z.string(),
  title: z.string(),
  configs: z.array(launchConfigSchema),
  activeConfigId: z.string(),
  /** 从面板上收起的项目：配置全部保留，只是不出 tab。老文件没有这个字段，缺省视为未收起。 */
  hidden: z.boolean().default(false),
});

/** 持久化到 $DSH_HOME/storages/dsh-newbe-ide.json 的完整内容。 */
export const ideStateSchema = z.object({
  projects: z.array(projectEntrySchema),
  activeWorkspaceId: z.string(),
  /**
   * 总览 tab 曾经是可配置开关（默认关），现在**常驻**，界面上不再有它。
   * 字段留着不删，且必须带默认值：删掉它以后，任何还在按老 schema 校验的版本（回滚、
   * 另装一份旧包）读到新写的文件会因为"缺字段"把整份状态判为损坏，用户的启动配置全没。
   */
  showOverview: z.boolean().default(false),
});

/** 面板可选的项目来源：DSH 工作区注册表。字段名与 ProjectEntry 对齐，避免逐字段手工翻译。 */
export const ideProjectViewSchema = z.object({
  workspaceId: z.string(),
  title: z.string(),
  path: z.string(),
});

/** load() 的返回：磁盘配置 + 可选项目 + 降级告警（'' 表示无）。 */
export const ideLoadSchema = z.object({
  config: ideStateSchema,
  projects: z.array(ideProjectViewSchema),
  warning: z.string(),
});

/** 一条启动配置的定位（项目 + 配置 id）。 */
export const runTargetSchema = z.object({
  workspaceId: z.string(),
  configId: z.string(),
});

/** 读日志的请求：从哪个偏移开始。 */
export const runReadRequestSchema = z.object({
  workspaceId: z.string(),
  configId: z.string(),
  from: z.number(),
});

export const runStatusSchema = z.enum(['idle', 'running', 'exited', 'stopped', 'failed']);

/** 运行态快照：不含日志正文。 */
export const runSnapshotSchema = z.object({
  key: z.string(),
  status: runStatusSchema,
  exitCode: z.number().nullable(),
  error: z.string(),
  lossy: z.boolean(),
  /** 本次启动的时刻（毫秒）；未启动为 0。 */
  startedAtMs: z.number(),
  /** 从输出里认出的监听端口；认不出为空串。DSH 的 shell 契约不暴露 PID，所以这里没有 pid。 */
  port: z.string(),
  /** 缓冲里最后一条非空输出：总览卡片要显示"各自最后一行"，而客户端只有当前配置的日志。 */
  lastLine: z.string(),
});

/** 增量日志：lines 是这次新增的行，next 是下次请求的偏移。 */
export const runReadSchema = z.object({
  key: z.string(),
  status: runStatusSchema,
  exitCode: z.number().nullable(),
  error: z.string(),
  lossy: z.boolean(),
  startedAtMs: z.number(),
  port: z.string(),
  lastLine: z.string(),
  lines: z.array(z.string()),
  next: z.number(),
  dropped: z.boolean(),
});

export const runSnapshotListSchema = z.array(runSnapshotSchema);

/** 客户端补历史时默认要多少行；宿主在请求未给数值时用同一个默认。 */
export const DEFAULT_HISTORY_LINES = 2000;

/** 读历史日志的请求：要最后多少行。 */
export const logHistoryRequestSchema = z.object({
  workspaceId: z.string(),
  configId: z.string(),
  tail: z.number(),
});

/** 从 IDEA 工程里发现的一条 Spring Boot 运行配置。 */
export const ideaCandidateSchema = z.object({
  name: z.string(),
  module: z.string(),
  mainClass: z.string(),
  envs: z.array(envVarSchema),
  problem: z.string(),
  source: z.string(),
});

/** 发现请求：只按项目找。 */
export const ideaDiscoveryRequestSchema = z.object({
  workspaceId: z.string(),
});

/** 发现结果：候选 + 读不了的文件（可读原因）+ 实际扫过的文件。 */
export const ideaDiscoverySchema = z.object({
  candidates: z.array(ideaCandidateSchema),
  errors: z.array(z.string()),
  scanned: z.array(z.string()),
});

/** 历史日志（来自落盘文件，跨 DSH 重启可取）。 */
export const logHistorySchema = z.object({
  lines: z.array(z.string()),
  truncated: z.boolean(),
  path: z.string(),
});

/** 查一组变量在凭据库里的状态。**值不可能出现在这里**——`CredentialInfo` 本身没有装值的字段。 */
export const secretQuerySchema = z.object({
  names: z.array(z.string()),
});

export const secretStatusSchema = z.object({
  name: z.string(),
  /** 现在解析这个名字能不能拿到值。 */
  configured: z.boolean(),
  /** 当前这层能不能写（进程环境层只读，写进去也会被它盖住）。 */
  writable: z.boolean(),
  source: z.string(),
});

export const secretStatusListSchema = z.array(secretStatusSchema);

/** 人在面板里填一个密钥值：宿主直接写进凭据库，值不回传、不落面板的存储文件。 */
export const secretSetSchema = z.object({
  name: z.string(),
  value: z.string(),
});

/** 空配置：存储层与客户端面板共用的同一个值（宿主与浏览器都从这里取，避免两处各写一份）。 */
export function defaultState(): IdeState {
  return { projects: [], activeWorkspaceId: '', showOverview: false };
}

/**
 * 当前选中的启动配置：局部选择优先，其次磁盘上记住的，最后退回第一条。
 * 局部优先是必须的——磁盘值是异步读回来的，周期性重读会把刚点的选择盖回去。
 */
export function pickActiveConfig(project: ProjectEntry, preferredId: string): LaunchConfig | undefined {
  const preferred = project.configs.find((c) => c.id === preferredId);
  if (preferred !== undefined) return preferred;
  const remembered = project.configs.find((c) => c.id === project.activeConfigId);
  return remembered ?? project.configs[0];
}

/** 路径末段，用作"任意路径"新建项目配置时的默认标题（空路径返回空串）。 */
export function basenameOf(path: string): string {
  const parts = path.replace(/[/\\]+$/, '').split(/[/\\]/).filter((x) => x !== '');
  return parts.length === 0 ? path : parts[parts.length - 1];
}

/**
 * 同名标题自动让路：`kun-ai` → `kun-ai (2)` → `kun-ai (3)`。
 * 同一路径可以有多条项目配置，而一级 tab 只显示标题 + 配置数——不去重就是两个一模一样的 tab。
 */
export function uniqueTitle(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/**
 * 新增卡片要列出的 DSH 工作区：按**路径**排除已经有项目配置的那些，列表内再按路径去重。
 *
 * 判重只能用路径：项目配置的 `id` 是它自己的（与工作区 id 无关），同路径可以有多条、
 * id 各不相同——按 id 比就是当年那个"存的是旧工作区 id"的坑（已加入的项目又被列成可加入）。
 */
export function availableWorkspaces(
  registry: readonly z.infer<typeof ideProjectViewSchema>[],
  usedPaths: readonly string[],
): z.infer<typeof ideProjectViewSchema>[] {
  const seen = new Set(usedPaths);
  const out: z.infer<typeof ideProjectViewSchema>[] = [];
  for (const row of registry) {
    if (seen.has(row.path)) continue;      // 已有项目配置占了这个路径
    seen.add(row.path);                     // 同一个路径在注册表里登记了多次 → 只留第一条
    out.push(row);
  }
  return out;
}

/** 一条启动配置的进程键：宿主与客户端必须用同一种拼法。 */
export function runKeyOf(target: RunTarget): string {
  return `${target.workspaceId}/${target.configId}`;
}

export type EnvVar = z.infer<typeof envVarSchema>;
export type LaunchConfig = z.infer<typeof launchConfigSchema>;
export type ProjectEntry = z.infer<typeof projectEntrySchema>;
export type IdeState = z.infer<typeof ideStateSchema>;
export type IdeProjectView = z.infer<typeof ideProjectViewSchema>;
export type IdeLoad = z.infer<typeof ideLoadSchema>;
export type RunTarget = z.infer<typeof runTargetSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;
export type RunRead = z.infer<typeof runReadSchema>;
export type RunReadRequest = z.infer<typeof runReadRequestSchema>;
export type RunSnapshotList = z.infer<typeof runSnapshotListSchema>;
export type LogHistoryRequest = z.infer<typeof logHistoryRequestSchema>;
export type LogHistory = z.infer<typeof logHistorySchema>;
export type IdeaCandidateView = z.infer<typeof ideaCandidateSchema>;
export type IdeaDiscovery = z.infer<typeof ideaDiscoverySchema>;
export type SecretStatus = z.infer<typeof secretStatusSchema>;
