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
});

/** 增量日志：lines 是这次新增的行，next 是下次请求的偏移。 */
export const runReadSchema = z.object({
  key: z.string(),
  status: runStatusSchema,
  exitCode: z.number().nullable(),
  error: z.string(),
  lossy: z.boolean(),
  lines: z.array(z.string()),
  next: z.number(),
  dropped: z.boolean(),
});

export const runSnapshotListSchema = z.array(runSnapshotSchema);

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
