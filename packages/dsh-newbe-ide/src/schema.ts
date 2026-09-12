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
});

/** 一条启动配置：名称 + 启动命令 + 工作目录 + 环境变量。 */
export const launchConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  cwd: z.string(),
  envs: z.array(envVarSchema),
});

/** 一个项目（= DSH 工作区）在面板里的条目。 */
export const projectEntrySchema = z.object({
  workspaceId: z.string(),
  path: z.string(),
  title: z.string(),
  configs: z.array(launchConfigSchema),
  activeConfigId: z.string(),
});

/** 持久化到 $DSH_HOME/storages/dsh-newbe-ide.json 的完整内容。 */
export const ideStateSchema = z.object({
  projects: z.array(projectEntrySchema),
  activeWorkspaceId: z.string(),
  showOverview: z.boolean(),
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
