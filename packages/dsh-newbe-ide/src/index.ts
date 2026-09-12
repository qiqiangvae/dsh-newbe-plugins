/**
 * dsh-newbe-ide Host 侧：
 * 1. 启动配置持久化到 `$DSH_HOME/storages/dsh-newbe-ide.json`（原子写、0600）。
 * 2. 提供 `ideConfig` 服务（load / submit），经手写 Typert 清单
 *    （./typert → lib/typert.host.js，由 typert-loader 自动注册）暴露给 Web 客户端。
 *
 * 这一版只做"存得住、读得回"：不启动任何进程，进程与日志见后续票。
 */
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { createConfigStore } from './store.js';
import type { IdeLoad, IdeProjectView, IdeState } from './schema.js';

export { createConfigStore, defaultState } from './store.js';

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
  console.log(`[dsh-newbe-ide] 存储文件：${STORAGE_PATH}`);

  const service = {
    load(): IdeLoad {
      return { config: store.getState(), projects: listProjects(ctx), warning: store.warning };
    },
    submit(next: unknown): Promise<IdeState> {
      return store.submit(next);
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
