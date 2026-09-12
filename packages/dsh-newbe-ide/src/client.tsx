/**
 * dsh-newbe-ide Web 客户端，两个面：
 *
 * 1. 会话视图 tab「IDE」（`conversation.view`，紧随 对话 / 轨迹 / 上下文）：
 *    **只读控制台**——项目 tab、启动配置、启停按钮、日志。这里不出现任何输入控件，
 *    与 `dsh-context` 的做法一致（它的视图里同样没有输入框）。
 * 2. 配置页（`settings.plugins.tab`，设置 → 插件 → IDE）：项目与启动配置的增删改，
 *    包括名称、启动命令、工作目录、环境变量。配置存宿主侧
 *    `$DSH_HOME/storages/dsh-newbe-ide.json`，不进 settings.yaml。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultState,
  ideLoadSchema,
  pickActiveConfig,
  ideStateSchema,
  runKeyOf,
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
  type RunRead,
  type RunSnapshot,
  type RunTarget,
} from './schema.js';
import { isSecretName } from './lines.js';

export const NS = 'dsh-newbe-ide';
const VIEW_ID = 'dsh-newbe-ide';
/** 会话视图顺序：对话 0 / 轨迹 10 / 上下文 20 / IDE 30。 */
const VIEW_ORDER = 30;
const SETTINGS_TAB_ORDER = 30;
/** 面板本地的日志保留上限；超出会提示"早期日志已被丢弃"。 */
const LOG_LIMIT = 4000;
const POLL_MS = 800;
/** 每 N 次轮询顺带重读一次配置，让设置页里的改动近乎即时地反映到视图。 */
const CONFIG_REFRESH_EVERY = 3;

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
.ide-body{display:flex;flex-direction:column;flex:1;min-height:0;padding:12px 16px;gap:10px;overflow:auto}
.ide-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ide-cmd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--dsw-alias-label-secondary,#697586);word-break:break-all}
.ide-cmdline{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.ide-configtitle{font-size:15px;font-weight:600}
.ide-title{font-size:14px;font-weight:600}
.ide-path{color:var(--dsw-alias-label-secondary,#697586);font-size:11px;word-break:break-all}
.ide-chip{border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:999px;padding:2px 9px;font-size:12px;color:var(--dsw-alias-label-secondary,#697586);background:none;font:inherit;cursor:pointer;white-space:nowrap}
.ide-chip:hover{border-color:var(--dsw-alias-label-secondary,#697586)}
.ide-chip[data-sel=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(51,112,255,.12));border-color:var(--dsw-alias-brand-primary,#3370ff);color:var(--dsw-alias-brand-primary,#3370ff)}
.ide-btn{border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:7px;padding:4px 11px;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary,#1f2329);background:none;cursor:pointer}
.ide-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.07))}
.ide-btn[data-kind=primary]{background:var(--dsw-alias-brand-primary,#3370ff);border-color:transparent;color:#fff}
.ide-btn[data-kind=danger]:hover{color:var(--dsw-alias-state-error-primary,#d83931);border-color:var(--dsw-alias-state-error-primary,#d83931)}
.ide-btn:disabled{opacity:.5;cursor:default}
.ide-field{background:var(--dsw-alias-bg-module-platform,#fff);border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:7px;padding:5px 9px;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary,#1f2329);outline:none}
.ide-field:focus{border-color:var(--dsw-alias-brand-primary,#3370ff)}
.ide-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ide-empty{margin:auto;text-align:center;color:var(--dsw-alias-label-secondary,#697586);display:flex;flex-direction:column;gap:8px;align-items:center}
.ide-note{font-size:11px;color:var(--dsw-alias-label-secondary,#697586)}
.ide-warn{border:1px dashed var(--dsw-alias-state-warn-primary,#e7a100);color:var(--dsw-alias-state-warn-primary,#e7a100);border-radius:8px;padding:7px 10px;font-size:12px}
.ide-err{color:var(--dsw-alias-state-error-primary,#d83931);font-size:12px}
.ide-logbox{display:flex;flex-direction:column;gap:4px;flex:1;min-height:0}
.ide-log{flex:1;min-height:160px;max-height:56vh;overflow:auto;background:rgba(128,128,128,.10);border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:9px;padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all}
.ide-section{display:flex;flex-direction:column;gap:10px}
.ide-sectiontitle{font-size:13px;font-weight:600;margin-top:4px}
.ide-card{border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:9px;background:var(--dsw-alias-bg-module-platform,#fff);padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.ide-cardhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ide-form{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--dsw-alias-border-l2,#d9dce1);padding-top:8px}
.ide-line{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ide-label{color:var(--dsw-alias-label-secondary,#697586);font-size:12px;width:64px;flex:none}
.ide-envs{width:100%;border-collapse:collapse}
.ide-envs td{padding:3px 4px;vertical-align:middle}
.ide-envs input{width:100%}
.ide-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
/* IDE 视图占满面板：本视图在场时收起底部的消息输入框。
   DSH 没有"按视图隐藏输入框"的 API（conversation.composer 链的 select 只能拿到
   sessionId/session/pendingInteraction，看不到当前视图），因此与 dsh-context 同法：
   用 :has() 按视图根元素收起座位。末尾的 :not(...) 是保护——输入框里一旦承载
   审批 / 追问 / 计划复核，必须留着，否则用户没法回答。 */
[data-conversation-scroll]:has(.ide-root)>[data-composer-seat]:not(:has([data-approval-key],[data-question-key],[data-plan-review-key])){display:none}
[data-conversation-scroll]:has(.ide-root)~[data-width-handle]{display:none}
`;
  document.head.appendChild(style);
  return () => { style.remove(); };
}

/** 项目内的不可变更新：只改一条 project entry，其余原样带过。 */
function patchProject(config: IdeState, workspaceId: string, mutate: (project: ProjectEntry) => ProjectEntry): IdeState {
  return { ...config, projects: config.projects.map((p) => (p.workspaceId === workspaceId ? mutate(p) : p)) };
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

function activeOf(config: IdeState, projects: IdeProjectView[], activeProjectId: string) {
  const registryKnown = projects.length > 0;
  const isRegistered = (workspaceId: string) => projects.some((w) => w.workspaceId === workspaceId);
  const registered = registryKnown ? config.projects.filter((p) => isRegistered(p.workspaceId)) : config.projects;
  const stale = registryKnown ? config.projects.filter((p) => !isRegistered(p.workspaceId)) : [];
  const active = registered.find((p) => p.workspaceId === activeProjectId) ?? registered[0];
  return { registryKnown, registered, stale, active };
}

/* ------------------------------------------------------------------ *
 * 会话视图：只读控制台
 * ------------------------------------------------------------------ */

interface ViewProps {
  /** 宿主 RPC；挂载失败时为 undefined，视图降级为可见提示。 */
  api: RemoteIde | undefined;
  /** 客户端 ctx：用于订阅连接重置。 */
  ctx: any;
}

function IdeView({ api, ctx }: ViewProps): React.ReactElement {
  const [config, setConfig] = useState<IdeState | null>(null);
  const [projects, setProjects] = useState<IdeProjectView[]>([]);
  const [warning, setWarning] = useState('');
  const [activeProjectId, setActiveProjectId] = useState('');
  const [runs, setRuns] = useState<Record<string, RunSnapshot>>({});
  const [logLines, setLogLines] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const offsetRef = useRef(0);
  const logRef = useRef<HTMLDivElement | null>(null);
  /** 是否贴底：由 scroll 事件维护。追加后量高度会把"一次涌入多行"误判成用户上滚。 */
  const pinnedRef = useRef(true);
  /** 运行代次：重启后自增，用来丢弃上一代进程还在飞的读取结果。 */
  const genRef = useRef(0);
  const tickRef = useRef(0);

  /** 局部选中项：切换启动配置只动这里，不等磁盘回读（回读会把它盖回去）。 */
  const [activeConfigIds, setActiveConfigIds] = useState<Record<string, string>>({});
  const cfg: IdeState = config ?? defaultState();
  const { registered, stale, active } = activeOf(cfg, projects, activeProjectId);
  const activeConfig = active !== undefined ? pickActiveConfig(active, activeConfigIds[active.workspaceId] ?? '') : undefined;
  const runKey = active !== undefined && activeConfig !== undefined
    ? runKeyOf({ workspaceId: active.workspaceId, configId: activeConfig.id })
    : '';
  const runState = runKey !== '' ? runs[runKey] : undefined;
  const runText = describeRun(runState);

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

  // 日志按启动配置分家：切换配置就清空缓冲，否则会把上一条的输出串过来。
  useEffect(() => {
    offsetRef.current = 0;
    genRef.current += 1;
    pinnedRef.current = true;
    setTruncated(false);
    setLogLines([]);
  }, [runKey]);

  useEffect(() => {
    void reload();
    return ctx.on('connection/reset', () => { void reload(); });
  }, [ctx, reload]);

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
        if (tickRef.current % CONFIG_REFRESH_EVERY === 0) void reload();
        tickRef.current += 1;
        const chunk = envelopeValue(await api.read({ ...target, from: offsetRef.current }), '读取日志') as RunRead;
        if (stopped || genRef.current !== gen) return;
        offsetRef.current = chunk.next;
        if (chunk.dropped) setTruncated(true);
        if (chunk.lines.length > 0) {
          setLogLines((prev) => {
            const merged = [...prev, ...chunk.lines];
            if (merged.length <= LOG_LIMIT) return merged;
            setTruncated(true);
            return merged.slice(merged.length - LOG_LIMIT);
          });
        }
      } catch (e) {
        if (!stopped && genRef.current === gen) setError(String((e as Error)?.message ?? e));
      }
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, POLL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [api, runKey, active, activeConfig, reload]);

  // 贴底就跟随到底；用户上滚（scroll 事件把 pinned 置 false）后不再打扰他。
  useEffect(() => {
    const el = logRef.current;
    if (el === null || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [logLines]);

  // 选中项是视图状态，不落盘：视图从不写配置，只有设置页写。
  // 两个面都整份写盘的话，并发保存会互相覆盖；保持"单写者"就没有这个窗口。
  const selectProject = (workspaceId: string) => {
    setActiveProjectId(workspaceId);
  };

  const selectConfig = (configId: string) => {
    if (active === undefined) return;
    setActiveConfigIds((prev) => ({ ...prev, [active.workspaceId]: configId }));
  };

  const runAction = async (action: 'start' | 'stop') => {
    if (api === undefined || active === undefined || activeConfig === undefined) return;
    setError('');
    try {
      const target = { workspaceId: active.workspaceId, configId: activeConfig.id };
      if (action === 'start') {
        genRef.current += 1; // 让上一代在飞的读取结果失效
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

  if (config === null) {
    return (
      <div className="ide-root">
        <div className="ide-body">
          <div className="ide-note">正在加载启动配置…</div>
          {api === undefined ? <div className="ide-warn">remote.ideConfig 不可用</div> : null}
          {error !== '' ? <div className="ide-err">{error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="ide-root">
      {registered.length > 0 ? (
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
            </button>
          ))}
        </div>
      ) : null}

      <div className="ide-body">
        {warning !== '' ? <div className="ide-warn">{warning}</div> : null}
        {error !== '' ? <div className="ide-err">{error}</div> : null}
        {stale.length > 0 ? (
          <div className="ide-warn">
            有 {stale.length} 个项目的 DSH 工作区已不存在，其 tab 已隐藏（启动配置仍保留）：{stale.map((p) => p.title).join('、')}
          </div>
        ) : null}

        {active === undefined ? (
          <div className="ide-empty">
            <div>还没有项目</div>
            <div className="ide-note">在 设置 → 插件 → IDE 里添加项目与启动配置</div>
          </div>
        ) : (
          <>
            <div className="ide-toolbar">
              <span className="ide-path">{active.title} · {active.path}</span>
              <span style={{ flex: 1 }} />
              {active.configs.map((c) => (
                <button key={c.id} type="button" className="ide-chip" data-sel={c.id === activeConfig?.id} onClick={() => selectConfig(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>

            {activeConfig === undefined ? (
              <div className="ide-note">这个项目还没有启动配置 —— 在 设置 → 插件 → IDE 里添加</div>
            ) : (
              <>
                <div className="ide-toolbar">
                  <span className="ide-configtitle">{activeConfig.name}</span>
                  <span className="ide-note">{runText}</span>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="ide-btn"
                    data-kind="primary"
                    disabled={runState?.status === 'running'}
                    onClick={() => { void runAction('start'); }}
                  >
                    启动
                  </button>
                  <button type="button" className="ide-btn" disabled={runState?.status !== 'running'} onClick={() => { void runAction('stop'); }}>停止</button>
                  <button
                    type="button"
                    className="ide-btn"
                    disabled={runState?.status !== 'running'}
                    onClick={() => { void (async () => { await runAction('stop'); await runAction('start'); })(); }}
                  >
                    重启
                  </button>
                </div>

                <div className="ide-cmdline">
                  <span className="ide-label">启动命令</span>
                  <span className="ide-cmd">{activeConfig.command === '' ? '（未设置）' : activeConfig.command}</span>
                </div>

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
                    已缓存 {logLines.length} 行
                    {runState?.lossy === true || truncated ? '（输出过快或过长，早期日志已被丢弃）' : ''}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 设置页：项目与启动配置的增删改
 * ------------------------------------------------------------------ */

interface SettingsProps {
  api: RemoteIde | undefined;
}

function IdeSettings({ api }: SettingsProps): React.ReactElement {
  const [config, setConfig] = useState<IdeState | null>(null);
  const [projects, setProjects] = useState<IdeProjectView[]>([]);
  const [warning, setWarning] = useState('');
  const [drafts, setDrafts] = useState<Record<string, LaunchConfig>>({});
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');

  const cfg: IdeState = config ?? defaultState();

  const reload = useCallback(async () => {
    if (api === undefined) {
      setWarning('remote.ideConfig 不可用，无法读写启动配置');
      return;
    }
    try {
      const load = envelopeValue(await api.load(), '读取启动配置') as IdeLoad;
      setConfig(load.config);
      setProjects(load.projects);
      setWarning(load.warning);
      setError('');
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [api]);

  useEffect(() => { void reload(); }, [reload]);

  /**
   * 先本地生效（乐观），再落盘并以宿主返回的状态为准。
   * 落盘失败必须回到磁盘真实状态：否则页面会显示从未写成的配置，后续提交还会基于它继续写。
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

  const available = projects.filter((p) => !cfg.projects.some((entry) => entry.workspaceId === p.workspaceId));

  const addProject = (workspaceId: string) => {
    const source = projects.find((p) => p.workspaceId === workspaceId);
    if (source === undefined) return;
    const entry: ProjectEntry = { workspaceId: source.workspaceId, path: source.path, title: source.title, configs: [], activeConfigId: '' };
    void commit({ ...cfg, activeWorkspaceId: source.workspaceId, projects: [...cfg.projects, entry] }, false);
  };

  const addConfig = (project: ProjectEntry) => {
    const fresh: LaunchConfig = {
      id: `c${crypto.randomUUID()}`,
      name: `启动配置 ${project.configs.length + 1}`,
      command: '',
      cwd: project.path,
      envs: [],
    };
    setDrafts((prev) => ({ ...prev, [fresh.id]: fresh }));
    void commit(patchProject(cfg, project.workspaceId, (p) => ({
      ...p,
      configs: [...p.configs, fresh],
      activeConfigId: p.activeConfigId === '' ? fresh.id : p.activeConfigId,
    })), false);
  };

  const removeConfig = (project: ProjectEntry, configId: string) => {
    setDrafts((prev) => { const copy = { ...prev }; delete copy[configId]; return copy; });
    void commit(patchProject(cfg, project.workspaceId, (p) => {
      const kept = p.configs.filter((c) => c.id !== configId);
      return { ...p, configs: kept, activeConfigId: p.activeConfigId === configId ? (kept[0]?.id ?? '') : p.activeConfigId };
    }), false);
  };

  const patchDraft = (project: ProjectEntry, draft: LaunchConfig, patch: Partial<LaunchConfig>) => {
    setDrafts((prev) => ({ ...prev, [draft.id]: { ...draft, ...patch } }));
  };

  const saveDraft = async (project: ProjectEntry, draft: LaunchConfig) => {
    const cleaned: LaunchConfig = { ...draft, cwd: draft.cwd !== '' ? draft.cwd : project.path };
    const saved = await commit(patchProject(cfg, project.workspaceId, (p) => ({
      ...p,
      activeConfigId: cleaned.id,
      configs: p.configs.map((c) => (c.id === cleaned.id ? cleaned : c)),
    })), true);
    if (saved) {
      setDrafts((prev) => { const copy = { ...prev }; delete copy[cleaned.id]; return copy; });
    }
  };

  if (config === null) {
    return (
      <div className="ide-root">
        <div className="ide-body">
          <div className="ide-note">正在加载启动配置…</div>
          {api === undefined ? <div className="ide-warn">remote.ideConfig 不可用</div> : null}
          {error !== '' ? <div className="ide-err">{error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="ide-root">
      <div className="ide-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="ide-title">IDE · 启动配置</span>
          <span className="ide-note">{flash}</span>
        </div>
        <div className="ide-note">
          按 DSH 工作区组织，每个项目下可有多条启动配置。持久化到 ~/.dsh/storages/dsh-newbe-ide.json（权限 0600，不在项目目录里、不会被 git 提交）。
        </div>

        {warning !== '' ? <div className="ide-warn">{warning}</div> : null}
        {error !== '' ? <div className="ide-err">{error}</div> : null}

        <div className="ide-toolbar">
          {!projects.length ? (
            <span className="ide-note">DSH 工作区注册表暂不可用，稍后重试</span>
          ) : available.length > 0 ? (
            <select
              className="ide-field"
              value=""
              onChange={(event) => { if (event.target.value !== '') addProject(event.target.value); }}
            >
              <option value="">＋ 添加项目（{available.length} 个可选工作区）</option>
              {available.map((p) => <option key={p.workspaceId} value={p.workspaceId}>{p.title} · {p.path}</option>)}
            </select>
          ) : (
            <span className="ide-note">所有工作区都已加入</span>
          )}
        </div>

        {cfg.projects.length === 0 ? (
          <div className="ide-empty">
            <div>还没有项目</div>
            <div className="ide-note">从上面的下拉里挑一个 DSH 工作区</div>
          </div>
        ) : null}

        {cfg.projects.map((project) => (
          <div className="ide-card" key={project.workspaceId}>
            <div className="ide-cardhead">
              <span className="ide-title">{project.title}</span>
              <span className="ide-path">{project.path}</span>
              <span style={{ flex: 1 }} />
              <button type="button" className="ide-chip" onClick={() => addConfig(project)}>＋ 启动配置</button>
              <button
                type="button"
                className="ide-btn"
                data-kind="danger"
                onClick={() => { void commit({ ...cfg, projects: cfg.projects.filter((p) => p.workspaceId !== project.workspaceId) }, false); }}
              >
                移除项目
              </button>
            </div>

            {project.configs.length === 0 ? <div className="ide-note">这个项目还没有启动配置</div> : null}

            {project.configs.map((config2) => {
              const draft = drafts[config2.id] ?? config2;
              return (
                <div className="ide-form" key={config2.id}>
                  <div className="ide-line">
                    <span className="ide-label">名称</span>
                    <input className="ide-field" style={{ maxWidth: 240 }} value={draft.name} onChange={(e) => patchDraft(project, draft, { name: e.target.value })} />
                    <button type="button" className="ide-btn" data-kind="primary" onClick={() => { void saveDraft(project, draft); }}>保存</button>
                    <button type="button" className="ide-btn" data-kind="danger" onClick={() => removeConfig(project, config2.id)}>删除</button>
                  </div>
                  <div className="ide-line">
                    <span className="ide-label">启动命令</span>
                    <input
                      className="ide-field ide-mono"
                      style={{ flex: 1, minWidth: 280 }}
                      placeholder="例如：mvn -o -pl kun-ai-web spring-boot:run"
                      value={draft.command}
                      onChange={(e) => patchDraft(project, draft, { command: e.target.value })}
                    />
                  </div>
                  <div className="ide-line">
                    <span className="ide-label">工作目录</span>
                    <input className="ide-field ide-mono" style={{ flex: 1, minWidth: 280 }} value={draft.cwd} onChange={(e) => patchDraft(project, draft, { cwd: e.target.value })} />
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
                                  onChange={(e) => patchDraft(project, draft, { envs: draft.envs.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)) })}
                                />
                              </td>
                              <td>
                                <input
                                  className="ide-field ide-mono"
                                  type={isSecretName(env.name) ? 'password' : 'text'}
                                  title={isSecretName(env.name) ? '密钥类变量在界面上掩码显示' : undefined}
                                  value={env.value}
                                  placeholder="value"
                                  onChange={(e) => patchDraft(project, draft, { envs: draft.envs.map((x, i) => (i === index ? { ...x, value: e.target.value } : x)) })}
                                />
                              </td>
                              <td style={{ width: 32 }}>
                                <button type="button" className="ide-btn" onClick={() => patchDraft(project, draft, { envs: draft.envs.filter((_, i) => i !== index) })}>×</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button type="button" className="ide-chip" onClick={() => patchDraft(project, draft, { envs: [...draft.envs, { name: '', value: '' }] })}>＋ 变量</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
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

  // 会话视图：只读控制台，不出现输入控件。
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    { name: 'conversation.view', id: VIEW_ID, order: VIEW_ORDER, label: 'IDE' },
    () => <IdeView api={api} ctx={ctx} />,
  ));

  // 配置页：项目与启动配置的增删改（设置 → 插件 → IDE）。
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
    { name: 'settings.plugins.tab', id: VIEW_ID, order: SETTINGS_TAB_ORDER, label: () => 'IDE' },
    () => <IdeSettings api={api} />,
  ));
}
