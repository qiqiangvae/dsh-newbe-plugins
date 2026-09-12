/**
 * dsh-newbe-ide Host 侧：
 * 1. 启动配置持久化到 `$DSH_HOME/storages/dsh-newbe-ide.json`（原子写、0600）。
 * 2. 提供 `ideConfig` 服务（load / submit），经手写 Typert 清单
 *    （./typert → lib/typert.host.js，由 typert-loader 自动注册）暴露给 Web 客户端。
 *
 * 这一版只做"存得住、读得回"：不启动任何进程，进程与日志见后续票。
 */
import { dirname, join } from 'node:path';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { createConfigStore } from './store.js';
import { createRunRegistry, type RunSpec } from './runtime.js';
import { createFileLogSink } from './logsink.js';
import { runKeyOf, type IdeLoad, type IdeProjectView, type IdeState, type LogHistory, type RunRead, type RunSnapshot } from './schema.js';

export { createConfigStore } from './store.js';
export { defaultState, pickActiveConfig, runKeyOf } from './schema.js';
export { cleanLine, isSecretName, maskSecrets, splitLines } from './lines.js';
export { DEFAULT_LEVELS, compileMatcher, filterLines, levelOf } from './filter.js';
export { createFileLogSink } from './logsink.js';
export type { LogSink, TailResult } from './logsink.js';
export type { FilteredLine, FilterState, Matcher, MatcherSpec, RunLevel } from './filter.js';
export { createRunRegistry } from './runtime.js';
export type { RunRead, RunSnapshot, RunStatus } from './schema.js';

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
  ctx.effect(() => {
    const timer = setInterval(() => registry.pump(), 250);
    return () => {
      clearInterval(timer);
      registry.dispose();
    };
  }, 'dsh-newbe-ide: run pump');

  /** 从持久化配置里取出要跑的命令；找不到就把原因说清楚，而不是抛栈。 */
  function specFor(target: { workspaceId: string; configId: string }): RunSpec {
    const state = store.getState();
    const project = state.projects.find((p) => p.workspaceId === target.workspaceId);
    if (project === undefined) throw new Error('这个项目不在面板配置里');
    const config = project.configs.find((c) => c.id === target.configId);
    if (config === undefined) throw new Error('找不到这条启动配置');
    return { command: config.command, cwd: config.cwd !== '' ? config.cwd : project.path, envs: config.envs };
  }

  const service = {
    load(): IdeLoad {
      return { config: store.getState(), projects: listProjects(ctx), warning: store.warning };
    },
    submit(next: unknown): Promise<IdeState> {
      return store.submit(next);
    },
    start(target: { workspaceId: string; configId: string }): RunSnapshot {
      return registry.start(runKeyOf(target), specFor(target));
    },
    stop(target: { workspaceId: string; configId: string }): RunSnapshot {
      return registry.stop(runKeyOf(target));
    },
    read(request: { workspaceId: string; configId: string; from: number }): RunRead {
      return registry.read(runKeyOf(request), request.from);
    },
    runs(): RunSnapshot[] {
      return registry.snapshots();
    },
    history(request: { workspaceId: string; configId: string; tail: number }): LogHistory {
      const key = runKeyOf(request);
      const tail = Number.isFinite(request.tail) && request.tail > 0 ? Math.floor(request.tail) : 2000;
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
}
