/**
 * dsh-newbe-ide Web 客户端：
 * 注册会话视图 tab「IDE」（`conversation.view`，紧随 对话 / 轨迹 / 上下文），
 * 面板内容 = 按项目组织的启动配置编辑器，数据经 remote.ideConfig RPC 读写宿主
 * 侧 `$DSH_HOME/storages/dsh-newbe-ide.json`。
 *
 * 这一版只做"存得住、读得回"：不启动进程、没有日志（见后续票）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ideLoadSchema,
  ideStateSchema,
  runReadRequestSchema,
  runReadSchema,
  runSnapshotListSchema,
  runSnapshotSchema,
  runTargetSchema,
  type IdeLoad,
  type IdeProjectView,
  type IdeState,
  type LaunchConfig,
  type ProjectEntry,
  defaultState,
  runKeyOf,
  type RunRead,
  type RunSnapshot,
  type RunTarget,
} from './schema.js';
import { isSecretName } from './lines.js';

export const NS = 'dsh-newbe-ide';
const VIEW_ID = 'dsh-newbe-ide';
const VIEW_ORDER = 30; // 对话 0 / 轨迹 10 / 上下文 20 / IDE 30

type RemoteEnvelope<T> = { ok: true; value: T } | { ok: false; error?: { message?: string } };
type RemoteIde = {
  load(): Promise<RemoteEnvelope<unknown>>;
  submit(next: unknown): Promise<RemoteEnvelope<unknown>>;
  start(target: RunTarget): Promise<RemoteEnvelope<unknown>>;
  stop(target: RunTarget): Promise<RemoteEnvelope<unknown>>;
  read(request: RunTarget & { from: number }): Promise<RemoteEnvelope<unknown>>;
  runs(): Promise<RemoteEnvelope<unknown>>;
};

/** 客户端 Remote contribution：与宿主 ./typert 清单的端点逐一对应。 */
const REMOTE_CONTRIBUTION = {
  package: 'dsh-newbe-ide',
  descriptors: [
    {
      id: 'dsh-newbe-ide#ideConfig/load',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'load',
      invocation: { kind: 'direct' as const },
      parameters: [],
      result: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#IdeLoad', schema: ideLoadSchema },
    },
    {
      id: 'dsh-newbe-ide#ideConfig/start',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'start',
      invocation: { kind: 'direct' as const },
      parameters: [{ name: 'target', wire: 'target', source: 'json' as const, codec: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#RunTarget', schema: runTargetSchema } }],
      result: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#RunSnapshot', schema: runSnapshotSchema },
    },
    {
      id: 'dsh-newbe-ide#ideConfig/stop',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'stop',
      invocation: { kind: 'direct' as const },
      parameters: [{ name: 'target', wire: 'target', source: 'json' as const, codec: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#RunTarget', schema: runTargetSchema } }],
      result: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#RunSnapshot', schema: runSnapshotSchema },
    },
    {
      id: 'dsh-newbe-ide#ideConfig/read',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'read',
      invocation: { kind: 'direct' as const },
      parameters: [{ name: 'request', wire: 'request', source: 'json' as const, codec: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#RunReadRequest', schema: runReadRequestSchema } }],
      result: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#RunRead', schema: runReadSchema },
    },
    {
      id: 'dsh-newbe-ide#ideConfig/runs',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'runs',
      invocation: { kind: 'direct' as const },
      parameters: [],
      result: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#RunSnapshotList', schema: runSnapshotListSchema },
    },
    {
      id: 'dsh-newbe-ide#ideConfig/submit',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'submit',
      invocation: { kind: 'direct' as const },
      parameters: [
        { name: 'next', wire: 'next', source: 'json' as const, codec: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#IdeStateInput', schema: ideStateSchema } },
      ],
      result: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#IdeState', schema: ideStateSchema },
    },
  ],
};

function envelopeValue(result: RemoteEnvelope<unknown>, action: string): unknown {
  if (result !== null && typeof result === 'object' && result.ok === true) return result.value;
  const message = (result as { error?: { message?: string } })?.error?.message;
  throw new Error(message !== undefined && message !== '' ? message : `${action}失败`);
}

const STYLE_ID = 'dsh-newbe-ide';

function ensureStyles(): () => void {
  if (document.querySelector(`style[data-plugin="${STYLE_ID}"]`) !== null) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = STYLE_ID;
  style.textContent = `
.ide-root{display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px;color:var(--dsw-alias-label-primary,#1f2329)}
.ide-tabrow{display:flex;align-items:stretch;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2,#d9dce1);flex:none;overflow-x:auto;scrollbar-width:none}
.ide-tabrow::-webkit-scrollbar{display:none}
.ide-tab{display:flex;align-items:center;gap:7px;padding:9px 10px 8px;color:var(--dsw-alias-label-secondary,#697586);white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-1px;cursor:pointer;flex:none;background:none;border-left:0;border-right:0;border-top:0;font:inherit}
.ide-tab:hover{color:var(--dsw-alias-label-primary,#1f2329)}
.ide-tab[data-sel=true]{color:var(--dsw-alias-label-primary,#1f2329);border-bottom-color:var(--dsw-alias-brand-primary,#3370ff)}
.ide-tab .ide-x{opacity:0;font-size:13px;line-height:1;padding:0 2px;border-radius:4px;color:var(--dsw-alias-label-secondary,#697586)}
.ide-tab:hover .ide-x{opacity:1}
.ide-tab .ide-x:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.07))}
.ide-tools{display:flex;align-items:center;gap:6px;margin-left:auto;padding:0 4px 0 10px;flex:none}
.ide-select{background:var(--dsw-alias-bg-module-platform,#fff);border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:7px;padding:3px 6px;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary,#697586);max-width:190px}
.ide-body{display:flex;flex-direction:column;flex:1;min-height:0;padding:12px 16px;gap:10px;overflow:auto}
.ide-head{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:9px;background:var(--dsw-alias-bg-module-platform,#fff);flex-wrap:wrap}
.ide-title{font-size:14px;font-weight:600}
.ide-path{color:var(--dsw-alias-label-secondary,#697586);font-size:11px;word-break:break-all}
.ide-chip{border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:999px;padding:2px 9px;font-size:12px;color:var(--dsw-alias-label-secondary,#697586);background:none;font:inherit;cursor:pointer;white-space:nowrap}
.ide-chip:hover{border-color:var(--dsw-alias-label-secondary,#697586)}
.ide-chip[data-sel=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(51,112,255,.12));border-color:var(--dsw-alias-brand-primary,#3370ff);color:var(--dsw-alias-brand-primary,#3370ff)}
.ide-btn{border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:7px;padding:4px 11px;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary,#1f2329);background:none;cursor:pointer}
.ide-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.07))}
.ide-btn[data-on=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(51,112,255,.12));border-color:var(--dsw-alias-brand-primary,#3370ff);color:var(--dsw-alias-brand-primary,#3370ff)}
.ide-btn[data-kind=primary]{background:var(--dsw-alias-brand-primary,#3370ff);border-color:transparent;color:#fff}
.ide-btn:disabled{opacity:.5;cursor:default}
.ide-field{background:var(--dsw-alias-bg-module-platform,#fff);border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:7px;padding:5px 9px;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary,#1f2329);outline:none}
.ide-field:focus{border-color:var(--dsw-alias-brand-primary,#3370ff)}
.ide-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ide-cfg{border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:9px;background:var(--dsw-alias-bg-module-platform,#fff);padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.ide-line{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ide-label{color:var(--dsw-alias-label-secondary,#697586);font-size:12px;width:56px;flex:none}
.ide-envs{width:100%;border-collapse:collapse}
.ide-envs td{padding:3px 4px;vertical-align:middle}
.ide-envs input{width:100%}
.ide-empty{margin:auto;text-align:center;color:var(--dsw-alias-label-secondary,#697586);display:flex;flex-direction:column;gap:8px;align-items:center}
.ide-note{font-size:11px;color:var(--dsw-alias-label-secondary,#697586)}
.ide-warn{border:1px dashed var(--dsw-alias-state-warn-primary,#e7a100);color:var(--dsw-alias-state-warn-primary,#e7a100);border-radius:8px;padding:7px 10px;font-size:12px}
.ide-err{color:var(--dsw-alias-state-error-primary,#d83931);font-size:12px}
.ide-logbox{display:flex;flex-direction:column;gap:4px;flex:1;min-height:0}
.ide-log{flex:1;min-height:160px;max-height:54vh;overflow:auto;background:rgba(128,128,128,.10);border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:9px;padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all}
`;
  document.head.appendChild(style);
  return () => { style.remove(); };
}

/** 运行态文案：状态机到人话只在这一处翻译。 */
function describeRun(run: RunSnapshot | undefined): string {
  if (run === undefined || run.status === 'idle') return '未启动';
  if (run.status === 'running') return '运行中';
  if (run.status === 'stopped') return '已停止';
  if (run.status === 'failed' && run.error !== '') return `启动失败：${run.error}`;
  if (run.exitCode === 127) return '命令不存在（码 127）';
  return `已退出（码 ${run.exitCode ?? '?'}）`;
}

/** 项目内的不可变更新：只改一条 project entry，其余原样带过。 */
function patchProject(config: IdeState, workspaceId: string, mutate: (project: ProjectEntry) => ProjectEntry): IdeState {
  return { ...config, projects: config.projects.map((p) => (p.workspaceId === workspaceId ? mutate(p) : p)) };
}

interface PanelProps {
  /** 宿主 RPC；挂载失败时为 undefined，面板降级为只读提示。 */
  api: RemoteIde | undefined;
  /** 客户端 ctx：用于订阅连接重置（重连后重新加载）。 */
  ctx: any;
}

/** 面板：项目 tab → 启动配置 chip → 启动配置编辑块。 */
function Panel({ api, ctx }: PanelProps): React.ReactElement {
  const [config, setConfig] = useState<IdeState | null>(null);
  const [projects, setProjects] = useState<IdeProjectView[]>([]);
  const [warning, setWarning] = useState('');
  const [activeProjectId, setActiveProjectId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, LaunchConfig>>({});
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');

  const applyLoad = useCallback((load: IdeLoad) => {
    setConfig(load.config);
    setProjects(load.projects);
    setWarning(load.warning);
    setActiveProjectId((current) => {
      if (load.config.projects.some((p) => p.workspaceId === current)) return current;
      if (load.config.activeWorkspaceId !== '') return load.config.activeWorkspaceId;
      return load.config.projects[0]?.workspaceId ?? '';
    });
  }, []);

  const reload = useCallback(async () => {
    if (api === undefined) {
      setWarning('remote.ideConfig 不可用，面板无法读写启动配置');
      return;
    }
    try {
      applyLoad(envelopeValue(await api.load(), '读取启动配置') as IdeLoad);
      setError('');
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [api, applyLoad]);

  useEffect(() => {
    void reload();
    return ctx.on('connection/reset', () => { void reload(); });
  }, [ctx, reload]);

  /**
   * 先本地生效（乐观），再落盘并以宿主返回的状态为准。
   * 落盘失败必须回到磁盘真实状态：否则面板会显示从未写成的配置，
   * 后续提交还会基于这份状态继续写（关掉再开就对不上了）。
   */
  const commit = useCallback(async (next: IdeState, showFlash: boolean): Promise<boolean> => {
    if (api === undefined) {
      setError('remote.ideConfig 不可用，改动未保存');
      return false;
    }
    setConfig(next);
    try {
      setConfig(envelopeValue(await api.submit(next), '保存启动配置') as IdeState);
      setError('');
      setWarning('');
      if (showFlash) {
        setFlash('已保存 ✓');
        window.setTimeout(() => setFlash(''), 1600);
      }
      return true;
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      await reload();
      return false;
    }
  }, [api, reload]);

  const cfg: IdeState = config ?? defaultState();
  // 注册表为空可能是"尚未就绪"，此时按原样渲染，不能把持久化项目当成失效而清掉。
  const registryKnown = projects.length > 0;
  const isRegistered = (workspaceId: string) => projects.some((w) => w.workspaceId === workspaceId);
  const registered = registryKnown ? cfg.projects.filter((p) => isRegistered(p.workspaceId)) : cfg.projects;
  const stale = registryKnown ? cfg.projects.filter((p) => !isRegistered(p.workspaceId)) : [];
  const active = registered.find((p) => p.workspaceId === activeProjectId) ?? registered[0];
  const activeConfigId = active !== undefined && active.activeConfigId !== '' ? active.activeConfigId : active?.configs[0]?.id;
  const activeConfig = active?.configs.find((c) => c.id === activeConfigId);
  const draft = activeConfig !== undefined ? (drafts[activeConfig.id] ?? activeConfig) : undefined;
  const available = projects.filter((p) => !cfg.projects.some((entry) => entry.workspaceId === p.workspaceId));

  const runKey = active !== undefined && activeConfig !== undefined ? runKeyOf({ workspaceId: active.workspaceId, configId: activeConfig.id }) : '';
  const [runs, setRuns] = useState<Record<string, RunSnapshot>>({});
  const [logLines, setLogLines] = useState<string[]>([]);
  const offsetRef = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  /** 是否贴底：由 scroll 事件维护。追加后量高度会把"一次涌入多行"误判成用户上滚。 */
  const pinnedRef = useRef(true);
  /** 运行代次：重启后自增，用来丢弃上一代进程还在飞的读取结果。 */
  const genRef = useRef(0);
  const [truncated, setTruncated] = useState(false);

  // 日志按启动配置分家：切换配置就清空缓冲，否则会把上一条的输出串过来。
  useEffect(() => {
    offsetRef.current = 0;
    genRef.current += 1;
    pinnedRef.current = true;
    setTruncated(false);
    setLogLines([]);
  }, [runKey]);

  useEffect(() => {
    if (api === undefined || runKey === '' || active === undefined || activeConfig === undefined) return;
    const target = { workspaceId: active.workspaceId, configId: activeConfig.id };
    let stopped = false;
    const tick = async () => {
      const gen = genRef.current; // 这一轮属于哪一代
      try {
        const list = envelopeValue(await api.runs(), '读取运行态') as RunSnapshot[];
        const map: Record<string, RunSnapshot> = {};
        for (const item of list) map[item.key] = item;
        if (stopped || genRef.current !== gen) return;
        setRuns(map);
        const chunk = envelopeValue(await api.read({ ...target, from: offsetRef.current }), '读取日志') as RunRead;
        if (stopped || genRef.current !== gen) return;
        offsetRef.current = chunk.next;
        if (chunk.dropped) setTruncated(true);
        if (chunk.lines.length > 0) {
          setLogLines((prev) => {
            const merged = [...prev, ...chunk.lines];
            if (merged.length <= 4000) return merged;
            setTruncated(true);
            return merged.slice(merged.length - 4000);
          });
        }
      } catch (e) {
        if (!stopped && genRef.current === gen) setError(String((e as Error)?.message ?? e));
      }
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, 800);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [api, runKey, active, activeConfig]);

  // 贴底就跟随到底；用户上滚（scroll 事件把 pinned 置 false）后不再打扰他。
  useEffect(() => {
    const el = logRef.current;
    if (el === null || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [logLines]);

  const selectProject = (workspaceId: string) => {
    setActiveProjectId(workspaceId);
    setEditing(false);
    if (cfg.activeWorkspaceId !== workspaceId) void commit({ ...cfg, activeWorkspaceId: workspaceId }, false);
  };

  const addProject = (workspaceId: string) => {
    const source = projects.find((p) => p.workspaceId === workspaceId);
    if (source === undefined) return;
    const entry: ProjectEntry = { workspaceId: source.workspaceId, path: source.path, title: source.title, configs: [], activeConfigId: '' };
    setActiveProjectId(source.workspaceId);
    void commit({ ...cfg, activeWorkspaceId: source.workspaceId, projects: [...cfg.projects, entry] }, false);
  };

  const removeProject = (workspaceId: string) => {
    const next = { ...cfg, projects: cfg.projects.filter((p) => p.workspaceId !== workspaceId) };
    setActiveProjectId(next.projects[0]?.workspaceId ?? '');
    void commit(next, false);
  };

  const selectConfig = (id: string) => {
    if (active === undefined) return;
    setEditing(false);
    void commit(patchProject(cfg, active.workspaceId, (p) => ({ ...p, activeConfigId: id })), false);
  };

  const addConfig = () => {
    if (active === undefined) return;
    const fresh: LaunchConfig = {
      id: `c${crypto.randomUUID()}`,
      name: `启动配置 ${active.configs.length + 1}`,
      command: '',
      cwd: active.path,
      envs: [],
    };
    setEditing(true);
    void commit(patchProject(cfg, active.workspaceId, (p) => ({ ...p, configs: [...p.configs, fresh], activeConfigId: fresh.id })), false);
  };

  const removeConfig = (id: string) => {
    if (active === undefined) return;
    setEditing(false);
    void commit(patchProject(cfg, active.workspaceId, (p) => {
      const kept = p.configs.filter((c) => c.id !== id);
      return { ...p, configs: kept, activeConfigId: kept[0]?.id ?? '' };
    }), false);
  };

  const saveDraft = async () => {
    if (active === undefined || draft === undefined) return;
    const cleaned: LaunchConfig = { ...draft, cwd: draft.cwd !== '' ? draft.cwd : active.path };
    const saved = await commit({
      ...patchProject(cfg, active.workspaceId, (p) => ({
        ...p,
        activeConfigId: cleaned.id,
        configs: p.configs.map((c) => (c.id === cleaned.id ? cleaned : c)),
      })),
      activeWorkspaceId: active.workspaceId,
    }, true);
    if (saved) {
      setDrafts((prev) => {
        const copy = { ...prev };
        delete copy[cleaned.id];
        return copy;
      });
    }
  };

  const runState = runKey !== '' ? runs[runKey] : undefined;
  const runText = describeRun(runState);

  const runAction = async (action: 'start' | 'stop') => {
    if (api === undefined || active === undefined || activeConfig === undefined) return;
    setError('');
    setFlash('');
    try {
      const target = { workspaceId: active.workspaceId, configId: activeConfig.id };
      if (action === 'start') {
        genRef.current += 1;   // 让上一代在飞的读取结果失效
        offsetRef.current = 0;
        pinnedRef.current = true;
        setTruncated(false);
        setLogLines([]);
      }
      const call = action === 'start' ? api.start(target) : api.stop(target);
      const snap = envelopeValue(await call, action === 'start' ? '启动' : '停止') as RunSnapshot;
      setRuns((prev) => ({ ...prev, [snap.key]: snap }));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  };

  const restartRun = async () => {
    await runAction('stop');
    await runAction('start');
  };

  const setDraft = (patch: Partial<LaunchConfig>) => {
    if (draft === undefined) return;
    setDrafts((prev) => ({ ...prev, [draft.id]: { ...draft, ...patch } }));
  };

  if (config === null) {
    return (
      <div className="ide-root">
        <div className="ide-body">
          <div className="ide-note">正在加载启动配置…</div>
          {api === undefined ? <div className="ide-warn">remote.ideConfig 不可用，面板无法读写启动配置</div> : null}
          {error !== '' ? <div className="ide-err">{error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="ide-root">
      <div className="ide-tabrow">
        {registered.map((p) => (
          <button
            key={p.workspaceId}
            type="button"
            className="ide-tab"
            data-sel={p.workspaceId === active?.workspaceId}
            onClick={() => selectProject(p.workspaceId)}
          >
            <span>{p.title}</span>
            {p.configs.length > 0 ? <span className="ide-note">{p.configs.length}</span> : null}
            <span
              className="ide-x"
              title="从面板移除这个项目（不影响工作区本身）"
              onClick={(event) => { event.stopPropagation(); removeProject(p.workspaceId); }}
            >
              ×
            </span>
          </button>
        ))}
        <span className="ide-tools">
          {!registryKnown ? (
            <span className="ide-note">工作区注册表暂不可用</span>
          ) : available.length > 0 ? (
            <select
              className="ide-select"
              value=""
              onChange={(event) => { if (event.target.value !== '') addProject(event.target.value); }}
            >
              <option value="">＋ 添加项目（{available.length}）</option>
              {available.map((p) => <option key={p.workspaceId} value={p.workspaceId}>{p.title} · {p.path}</option>)}
            </select>
          ) : <span className="ide-note">所有工作区都已加入</span>}
        </span>
      </div>

      <div className="ide-body">
        {warning !== '' ? <div className="ide-warn">{warning}</div> : null}
        {error !== '' ? <div className="ide-err">{error}</div> : null}
        {stale.length > 0 ? (
          <div className="ide-warn">
            有 {stale.length} 个项目的 DSH 工作区已不存在，其 tab 已隐藏（启动配置仍保留）：{stale.map((p) => p.title).join('、')}
            <button
              type="button"
              className="ide-btn"
              style={{ marginLeft: 10 }}
              onClick={() => { void commit({ ...cfg, projects: cfg.projects.filter((p) => !stale.includes(p)) }, false); }}
            >
              移除这些配置
            </button>
          </div>
        ) : null}

        {active === undefined ? (
          <div className="ide-empty">
            <div>还没有项目</div>
            <div className="ide-note">
              {registryKnown ? '从右上角「＋ 添加项目」里挑一个 DSH 工作区' : 'DSH 工作区注册表暂不可用，稍后重试或重新打开面板'}
            </div>
          </div>
        ) : (
          <>
            <div className="ide-head">
              <span className="ide-title">{active.title}</span>
              <span className="ide-path">{active.path}</span>
              <span style={{ flex: 1 }} />
              {active.configs.map((c) => (
                <button key={c.id} type="button" className="ide-chip" data-sel={c.id === activeConfig?.id} onClick={() => selectConfig(c.id)}>
                  {c.name}
                </button>
              ))}
              <button type="button" className="ide-chip" onClick={addConfig}>＋ 启动配置</button>
              <button
                type="button"
                className="ide-btn"
                data-on={editing}
                disabled={activeConfig === undefined}
                onClick={() => setEditing((v) => !v)}
              >
                ⚙ 启动配置
              </button>
              <button
                type="button"
                className="ide-btn"
                data-kind="primary"
                disabled={activeConfig === undefined || runState?.status === 'running'}
                onClick={() => { void runAction('start'); }}
              >
                启动
              </button>
              <button type="button" className="ide-btn" disabled={runState?.status !== 'running'} onClick={() => { void runAction('stop'); }}>停止</button>
              <button type="button" className="ide-btn" disabled={runState?.status !== 'running'} onClick={() => { void restartRun(); }}>重启</button>
              <span className="ide-note">{flash}</span>
            </div>

            {editing && draft !== undefined ? (
              <div className="ide-cfg">
                <div className="ide-line">
                  <span className="ide-label">名称</span>
                  <input className="ide-field" style={{ maxWidth: 240 }} value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} />
                  <button type="button" className="ide-btn" data-kind="primary" onClick={() => { void saveDraft(); }}>保存</button>
                  <button type="button" className="ide-btn" onClick={() => removeConfig(draft.id)}>删除</button>
                </div>
                <div className="ide-line">
                  <span className="ide-label">启动命令</span>
                  <input
                    className="ide-field ide-mono"
                    style={{ flex: 1, minWidth: 280 }}
                    placeholder="例如：mvn -o -pl kun-ai-web -am spring-boot:run"
                    value={draft.command}
                    onChange={(e) => setDraft({ command: e.target.value })}
                  />
                </div>
                <div className="ide-line">
                  <span className="ide-label">工作目录</span>
                  <input className="ide-field ide-mono" style={{ flex: 1, minWidth: 280 }} value={draft.cwd} onChange={(e) => setDraft({ cwd: e.target.value })} />
                </div>
                <div className="ide-line" style={{ alignItems: 'flex-start' }}>
                  <span className="ide-label">环境变量</span>
                  <div style={{ flex: 1 }}>
                    <table className="ide-envs">
                      <tbody>
                        {draft.envs.map((env, index) => (
                          <tr key={index}>
                            <td style={{ width: '38%' }}>
                              <input
                                className="ide-field ide-mono"
                                value={env.name}
                                placeholder="NAME"
                                onChange={(e) => setDraft({ envs: draft.envs.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)) })}
                              />
                            </td>
                            <td>
                              <input
                                className="ide-field ide-mono"
                                type={isSecretName(env.name) ? 'password' : 'text'}
                                title={isSecretName(env.name) ? '密钥类变量在界面上掩码显示' : undefined}
                                value={env.value}
                                placeholder="value"
                                onChange={(e) => setDraft({ envs: draft.envs.map((x, i) => (i === index ? { ...x, value: e.target.value } : x)) })}
                              />
                            </td>
                            <td style={{ width: 32 }}>
                              <button type="button" className="ide-btn" onClick={() => setDraft({ envs: draft.envs.filter((_, i) => i !== index) })}>×</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button type="button" className="ide-chip" onClick={() => setDraft({ envs: [...draft.envs, { name: '', value: '' }] })}>＋ 变量</button>
                  </div>
                </div>
                <div className="ide-note">持久化到 ~/.dsh/storages/dsh-newbe-ide.json（权限 0600，不在项目目录里、不会被 git 提交）</div>
              </div>
            ) : null}

            <div className="ide-logbox">
              <div
                className="ide-log"
                ref={logRef}
                onScroll={(event) => {
                  const el = event.currentTarget;
                  pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                }}
              >
                {logLines.length === 0
                  ? <span className="ide-note">{runState?.status === 'running' ? '等待输出…' : '点「启动」运行这条启动配置'}</span>
                  : logLines.map((line, index) => <div key={index}>{line}</div>)}
              </div>
              <div className="ide-note">
                {runText} · 已缓存 {logLines.length} 行
                {runState?.lossy === true || truncated ? '（输出过快或过长，早期日志已被丢弃）' : ''}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export const inject = ['slots', 'remote'];

export async function apply(ctx: any): Promise<void> {
  ctx.effect(() => ensureStyles(), 'dsh-newbe-ide: styles');

  let unmount: undefined | (() => void | Promise<void>);
  try {
    unmount = await ctx.remote.$mount(REMOTE_CONTRIBUTION);
  } catch (e) {
    console.error('[dsh-newbe-ide] remote contribution 挂载失败', e);
  }
  if (unmount !== undefined) {
    ctx.effect(() => () => { void unmount?.(); }, 'dsh-newbe-ide: remote unmount');
  }

  const api = ctx.get('remote.ideConfig') as RemoteIde | undefined;
  if (api === undefined) console.warn('[dsh-newbe-ide] remote.ideConfig 不可用，面板无法读写启动配置');

  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    { name: 'conversation.view', id: VIEW_ID, order: VIEW_ORDER, label: 'IDE' },
    () => <Panel api={api} ctx={ctx} />,
  ));
}
