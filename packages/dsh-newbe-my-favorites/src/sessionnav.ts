/**
 * 客户端「切换会话 / 谁是当前会话」的跨版本接缝。
 *
 * - **切换会话**：0.1.6-alpha.2 的客户端 `sessions` 服务只剩
 *   `retain / using / retainInfo / search / fork / scope / binding`，**`open` 已经不存在**；
 *   导航改由 `uiWorkspace.openSession(target)` 承担（侧边栏内置会话列表也走它）。
 *   老版本没有 `uiWorkspace`，仍回退到 `sessions.open`。
 * - **当前会话**：老版本在 `sessions.list` 快照里直接给 `current`；新版该字段没了，
 *   官方插件（layout / cordis / session / agent-preset）统一从
 *   `byId[*].retainedBy.mainView > 0` 反推。
 *
 * 两处都在运行时探测，不写进 `inject`：老版本的 DSH 里没有 `uiWorkspace`，
 * 声明成硬依赖会让插件在那些版本上根本不挂载。
 */

export type SessionsSnapshot = { current?: string; byId?: Record<string, any> };

/** 当前会话 id：老版本读快照里的 `current`，0.1.6+ 由 `retainedBy.mainView` 反推。 */
export function currentSessionId(state: SessionsSnapshot | undefined): string | undefined {
  if (state?.current) return state.current;
  const byId = state?.byId ?? {};
  for (const id of Object.keys(byId)) if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id;
  return undefined;
}

/** 打开/切换到某个会话：优先 0.1.6+ 的 `uiWorkspace.openSession`，回退老版本的 `sessions.open`。 */
export function createSessionOpener(ctx: any): (id: string) => void {
  return (id: string) => {
    const uiWorkspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined;
    if (typeof uiWorkspace?.openSession === 'function') { uiWorkspace.openSession(id); return; }
    ctx.sessions?.open?.(id);
  };
}
