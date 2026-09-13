/**
 * dsh-newbe-ide Web 客户端：只注册一个面——会话视图 tab「IDE」
 * （`conversation.view`，紧随 对话 / 轨迹 / 上下文）。
 *
 * 面板里从上到下：
 *   - 项目 tab 行（横向滑动、可收起、`»` 里是全部项目、`只看运行中` 过滤）
 *   - 主从卡片（2026-09-12 由票 08 的变体 C 定稿）：左列是这个项目的启动配置
 *     （状态点 + 名称 + 端口 + 状态或运行时长，配置多了纵向滚），右列是选中那条的详情
 *     （状态 / 端口 / 运行时长 / 退出码 指标块、启动·停止·重启、启动命令、过滤条）
 *   - 日志区（日志区吃掉剩余高度，滚动只发生在它内部）
 *
 * 「⚙ 配置」展开的配置块承担项目与启动配置的增删改，以及从 IDEA 导入；收起时零占位。
 * 它**一次只编辑左列选中的那一条**（改完在同一条表单里保存或删除），不再把项目下所有配置
 * 的表单一起堆出来——配置一多，那种堆法既看不出在改哪条，也容易点错保存。
 * 配置存宿主侧 `$DSH_HOME/storages/dsh-newbe-ide.json`，不进 settings.yaml；
 * **面板是唯一的写者**——曾经短暂另注册过一个设置页，已删除：两个面都整份写盘会互相覆盖。
 *
 * 与 上下文 tab 一致的行为：本视图在场时收起底部消息输入框，并让视图占满面板。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  availableWorkspaces,
  basenameOf,
  defaultState,
  ideaDiscoveryRequestSchema,
  ideaDiscoverySchema,
  ideLoadSchema,
  logHistoryRequestSchema,
  logHistorySchema,
  DEFAULT_HISTORY_LINES,
  pickActiveConfig,
  uniqueTitle,
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
  type IdeaCandidateView,
  type IdeaDiscovery,
  type LogHistory,
  type RunRead,
  type RunSnapshot,
  type RunStatus,
  type RunTarget,
} from './schema.js';
import { isSecretName } from './lines.js';
import { buildLaunchConfig, plannedConfigName } from './ideaconfig.js';
import { aggregateStatus, formatUptime, readLostLines } from './rundisplay.js';
import { DEFAULT_LEVELS, LEVELS, compileMatcher, filterLines, type RunLevel } from './filter.js';

export const NS = 'dsh-newbe-ide';
const VIEW_ID = 'dsh-newbe-ide';
/** 会话视图顺序：对话 0 / 轨迹 10 / 上下文 20 / IDE 30。 */
const VIEW_ORDER = 30;
/** 面板本地的日志保留上限；超出会提示"早期日志已被丢弃"。 */
const LOG_LIMIT = 4000;
/** 单帧最多渲染多少行：过滤是全量的，渲染要封顶，否则长日志会卡。 */
const RENDER_LIMIT = 2000;
const POLL_MS = 800;
/** 每 N 次轮询顺带重读一次配置，外部改动（另开一个会话/浏览器）能跟着更新。 */
const CONFIG_REFRESH_EVERY = 3;

type RemoteEnvelope<T> = { ok: true; value: T } | { ok: false; error?: { message?: string } };
type RemoteIde = {
  load(): Promise<RemoteEnvelope<unknown>>;
  submit(next: unknown): Promise<RemoteEnvelope<unknown>>;
  start(target: RunTarget): Promise<RemoteEnvelope<unknown>>;
  stop(target: RunTarget): Promise<RemoteEnvelope<unknown>>;
  read(request: RunTarget & { from: number }): Promise<RemoteEnvelope<unknown>>;
  runs(): Promise<RemoteEnvelope<unknown>>;
  history(request: RunTarget & { tail: number }): Promise<RemoteEnvelope<unknown>>;
  discover(request: { workspaceId: string }): Promise<RemoteEnvelope<unknown>>;
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
      id: 'dsh-newbe-ide#ideConfig/discover',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'discover',
      invocation: { kind: 'direct' as const },
      parameters: [{ name: 'request', wire: 'request', source: 'json' as const, codec: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#IdeaDiscoveryRequest', schema: ideaDiscoveryRequestSchema } }],
      result: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#IdeaDiscovery', schema: ideaDiscoverySchema },
    },
    {
      id: 'dsh-newbe-ide#ideConfig/history',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'history',
      invocation: { kind: 'direct' as const },
      parameters: [{ name: 'request', wire: 'request', source: 'json' as const, codec: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#LogHistoryRequest', schema: logHistoryRequestSchema } }],
      result: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#LogHistory', schema: logHistorySchema },
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

/**
 * 宿主侧端点是在**启动时**装配的：老进程遇到新端点只会 404。
 * 这种失败必须自己说清"重启 dsh web"，否则看起来像插件坏了。
 */
function describeRpcFailure(action: string, error: unknown): string {
  const message = String((error as Error)?.message ?? error);
  if (/\b404\b|transport failure/i.test(message)) {
    return `${action}失败：宿主侧还没有这个接口，重启 dsh web 后生效`;
  }
  return message;
}

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
.ide-tabrow[data-dragging=true]{cursor:grabbing;user-select:none}
.ide-tab .ide-x{opacity:0;font-size:13px;line-height:1;padding:0 2px;border-radius:4px;color:var(--dsw-alias-label-secondary,#697586)}
.ide-tab:hover .ide-x{opacity:1}
.ide-tab .ide-x:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.07))}
.ide-tools{margin-left:auto;display:flex;align-items:center;gap:6px;padding-left:12px;flex:none}
.ide-overflow{position:relative}
.ide-overflow>summary{list-style:none;cursor:pointer;min-width:26px;height:24px;border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:7px;display:grid;place-items:center;color:var(--dsw-alias-label-secondary,#697586);font-size:12px}
.ide-overflow>summary::-webkit-details-marker{display:none}
.ide-overflow>summary:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.07))}
.ide-overflow ul{position:absolute;right:0;top:30px;z-index:30;background:var(--dsw-alias-bg-module-platform,#fff);border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:9px;box-shadow:0 14px 34px rgba(0,0,0,.28);padding:6px;margin:0;list-style:none;min-width:240px;max-height:320px;overflow:auto}
.ide-overflow li{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary,#697586);white-space:nowrap}
.ide-overflow li:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.07));color:var(--dsw-alias-label-primary,#1f2329)}
.ide-board{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;align-content:start;overflow:auto;flex:1;min-height:0}
/* 一行一条配置：名字与状态各自单行省略，否则窄卡里会折成"停 / 止"那样的竖排 */
.ide-cardrow{display:flex;align-items:center;gap:8px;padding:5px 7px;border-radius:7px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08));font-size:12px;min-width:0}
.ide-cardrow .ide-name{font-weight:600;cursor:pointer;flex:none;max-width:9.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-cardrow .ide-note{flex:none;white-space:nowrap}
.ide-cardrow .ide-btn{flex:none;white-space:nowrap;padding:2px 9px}
.ide-addpath{display:flex;align-items:center;gap:6px}
.ide-addpath .ide-field{flex:1;min-width:0}
.ide-addlist{display:flex;flex-direction:column;gap:6px;max-height:224px;overflow:auto}
.ide-addcard .ide-name{max-width:15em}
.ide-cardrow .ide-last{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary,#697586);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-body{display:flex;flex-direction:column;flex:1;min-height:0;padding:12px 16px;gap:10px;overflow:auto}
/* 视图要填满面板：滚动交给日志区自己，其余不滚 */
.ide-fill{overflow:hidden}
.ide-cmd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--dsw-alias-label-secondary,#697586);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-configtitle{font-size:15px;font-weight:600}
.ide-title{font-size:14px;font-weight:600}
.ide-chip{border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:999px;padding:2px 9px;font-size:12px;color:var(--dsw-alias-label-secondary,#697586);background:none;font:inherit;cursor:pointer;white-space:nowrap}
.ide-chip:hover{border-color:var(--dsw-alias-label-secondary,#697586)}
.ide-chip[data-sel=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(51,112,255,.12));border-color:var(--dsw-alias-brand-primary,#3370ff);color:var(--dsw-alias-brand-primary,#3370ff)}
.ide-btn{border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:7px;padding:4px 11px;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary,#1f2329);background:none;cursor:pointer}
.ide-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.07))}
.ide-btn[data-kind=primary]{background:var(--dsw-alias-brand-primary,#3370ff);border-color:transparent;color:#fff}
.ide-btn[data-kind=danger]:hover{color:var(--dsw-alias-state-error-primary,#d83931);border-color:var(--dsw-alias-state-error-primary,#d83931)}
.ide-btn:disabled{opacity:.5;cursor:default}
/* data-on = 按钮处于「已按下 / 已开启」态（⚙ 配置展开、日志跟随暂停）。此前只有属性没有样式，等于没反馈。 */
.ide-btn[data-on=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(51,112,255,.12));border-color:var(--dsw-alias-brand-primary,#3370ff);color:var(--dsw-alias-brand-primary,#3370ff)}
.ide-field{background:var(--dsw-alias-bg-module-platform,#fff);border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:7px;padding:5px 9px;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary,#1f2329);outline:none}
.ide-field:focus{border-color:var(--dsw-alias-brand-primary,#3370ff)}
.ide-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ide-empty{margin:auto;text-align:center;color:var(--dsw-alias-label-secondary,#697586);display:flex;flex-direction:column;gap:8px;align-items:center}
.ide-note{font-size:11px;color:var(--dsw-alias-label-secondary,#697586)}
.ide-warn{border:1px dashed var(--dsw-alias-state-warn-primary,#e7a100);color:var(--dsw-alias-state-warn-primary,#e7a100);border-radius:8px;padding:7px 10px;font-size:12px}
.ide-err{color:var(--dsw-alias-state-error-primary,#d83931);font-size:12px}
.ide-logbox{display:flex;flex-direction:column;gap:4px;flex:1;min-height:0}
.ide-logfoot{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ide-logstats{min-width:0;overflow:hidden;text-overflow:ellipsis}
.ide-logfoot .ide-btn{flex:none}
.ide-log{flex:1;min-height:120px;overflow:auto;background:rgba(128,128,128,.10);border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:9px;padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all}
.ide-card{border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:9px;background:var(--dsw-alias-bg-module-platform,#fff);padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.ide-cardhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ide-cfg{border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:9px;background:var(--dsw-alias-bg-module-platform,#fff);padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.ide-form{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--dsw-alias-border-l2,#d9dce1);padding-top:8px}
.ide-line{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ide-label{color:var(--dsw-alias-label-secondary,#697586);font-size:12px;width:64px;flex:none}
.ide-envs{width:100%;border-collapse:collapse}
.ide-envs td{padding:3px 4px;vertical-align:middle}
.ide-envs input{width:100%}
.ide-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
/* 主从卡片：左列配置列表（多了纵向滚），右列选中那条的详情 */
.ide-master{display:flex;flex:none;max-height:240px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:10px;background:var(--dsw-alias-bg-module-platform,#fff)}
.ide-mlist{width:224px;flex:none;display:flex;flex-direction:column;gap:2px;padding:8px;overflow:auto;border-right:1px solid var(--dsw-alias-border-l2,#d9dce1)}
.ide-mhead{padding:2px 6px 6px;min-width:0}
.ide-mheadtop{display:flex;align-items:center;gap:6px;min-width:0}
.ide-mheadtop .ide-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-mheadtop .ide-btn{flex:none;padding:2px 9px}
/* 折叠后的紧凑行：一行放"这条配置是谁 + 能干什么"，高度让给日志 */
/* flex:1 是必须的：.ide-master 是横向 flex 容器，子元素默认 flex:0 1 auto ⇒ 宽度只等于内容宽，
   里面的 spacer 撑不开、按钮就到不了最右（展开态没这个问题，因为 .ide-detail 有 flex:1）。 */
.ide-foldrow{flex:1;display:flex;align-items:center;gap:8px;padding:6px 11px;min-width:0}
.ide-foldrow .ide-btn{flex:none;padding:2px 9px}
.ide-mdot-title{display:flex;align-items:center;gap:7px;min-width:0;cursor:default}
.ide-foldrow .ide-mname{max-width:18em}
.ide-mpath{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-mitem{display:flex;align-items:center;gap:7px;width:100%;padding:6px 7px;border:1px solid transparent;border-radius:7px;background:none;font:inherit;font-size:12px;color:inherit;text-align:left;cursor:pointer;min-width:0}
.ide-mitem:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.07))}
.ide-mitem[data-sel=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(51,112,255,.12));border-color:var(--dsw-alias-brand-primary,#3370ff)}
.ide-mname{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-mstate{margin-left:auto;flex:none;max-width:104px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-madd{justify-content:center;color:var(--dsw-alias-label-secondary,#697586)}
.ide-detail{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;padding:9px 11px;overflow:auto}
.ide-dhead{display:flex;align-items:center;gap:9px;flex-wrap:wrap;min-width:0}
.ide-dmeter{display:flex;gap:8px;flex-wrap:wrap}
.ide-metric{display:inline-flex;align-items:baseline;gap:6px;padding:3px 9px;border-radius:7px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.08));font-size:11.5px;min-width:0}
.ide-metric b{font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ide-dactions{display:flex;gap:6px;flex-wrap:wrap}
.ide-dcmd{display:flex;align-items:center;gap:10px;min-width:0}
.ide-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary,#a8b0ba)}
.ide-dot[data-state=running]{background:var(--dsw-alias-state-success-primary,#2ea043)}
.ide-dot[data-state=failed]{background:var(--dsw-alias-state-error-primary,#d83931)}
.ide-dot[data-state=exited]{background:var(--dsw-alias-state-warn-primary,#e7a100)}
.ide-port{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;opacity:.85}

.ide-filterbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ide-filterbar .ide-field{padding:3px 8px;min-width:180px}
.ide-hit{background:rgba(255,196,0,.18)}
.ide-lv-ERROR{color:var(--dsw-alias-state-error-primary,#d83931)}
.ide-lv-INFO{color:var(--dsw-alias-label-primary,#1f2329)}
.ide-lv-WARN{color:var(--dsw-alias-state-warn-primary,#e7a100)}
.ide-lv-DEBUG,.ide-lv-OTHER{color:var(--dsw-alias-label-secondary,#697586)}
/* IDE 视图占满面板：本视图在场时收起底部的消息输入框。
   DSH 没有"按视图隐藏输入框"的 API（conversation.composer 链的 select 只能拿到
   sessionId/session/pendingInteraction，看不到当前视图），因此与 dsh-context 同法：
   用 :has() 按视图根元素收起座位。末尾的 :not(...) 是保护——输入框里一旦承载
   审批 / 追问 / 计划复核，必须留着，否则用户没法回答。 */
[data-conversation-scroll]:has(.ide-view)>[data-composer-seat]:not(:has([data-approval-key],[data-question-key],[data-plan-review-key])){display:none}
[data-conversation-scroll]:has(.ide-view)~[data-width-handle]{display:none}
/* 让日志区正好等于面板高度，而不是随内容无限变高。
   DSH 的会话骨架在 active 阶段把视图区设成 flex:1 0 auto + min-height:auto（只在
   composer overlay 模式下才夹成 flex:1 1 0 + min-height:0），所以视图高度由内容决定：
   日志一长，整页跟着变长，得把页面拖到底才能看到最新一行。
   这里照 DSH 自己的做法，把包住本视图的那层夹到确定高度——不碰它的哈希类名，
   用 :has(.ide-view) 定位包含本视图的直接子层。 */
[data-conversation-scroll]:has(.ide-view)>[data-slot="conversation.session"]>*:has(.ide-view),
[data-conversation-scroll]:has(.ide-view)>[data-slot="conversation.session"]:has(.ide-view){
  flex:1 1 0;
  min-height:0;
  overflow:hidden;
}
`;
  document.head.appendChild(style);
  return () => { style.remove(); };
}

/** 项目内的不可变更新：只改一条 project entry，其余原样带过。 */
function patchProject(config: IdeState, workspaceId: string, mutate: (project: ProjectEntry) => ProjectEntry): IdeState {
  return { ...config, projects: config.projects.map((p) => (p.workspaceId === workspaceId ? mutate(p) : p)) };
}

/** "这条配置正在跑吗"——判定只在这一处。 */
function isRunning(status: RunStatus | undefined): boolean {
  return status === 'running';
}

/** 运行态文案：状态机到人话只在这一处翻译；与 isRunning、aggregateStatus 的分工是"文案 / 判定 / 排序"。 */
function describeRun(run: RunSnapshot | undefined): string {
  if (run === undefined || run.status === 'idle') return '未启动';
  if (run.status === 'running') return '运行中';
  if (run.status === 'stopped') return '已停止';
  if (run.status === 'failed' && run.error !== '') return `启动失败：${run.error}`;
  if (run.exitCode === 127) return '命令不存在（码 127）';
  return `已退出（码 ${run.exitCode ?? '?'}）`;
}

/**
 * 选出当前项目配置。**不再看 DSH 工作区注册表**：项目配置和注册表已经解耦
 * （任意路径都能建、同一路径可以有多条），"不在注册表里"是常态而不是异常——
 * 旧实现据此隐藏 tab 并弹警告，等于把自定义路径的项目判成二等公民。
 */
function activeOf(config: IdeState, activeProjectId: string) {
  const projects = config.projects;
  const active = projects.find((p) => p.workspaceId === activeProjectId) ?? projects[0];
  return { projects, active };
}

/* ------------------------------------------------------------------ *
 * 会话视图：运行控制台 + 面板内的配置块
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
  /**
   * 缓冲首行的**绝对序号**：滑动窗口里行的身份只能靠它——下标会整体前移，
   * 拿下标当 React key 会让每次追加都把复用节点全部改写一遍。
   * （第 2 步会把这里的客户端计数换成宿主给的 `base`，届时跨分页也稳定。）
   */
  const [seqBase, setSeqBase] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const [filterQ, setFilterQ] = useState('');
  const [filterRegex, setFilterRegex] = useState(false);
  const [onlyMatch, setOnlyMatch] = useState(false);
  const [levels, setLevels] = useState<Record<RunLevel, boolean>>({ ...DEFAULT_LEVELS });
  const [fromHistory, setFromHistory] = useState(false);
  const [historyPath, setHistoryPath] = useState('');
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, LaunchConfig>>({});
  const [flash, setFlash] = useState('');
  const [onlyRunning, setOnlyRunning] = useState(false);
  /** 面板是否已渲染出 tab 行；横向滑动的监听要等它出现后才挂得上。 */
  const panelReady = config !== null;
  const [overview, setOverview] = useState(false);
  const tabRowRef = useRef<HTMLDivElement | null>(null);
  const [discovery, setDiscovery] = useState<IdeaDiscovery | null>(null);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  /**
   * 每个启动配置自己的读取偏移（键 = runKey）。
   * 以前是一个全局 ref、切配置就归零：切回来时只要宿主 ring 已经滚过，就会整段重发（最多 5,000 行 ≈ 728KB）。
   */
  const offsetsRef = useRef<Map<string, number>>(new Map());
  /** logLines 的镜像：读缓冲时要拿到"当前值"而不是 updater 里的闭包值（副作用不能写在 updater 里）。 */
  const logLinesRef = useRef<string[]>([]);
  /** following 的镜像：tick 是同一个闭包，读 state 会读到旧值。 */
  const followingRef = useRef(true);
  /** 上一次观察到的 scrollTop：用来区分「用户往下滚」与「布局变化把 scrollTop 夹小了」。 */
  const lastTopRef = useRef(0);
  /** 上一轮 runs() 的签名：没变就不 setState，免掉"零输出也整面板重渲染"。 */
  const runsSigRef = useRef('');
  /** 轮询 effect 只依赖 runKey，所以目标配置要从这里取（见该 effect 的依赖注释）。 */
  const targetRef = useRef<RunTarget | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const historyTriedRef = useRef(false);
  /**
   * 本次运行**有没有读到过实时行**。历史兜底只能服务于"这一代进程从没产出过"，
   * 不能用"上一次读取没拿到新行"当条件——那还包括"我已经追平、进程这几百毫秒没吐东西"，
   * 照那个条件会把已经拿到的实时行整段换成磁盘历史（曾经就这么干过）。
   */
  const sawLiveRef = useRef(false);
  /** 当前缓冲里显示的是上一次运行的输出（本进程一旦有输出就让位）。 */
  const fromHistoryRef = useRef(false);
  /**
   * 是否跟随最新日志。以前是一个看不见的 ref（贴底 80px 内自动跟随），用户没有任何控制权，
   * 也没有"暂停期间积了多少行"的概念；现在它是显式状态：上滚即暂停、回到底部即恢复、
   * 「跟随/暂停」按钮可以主动冻结，暂停时日志底部的按钮告诉你积压了多少行。
   */
  const [following, setFollowing] = useState(true);
  /** 暂停以来新到的行数（点「跳到最新」归零）。 */
  const [pendingLines, setPendingLines] = useState(0);
  /**
   * 控制区是否折叠成一行。**面板级**（切配置保持折叠——折叠的动机是"给日志腾地方"，
   * 与看哪条配置无关；按配置记会让日志区忽高忽低），**视图本地**（刷新即恢复展开）。
   */
  const [folded, setFolded] = useState(false);
  /** 新增卡片里"任意路径"输入框的内容。 */
  const [newPath, setNewPath] = useState('');
  followingRef.current = following;
  /** 运行代次：重启后自增，用来丢弃上一代进程还在飞的读取结果。 */
  const genRef = useRef(0);
  const tickRef = useRef(0);

  /** 局部选中项：切换启动配置只动这里，不等磁盘回读（回读会把它盖回去）。 */
  const [activeConfigIds, setActiveConfigIds] = useState<Record<string, string>>({});
  const cfg: IdeState = config ?? defaultState();
  const { projects: entries, active } = activeOf(cfg, activeProjectId);
  const activeConfig = active !== undefined ? pickActiveConfig(active, activeConfigIds[active.workspaceId] ?? '') : undefined;
  const runKey = active !== undefined && activeConfig !== undefined
    ? runKeyOf({ workspaceId: active.workspaceId, configId: activeConfig.id })
    : '';
  targetRef.current = active !== undefined && activeConfig !== undefined
    ? { workspaceId: active.workspaceId, configId: activeConfig.id }
    : null;
  const runState = runKey !== '' ? runs[runKey] : undefined;
  const runText = describeRun(runState);
  /**
   * 配置块里正在编辑的那条：草稿优先，没改过就用盘上的值。
   * **一次只编辑当前选中的那一条**——以前是把项目下所有配置的表单堆在一起。
   */
  const activeDraft = activeConfig !== undefined ? drafts[activeConfig.id] ?? activeConfig : undefined;
  const matcher = useMemo(() => compileMatcher({ q: filterQ, regex: filterRegex }), [filterQ, filterRegex]);
  const filtered = useMemo(
    () => filterLines(logLines, { matcher, onlyMatch, levels }),
    [logLines, matcher, onlyMatch, levels],
  );
  // 每一帧都重算一次 2,000 槽的切片是白花：只在过滤结果变了才重切。
  const shown = useMemo(
    () => (filtered.length > RENDER_LIMIT ? filtered.slice(filtered.length - RENDER_LIMIT) : filtered),
    [filtered],
  );

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
      setError(describeRpcFailure('读取启动配置', e));
    }
  }, [api, applyLoad]);

  // 日志按启动配置分家：切换配置就清空缓冲，否则会把上一条的输出串过来。
  // **偏移不在这里清**——它按配置各记一份，切回来接着上次的位置读（见 offsetsRef）。
  useEffect(() => {
    genRef.current += 1;
    setFollowing(true);
    setPendingLines(0);
    historyTriedRef.current = false;
    sawLiveRef.current = false;
    fromHistoryRef.current = false;
    logLinesRef.current = [];
    setFromHistory(false);
    setTruncated(false);
    setSeqBase(0);
    setLogLines([]);
  }, [runKey]);

  useEffect(() => {
    void reload();
    return ctx.on('connection/reset', () => { void reload(); });
  }, [ctx, reload]);

  useEffect(() => {
    if (api === undefined) return;
    // 注意：不能因为"没选配置"就整个不轮询——总览卡片与一级 tab 的状态点、端口、
    // 时长、最后一行都来自 runs()，刚加进来还没建配置的项目正是这种情况。
    const hasTarget = runKey !== '' && targetRef.current !== null;
    const target = hasTarget ? targetRef.current : null;
    let stopped = false;
    const tick = async () => {
      const gen = genRef.current; // 这一轮属于哪一代
      try {
        const list = envelopeValue(await api.runs(), '读取运行态') as RunSnapshot[];
        const map: Record<string, RunSnapshot> = {};
        for (const item of list) map[item.key] = item;
        if (stopped || genRef.current !== gen) return;
        // 每 tick 塞一个新对象会让整个面板在**零输出**时也重渲染（空转的 800ms 一次）。
        // 用一个廉价签名挡掉：只有状态/端口/时长/最后一行真的变了才 setState。
        const signature = list
          .map((s) => `${s.key}|${s.status}|${s.exitCode}|${s.port}|${s.startedAtMs}|${s.lossy}|${s.error}|${s.lastLine}`)
          .join('\n');
        if (signature !== runsSigRef.current) {
          runsSigRef.current = signature;
          setRuns(map);
        }
        if (tickRef.current % CONFIG_REFRESH_EVERY === 0) void reload();
        tickRef.current += 1;
        if (target === null || runKey === '') return;
        const from = offsetsRef.current.get(runKey) ?? 0;
        const chunk = envelopeValue(await api.read({ ...target, from }), '读取日志') as RunRead;
        if (stopped || genRef.current !== gen) return;
        offsetsRef.current.set(runKey, chunk.next);
        // "丢了早期行"要分清：重启后的重新同步（from > next）一行没丢，别冤枉自己。
        const lost = readLostLines(from, chunk);
        if (lost) setTruncated(true);
        if (chunk.lines.length > 0) {
          // 历史与本次运行不能混在一个缓冲里：本进程的第一行到达时，历史整段让位。
          const droppingHistory = fromHistoryRef.current;
          const merged = [...(droppingHistory ? [] : logLinesRef.current), ...chunk.lines];
          const over = merged.length - LOG_LIMIT;
          const next = over > 0 ? merged.slice(over) : merged;
          // 副作用全在 updater 外面：React 可能重复调用更新函数（StrictMode 下必然），
          // 写在里面就会重复 setFromHistory/setTruncated。
          if (droppingHistory) {
            fromHistoryRef.current = false;
            setFromHistory(false);
            setSeqBase(0);                  // 历史整段让位：序号从本进程第一行重新起算
            // 丢弃标记同时**重算**：旧标记讲的是历史那一段（"只取了最近一段"），
            // 与实时流无关——不重算就会在实时视图里显示"早期部分已丢弃"，而其实一行没丢。
            setTruncated(lost || over > 0);
          } else if (over > 0 || lost) {
            setTruncated(true);
            if (over > 0) setSeqBase((base) => base + over);   // 丢掉最老的 over 行，缓冲首行的序号往后挪
          }
          logLinesRef.current = next;
          sawLiveRef.current = true;
          // 暂停中不打扰用户，但要如实记账：攒了多少行，按钮上直接显示。
          if (!followingRef.current) setPendingLines((n) => n + chunk.lines.length);
          setLogLines(next);
        } else if (!historyTriedRef.current && !sawLiveRef.current) {
          // **这一代进程从未产出过**（不是"这一次没读到新行"）→ 把上次运行落盘的尾巴捞回来
          // （DSH 重启后仍能看上次为什么挂的）。追平后进程安静几百毫秒不该触发这一支。
          historyTriedRef.current = true;
          const history = envelopeValue(await api.history({ ...target, tail: DEFAULT_HISTORY_LINES }), '读取历史日志') as LogHistory;
          if (stopped || genRef.current !== gen) return;
          if (history.lines.length > 0) {
            logLinesRef.current = history.lines;
            setLogLines(history.lines);
            setHistoryPath(history.path);
            fromHistoryRef.current = true;
            setFromHistory(true);
            setSeqBase(0);
            if (history.truncated) setTruncated(true);
          }
        }
      } catch (e) {
        if (!stopped && genRef.current === gen) setError(describeRpcFailure('读取运行态', e));
      }
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, POLL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
    // 依赖只放**稳定值**：`active`/`activeConfig` 是每次 reload() 都会换身份的对象，
    // 挂在依赖里会让这个 effect 每 2.4s 重挂一次，而重挂会立刻多打一发 tick
    // （实测空转 10s：19 次 runs 而不是 12.5 次）。目标配置从 ref 取。
  }, [api, runKey, reload]);

  // tab 条横向滑动：滚轮 / 触控板横滑 + 按住拖动（主流 IDE 的做法）。
  // 用原生监听而不是 onWheel：React 的 wheel 是被动监听，preventDefault 不生效。
  useEffect(() => {
    const row = tabRowRef.current;
    if (row === null) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return; // 本来就是横滑，交给浏览器
      row.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    let drag: { x: number; left: number } | null = null;
    const onDown = (event: MouseEvent) => {
      drag = { x: event.clientX, left: row.scrollLeft };
      row.dataset.dragging = 'true';
    };
    const onMove = (event: MouseEvent) => {
      if (drag !== null) row.scrollLeft = drag.left - (event.clientX - drag.x);
    };
    const onUp = () => {
      drag = null;
      delete row.dataset.dragging;
    };
    row.addEventListener('wheel', onWheel, { passive: false });
    row.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      row.removeEventListener('wheel', onWheel);
      row.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // 依赖"面板是否已渲染"：首帧 config 还是 null，tab 行不在 DOM 里，ref 为 null；
    // 用 [] 的话这个 effect 永远不会重跑，整段滚动逻辑就是死代码。
  }, [panelReady]);

  // 选中的 tab 自己滚进视野（项目多了以后必须有）
  useEffect(() => {
    const row = tabRowRef.current;
    if (row === null) return;
    const selected = row.querySelector('[data-sel="true"]');
    if (selected !== null) {
      try {
        selected.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      } catch { /* 老旧实现忽略参数即可 */ }
    }
  }, [activeProjectId, overview, onlyRunning]);

  // 跟随中就把视图钉在最底；暂停后（用户上滚或按了暂停）不再打扰他。
  useEffect(() => {
    const el = logRef.current;
    if (el === null || !following) return;
    el.scrollTop = el.scrollHeight;
  }, [logLines, following]);

  /**
   * 写入配置：先本地生效（乐观），再落盘并以宿主返回的状态为准。
   * 落盘失败必须回到磁盘真实状态——否则面板会显示从未写成的配置，后续提交还会基于它继续写。
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
      setError(describeRpcFailure('保存启动配置', e));
      await reload();
      return false;
    }
  }, [api, reload]);

  // 选中项是视图状态，不落盘。
  // 单一写者：只有这一处写配置，不存在两个面互相覆盖的窗口。
  const selectConfig = (configId: string) => {
    if (active === undefined) return;
    setActiveConfigIds((prev) => ({ ...prev, [active.workspaceId]: configId }));
  };

  /**
   * 快捷列表：按**路径**排除已经有项目配置的工作区，并在列表内按路径去重。
   * 只在"列表展示"这一层去重——数据层仍允许同一路径建多条（用下面的任意路径输入框）。
   */
  const registryPaths = availableWorkspaces(projects, entries.map((p) => p.path));
  const statusOfProject = (project: ProjectEntry) =>
    aggregateStatus(project.configs.map((c) => runs[runKeyOf({ workspaceId: project.workspaceId, configId: c.id })]?.status ?? 'idle'));
  const visibleProjects = entries.filter((p) => !p.hidden && (!onlyRunning || statusOfProject(p) === 'running'));

  const visibleKey = visibleProjects.map((p) => p.workspaceId).join('|');
  // 选中的项目被过滤掉时（收起、或"只看运行中"把它滤掉），body 不能还停在它上面：
  // 那样 tab 行里没有任何选中项，也没法用 » 修复。切回第一个仍可见的项目。
  useEffect(() => {
    if (config === null || overview) return;
    if (visibleProjects.length === 0) return;
    if (visibleProjects.some((p) => p.workspaceId === activeProjectId)) return;
    setActiveProjectId(visibleProjects[0].workspaceId);
  }, [config, overview, visibleKey, activeProjectId]);

  const setHidden = (workspaceId: string, hidden: boolean) => {
    void commit(patchProject(cfg, workspaceId, (p) => ({ ...p, hidden })), false);
  };

  /**
   * 清空日志**视图**（终端 `clear` 的语义）：宿主缓冲与磁盘上的日志文件都不动，
   * 所以"上次为什么挂"仍在，刷新页面也还能重新读到宿主缓冲里的内容。
   * 不动偏移（偏移继续往后走，新行照常追加），也不让编号倒退。
   */
  const clearLogView = () => {
    setSeqBase(seqBase + logLinesRef.current.length);   // 编号接着往下走，清空后不倒退
    logLinesRef.current = [];
    // 别让接下来那次"读取返回 0 行"把磁盘历史又灌回空视图（历史兜底只服务"这一代从没产出过"）。
    historyTriedRef.current = true;
    fromHistoryRef.current = false;
    setFromHistory(false);
    setTruncated(false);
    setPendingLines(0);
    setLogLines([]);
  };

  /**
   * 把用户带到一个项目（configId 给了就顺带选中那条配置）：**藏起来的项目要同时放出来**。
   * 藏它的开关有两个——`hidden`（收起）与「只看运行中」（该项目没有配置在跑），任一个没让路，
   * 面板里就没有它的 tab，紧接着上面那条"选中项必须可见"的兜底会立刻把人弹回第一个可见项目，
   * 看起来就是"点了没反应"。总览里点配置名两条都踩过。
   */
  const revealProject = (workspaceId: string, configId = '') => {
    setOverview(false);
    setActiveProjectId(workspaceId);
    if (configId !== '') setActiveConfigIds((prev) => ({ ...prev, [workspaceId]: configId }));
    const project = cfg.projects.find((p) => p.workspaceId === workspaceId);
    if (project === undefined) return;
    if (project.hidden) setHidden(workspaceId, false);
    if (onlyRunning && statusOfProject(project) !== 'running') setOnlyRunning(false);
  };

  /**
   * 新建一条**项目配置**：只认路径 + 标题，跟 DSH 工作区没有绑定关系
   * （`workspaceId` 字段从此只是这条记录自己的 id）。同一路径可以建多条。
   */
  const addProjectConfig = (path: string, title: string) => {
    const trimmed = path.trim();
    if (trimmed === '') return;
    const entry: ProjectEntry = {
      workspaceId: `p${crypto.randomUUID()}`,
      path: trimmed,
      title: uniqueTitle(title.trim() === '' ? basenameOf(trimmed) : title.trim(), cfg.projects.map((p) => p.title)),
      configs: [],
      activeConfigId: '',
      hidden: false,
    };
    setActiveProjectId(entry.workspaceId);
    void commit({ ...cfg, activeWorkspaceId: entry.workspaceId, projects: [...cfg.projects, entry] }, false);
  };

  const removeProject = (workspaceId: string) => {
    const project = cfg.projects.find((p) => p.workspaceId === workspaceId);
    void (async () => {
      // 移除项目会连它的配置一起删掉，先把它名下的进程都停掉
      for (const config of project?.configs ?? []) await stopRun(workspaceId, config.id);
      const next: IdeState = { ...cfg, projects: cfg.projects.filter((p) => p.workspaceId !== workspaceId) };
      setActiveProjectId(next.projects[0]?.workspaceId ?? '');
      await commit(next, false);
    })();
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
    setActiveConfigIds((prev) => ({ ...prev, [project.workspaceId]: fresh.id }));
    void commit(patchProject(cfg, project.workspaceId, (p) => ({
      ...p,
      configs: [...p.configs, fresh],
      activeConfigId: p.activeConfigId === '' ? fresh.id : p.activeConfigId,
    })), false);
  };

  /** 删掉一条配置前先停掉它的进程：否则进程没了主人、端口要占到 DSH 退出。 */
  const stopRun = async (workspaceId: string, configId: string) => {
    if (api === undefined) return;
    try {
      await api.stop({ workspaceId, configId });
    } catch { /* 本来就没在跑 */ }
  };

  const removeConfig = (project: ProjectEntry, configId: string) => {
    setDrafts((prev) => { const copy = { ...prev }; delete copy[configId]; return copy; });
    void (async () => {
      await stopRun(project.workspaceId, configId);
      await commit(patchProject(cfg, project.workspaceId, (p) => {
        const kept = p.configs.filter((c) => c.id !== configId);
        return { ...p, configs: kept, activeConfigId: p.activeConfigId === configId ? (kept[0]?.id ?? '') : p.activeConfigId };
      }), false);
    })();
  };

  const patchDraft = (draft: LaunchConfig, patch: Partial<LaunchConfig>) => {
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

  const loadDiscovery = async () => {
    if (api === undefined || active === undefined) return;
    setDiscoveryBusy(true);
    setError('');
    try {
      setDiscovery(envelopeValue(await api.discover({ workspaceId: active.workspaceId }), '读取 IDEA 配置') as IdeaDiscovery);
    } catch (e) {
      setError(describeRpcFailure('读取 IDEA 配置', e));
    } finally {
      setDiscoveryBusy(false);
    }
  };

  /** 导入一条候选：同名不覆盖，自动让路到「名字 (2)」。 */
  const importCandidate = (candidate: IdeaCandidateView, name: string) => {
    if (active === undefined) return;
    const built = buildLaunchConfig(candidate, active.path);
    const fresh: LaunchConfig = {
      id: `c${crypto.randomUUID()}`,
      name,
      command: built.command,
      cwd: built.cwd,
      envs: built.envs,
    };
    setActiveConfigIds((prev) => ({ ...prev, [active.workspaceId]: fresh.id }));
    setFlash(`已导入 ${name}`);
    window.setTimeout(() => setFlash(''), 2000);
    void commit(patchProject(cfg, active.workspaceId, (p) => ({
      ...p,
      configs: [...p.configs, fresh],
      activeConfigId: fresh.id,
    })), false);
  };

  const runAction = async (action: 'start' | 'stop', explicit?: RunTarget) => {
    const target = explicit ?? (active !== undefined && activeConfig !== undefined
      ? { workspaceId: active.workspaceId, configId: activeConfig.id }
      : undefined);
    if (api === undefined || target === undefined) return;
    setError('');
    try {
      const startedViewedOne = explicit === undefined || runKey === runKeyOf(explicit);
      const startedKey = runKeyOf(target);
      if (action === 'start') {
        // 宿主在 start 时把该配置的缓冲归零，所以这条配置的偏移必须跟着归零
        // （哪怕启动的不是当前正在看的那条——否则下次切过去会拿着一代前的偏移）。
        offsetsRef.current.set(startedKey, 0);
      }
      if (action === 'start' && startedViewedOne) {
        genRef.current += 1; // 让上一代在飞的读取结果失效
        setFollowing(true);
        setPendingLines(0);
        historyTriedRef.current = true; // 新进程的输出从零开始，不再补历史
        sawLiveRef.current = false;
        fromHistoryRef.current = false;
        setFromHistory(false);
        setTruncated(false);
        logLinesRef.current = [];
        setSeqBase(0);
        setLogLines([]);
      }
      const call = action === 'start' ? api.start(target) : api.stop(target);
      const snap = envelopeValue(await call, action === 'start' ? '启动' : '停止') as RunSnapshot;
      setRuns((prev) => ({ ...prev, [snap.key]: snap }));
    } catch (e) {
      setError(describeRpcFailure(action === 'start' ? '启动' : '停止', e));
    }
  };

  if (config === null) {
    return (
      <div className="ide-root ide-view">
        <div className="ide-body">
          <div className="ide-note">正在加载启动配置…</div>
          {api === undefined ? <div className="ide-warn">remote.ideConfig 不可用</div> : null}
          {error !== '' ? <div className="ide-err">{error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="ide-root ide-view">
      <div className="ide-tabrow" ref={tabRowRef}>
        <button type="button" className="ide-tab" data-sel={overview} onClick={() => setOverview(true)}>
          <span>总览</span>
        </button>
        {visibleProjects.map((p) => (
          <button
            key={p.workspaceId}
            type="button"
            className="ide-tab"
            data-sel={!overview && p.workspaceId === active?.workspaceId}
            onClick={() => revealProject(p.workspaceId)}
          >
            <span className="ide-dot" data-state={statusOfProject(p)} title="任一条配置在跑就是绿的" />
            <span>{p.title}</span>
            {p.configs.length > 0 ? <span className="ide-note">{p.configs.length}</span> : null}
            <span
              className="ide-x"
              title="收起这个项目（配置全部保留，可从 » 里恢复）"
              onClick={(event) => { event.stopPropagation(); setHidden(p.workspaceId, true); }}
            >
              ×
            </span>
          </button>
        ))}
        <span className="ide-tools">
          <button type="button" className="ide-chip" data-sel={onlyRunning} onClick={() => setOnlyRunning((v) => !v)}>只看运行中</button>
          <details className="ide-overflow">
            <summary title="全部项目">»</summary>
            <ul>
              {cfg.projects.map((p) => (
                <li
                  key={p.workspaceId}
                  onClick={() => revealProject(p.workspaceId)}
                >
                  <span className="ide-dot" data-state={statusOfProject(p)} />
                  <span>{p.title}</span>
                  <span className="ide-note" style={{ marginLeft: 'auto' }}>
                    {p.hidden ? '已收起' : `${p.configs.length} 条配置`}
                  </span>
                </li>
              ))}
              {cfg.projects.length === 0 ? <li className="ide-note">还没有项目配置</li> : null}
            </ul>
          </details>
        </span>
      </div>

      <div className="ide-body ide-fill">
        {warning !== '' ? <div className="ide-warn">{warning}</div> : null}
        {error !== '' ? <div className="ide-err">{error}</div> : null}

        {overview ? (
          <div className="ide-board">
            {/* 新增卡片：加项目只在这里做（tab 行的 ＋ 与配置块里的那行都删了）。
                排在项目卡片之后，加完留在总览——新卡片当场出现在这排里。 */}

            {cfg.projects.map((p) => (
              <div className="ide-card" key={p.workspaceId}>
                <div className="ide-cardhead">
                  <span className="ide-dot" data-state={statusOfProject(p)} />
                  <span className="ide-title">{p.title}</span>
                  {p.hidden ? <span className="ide-note">已收起</span> : null}
                  <span style={{ flex: 1 }} />
                  <span className="ide-note">{p.configs.length} 条配置</span>
                  {/* 「打开」= 进这个项目配置的面板：0 配置的卡片过去没有任何可点入口（死胡同） */}
                  <button type="button" className="ide-btn" onClick={() => revealProject(p.workspaceId)}>打开</button>
                </div>
                <div className="ide-note ide-mono">{p.path}</div>
                {p.configs.length === 0 ? <div className="ide-note">还没有启动配置 —— 点右上角「打开」进去加第一条</div> : null}
                {p.configs.map((c) => {
                  const snapshot = runs[runKeyOf({ workspaceId: p.workspaceId, configId: c.id })];
                  return (
                    <div className="ide-cardrow" key={c.id}>
                      <span className="ide-dot" data-state={snapshot?.status ?? 'idle'} />
                      <span className="ide-name" onClick={() => revealProject(p.workspaceId, c.id)}>{c.name}</span>
                      {snapshot !== undefined && snapshot.port !== '' ? <span className="ide-port">:{snapshot.port}</span> : null}
                      <span className="ide-note">
                        {describeRun(snapshot)}
                        {isRunning(snapshot?.status) ? ` · ${formatUptime(snapshot?.startedAtMs ?? 0, Date.now())}` : ''}
                      </span>
                      <span className="ide-last" title={snapshot?.lastLine ?? ''}>{snapshot?.lastLine ?? '（无输出）'}</span>
                      {isRunning(snapshot?.status) ? (
                        <button type="button" className="ide-btn" onClick={() => { void runAction('stop', { workspaceId: p.workspaceId, configId: c.id }); }}>停止</button>
                      ) : (
                        <button type="button" className="ide-btn" data-kind="primary" onClick={() => { void runAction('start', { workspaceId: p.workspaceId, configId: c.id }); }}>启动</button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            <div className="ide-card ide-addcard">
              <div className="ide-cardhead">
                <span className="ide-title">＋ 添加项目配置</span>
                <span style={{ flex: 1 }} />
                <span className="ide-note">同一路径可以建多条</span>
              </div>

              {/* 任意路径：不是所有项目都在 DSH 工作区里，所以这里只收一个路径字符串，不校验存在性 */}
              <div className="ide-addpath">
                <input
                  className="ide-field ide-mono"
                  placeholder="/任意/路径（不限于 DSH 工作区）"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { addProjectConfig(newPath, ''); setNewPath(''); }
                  }}
                />
                <button
                  type="button"
                  className="ide-btn"
                  data-kind="primary"
                  disabled={newPath.trim() === ''}
                  onClick={() => { addProjectConfig(newPath, ''); setNewPath(''); }}
                >
                  添加
                </button>
              </div>

              {registryPaths.length === 0 ? (
                projects.length === 0 ? null : (
                  <div className="ide-note">DSH 工作区都已有项目配置——同一路径想再建一条，用上面的输入框</div>
                )
              ) : (
                <>
                  <div className="ide-note">或从 DSH 工作区里挑（{registryPaths.length} 个）</div>
                  <div className="ide-addlist">
                    {registryPaths.map((p) => (
                      <div className="ide-cardrow" key={p.path}>
                        <span className="ide-name" title={p.path}>{p.title}</span>
                        <span style={{ flex: 1 }} />
                        <button type="button" className="ide-btn" onClick={() => addProjectConfig(p.path, p.title)}>加入</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : active === undefined ? (
          <div className="ide-empty">
            <div>还没有项目配置</div>
            <div className="ide-note">打开上面的「总览」，在最下面那张卡片里填一个路径</div>
          </div>
        ) : (
          <>
            {/* 主从卡片：左列是这个项目的启动配置（多了就纵向滚），右列是选中那条的详情。
                项目名与路径从原来的身份行挪进左列卡头——上面的一级 tab 里已经写过一遍项目名。 */}
            <div className="ide-master" data-folded={folded}>
              {folded ? (
                <div className="ide-foldrow">
                  <span className="ide-mdot-title" onDoubleClick={() => setFolded(false)} title="双击展开">
                    <span className="ide-dot" data-state={runState?.status ?? 'idle'} />
                    <span className="ide-mname">{activeConfig === undefined ? '（还没有启动配置）' : activeConfig.name}</span>
                    {runState !== undefined && runState.port !== '' ? <span className="ide-port">:{runState.port}</span> : null}
                    {isRunning(runState?.status) ? <span className="ide-note">{formatUptime(runState?.startedAtMs ?? 0, Date.now())}</span> : null}
                    <span className="ide-note">{activeConfig === undefined ? '' : runText}</span>
                  </span>
                  <span style={{ flex: 1 }} />
                  {activeConfig === undefined ? null : (
                    <>
                      {isRunning(runState?.status) ? (
                        <button type="button" className="ide-btn" onClick={() => { void runAction('stop'); }}>停止</button>
                      ) : (
                        <button type="button" className="ide-btn" data-kind="primary" onClick={() => { void runAction('start'); }}>启动</button>
                      )}
                      <button type="button" className="ide-btn" disabled={runState?.status !== 'running'} onClick={() => { void (async () => { await runAction('stop'); await runAction('start'); })(); }}>重启</button>
                    </>
                  )}
                  <button type="button" className="ide-btn" onClick={() => setFolded(false)} title="展开控制区">展开</button>
                </div>
              ) : (
                <>
              <div className="ide-mlist">
                <div className="ide-mhead">
                  <div className="ide-mheadtop">
                    <span className="ide-title" title={active.title}>{active.title}</span>
                    {/* ⚙ 配置挂在项目名这一行的**最右端**：与折叠行的按钮对齐成同一条竖线，
                        免得折叠/展开时按钮位置左右横跳（配置编辑本来就是"这个项目的配置"）。 */}
                    <span style={{ flex: 1 }} />
                    <button type="button" className="ide-btn" data-on={editing} onClick={() => setEditing((v) => !v)}>⚙ 配置</button>
                  </div>
                  <div className="ide-note ide-mono ide-mpath" title={active.path}>{active.path}</div>
                </div>
                {active.configs.map((c) => {
                  const snapshot = runs[runKeyOf({ workspaceId: active.workspaceId, configId: c.id })];
                  const up = isRunning(snapshot?.status) ? formatUptime(snapshot?.startedAtMs ?? 0, Date.now()) : '';
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="ide-mitem"
                      data-sel={c.id === activeConfig?.id}
                      title={`${c.name} — ${describeRun(snapshot)}`}
                      onClick={() => selectConfig(c.id)}
                    >
                      <span className="ide-dot" data-state={snapshot?.status ?? 'idle'} />
                      <span className="ide-mname">{c.name}</span>
                      {snapshot !== undefined && snapshot.port !== '' ? <span className="ide-port">:{snapshot.port}</span> : null}
                      <span className="ide-note ide-mstate">{up !== '' ? up : describeRun(snapshot)}</span>
                    </button>
                  );
                })}
                <button type="button" className="ide-mitem ide-madd" onClick={() => addConfig(active)}>＋ 启动配置</button>
              </div>

              {activeConfig === undefined ? (
                <div className="ide-detail">
                  <div className="ide-note">这个项目还没有启动配置 —— 点左列「＋ 启动配置」添加（⚙ 配置在左边项目名旁边）</div>
                  <div className="ide-dactions">
                    <button type="button" className="ide-btn" onClick={() => setFolded(true)} title="折叠控制区，把高度让给日志">折叠</button>
                  </div>
                </div>
              ) : (
                <div className="ide-detail">
                  <div className="ide-dhead">
                    <span className="ide-configtitle">{activeConfig.name}</span>
                    <span style={{ flex: 1 }} />
                    <span className="ide-note">{flash}</span>
                    <button type="button" className="ide-btn" onClick={() => setFolded(true)} title="折叠控制区，把高度让给日志（双击紧凑行也能展开）">折叠</button>
                  </div>

                  {/* 指标块：状态直接复用 describeRun 的文案，免得"运行中/已退出（码 N）"有第二套说法 */}
                  <div className="ide-dmeter">
                    <span className="ide-metric" title={runText}>状态<b>{runText}</b></span>
                    <span className="ide-metric">端口<b>{runState !== undefined && runState.port !== '' ? `:${runState.port}` : '—'}</b></span>
                    <span className="ide-metric">
                      运行时长<b>{isRunning(runState?.status) ? formatUptime(runState?.startedAtMs ?? 0, Date.now()) : '—'}</b>
                    </span>
                    <span className="ide-metric">
                      退出码<b>{runState?.exitCode === null || runState?.exitCode === undefined ? '—' : String(runState.exitCode)}</b>
                    </span>
                  </div>

                  <div className="ide-dactions">
                    <button
                      type="button"
                      className="ide-btn"
                      data-kind="primary"
                      disabled={isRunning(runState?.status)}
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

                  <div className="ide-dcmd">
                    <span className="ide-label">启动命令</span>
                    <span className="ide-cmd" title={activeConfig.command}>{activeConfig.command === '' ? '（未设置）' : activeConfig.command}</span>
                  </div>

                  <div className="ide-filterbar">
                    <input
                      className="ide-field ide-mono"
                      placeholder="过滤关键字"
                      value={filterQ}
                      onChange={(e) => setFilterQ(e.target.value)}
                    />
                    <button type="button" className="ide-chip" data-sel={filterRegex} onClick={() => setFilterRegex((v) => !v)}>正则</button>
                    <button type="button" className="ide-chip" data-sel={onlyMatch} onClick={() => setOnlyMatch((v) => !v)}>仅看匹配</button>
                    <span style={{ flex: 1 }} />
                    {LEVELS.map((lv) => (
                      <button
                        key={lv}
                        type="button"
                        className="ide-chip"
                        data-sel={levels[lv]}
                        onClick={() => setLevels((prev) => ({ ...prev, [lv]: !prev[lv] }))}
                      >
                        {lv}
                      </button>
                    ))}
                  </div>
                </div>
              )}
                </>
              )}
            </div>

            {editing && active !== undefined ? (
              <div className="ide-cfg">
                <div className="ide-toolbar">
                  <span className="ide-title">配置 · {active.title}</span>
                  {activeDraft !== undefined ? <span className="ide-note">正在编辑：{activeDraft.name}</span> : null}
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="ide-chip"
                    disabled={discoveryBusy}
                    onClick={() => { void loadDiscovery(); }}
                  >
                    {discoveryBusy ? '正在扫描…' : '从 IDEA 导入'}
                  </button>
                  <button type="button" className="ide-btn" data-kind="danger" onClick={() => removeProject(active.workspaceId)}>移除项目配置</button>
                </div>

                {discovery !== null ? (
                  <div className="ide-form">
                    <div className="ide-line">
                      <span className="ide-label">导入</span>
                      <span className="ide-note">
                        扫过 {discovery.scanned.length} 个文件，发现 {discovery.candidates.length} 条 IDEA Spring Boot 配置
                      </span>
                      <span style={{ flex: 1 }} />
                      <button type="button" className="ide-btn" onClick={() => setDiscovery(null)}>收起</button>
                    </div>
                    {discovery.errors.length > 0 ? discovery.errors.map((message, index) => (
                      <div className="ide-err" key={index}>{message}</div>
                    )) : null}
                    {discovery.candidates.length === 0 ? (
                      <div className="ide-note">没找到可导入的 Spring Boot 运行配置（只认 .idea/workspace.xml 与 .run/*.xml）</div>
                    ) : null}
                    {discovery.candidates.map((candidate) => {
                      const planned = plannedConfigName(candidate.name, active.configs.map((c) => c.name));
                      const blocked = candidate.problem !== '';
                      return (
                        <div className="ide-line" key={candidate.source + '#' + candidate.name}>
                          <span className="ide-chip">{candidate.name}</span>
                          <span className="ide-note ide-mono">
                            {blocked ? candidate.problem : candidate.module}
                          </span>
                          <span className="ide-note">{candidate.envs.length} 个环境变量</span>
                          <span style={{ flex: 1 }} />
                          <button
                            type="button"
                            className="ide-btn"
                            data-kind="primary"
                            disabled={blocked}
                            title={blocked ? candidate.problem : candidate.source}
                            onClick={() => importCandidate(candidate, planned)}
                          >
                            {planned === candidate.name ? '导入' : `导入为「${planned}」`}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {activeDraft === undefined ? (
                  <div className="ide-note">这个项目还没有启动配置 —— 用左列「＋ 启动配置」或上面的「从 IDEA 导入」加一条</div>
                ) : (
                  <div className="ide-form">
                    <div className="ide-line">
                      <span className="ide-label">名称</span>
                      <input className="ide-field" style={{ maxWidth: 240 }} value={activeDraft.name} onChange={(e) => patchDraft(activeDraft, { name: e.target.value })} />
                      <button type="button" className="ide-btn" data-kind="primary" onClick={() => { void saveDraft(active, activeDraft); }}>保存</button>
                      <button type="button" className="ide-btn" data-kind="danger" onClick={() => removeConfig(active, activeDraft.id)}>删除</button>
                    </div>
                    <div className="ide-line">
                      <span className="ide-label">启动命令</span>
                      <input
                        className="ide-field ide-mono"
                        style={{ flex: 1, minWidth: 280 }}
                        placeholder="例如：mvn -o -pl kun-ai-web spring-boot:run"
                        value={activeDraft.command}
                        onChange={(e) => patchDraft(activeDraft, { command: e.target.value })}
                      />
                    </div>
                    <div className="ide-line">
                      <span className="ide-label">工作目录</span>
                      <input className="ide-field ide-mono" style={{ flex: 1, minWidth: 280 }} value={activeDraft.cwd} onChange={(e) => patchDraft(activeDraft, { cwd: e.target.value })} />
                    </div>
                    <div className="ide-line" style={{ alignItems: 'flex-start' }}>
                      <span className="ide-label">环境变量</span>
                      <div style={{ flex: 1 }}>
                        <table className="ide-envs">
                          <tbody>
                            {activeDraft.envs.map((env, index) => (
                              <tr key={index}>
                                <td style={{ width: '38%' }}>
                                  <input
                                    className="ide-field ide-mono"
                                    value={env.name}
                                    placeholder="NAME"
                                    onChange={(e) => patchDraft(activeDraft, { envs: activeDraft.envs.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)) })}
                                  />
                                </td>
                                <td>
                                  <input
                                    className="ide-field ide-mono"
                                    type={isSecretName(env.name) ? 'password' : 'text'}
                                    title={isSecretName(env.name) ? '密钥类变量在界面上掩码显示' : undefined}
                                    value={env.value}
                                    placeholder="value"
                                    onChange={(e) => patchDraft(activeDraft, { envs: activeDraft.envs.map((x, i) => (i === index ? { ...x, value: e.target.value } : x)) })}
                                  />
                                </td>
                                <td style={{ width: 32 }}>
                                  <button type="button" className="ide-btn" onClick={() => patchDraft(activeDraft, { envs: activeDraft.envs.filter((_, i) => i !== index) })}>×</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <button type="button" className="ide-chip" onClick={() => patchDraft(activeDraft, { envs: [...activeDraft.envs, { name: '', value: '' }] })}>＋ 变量</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {activeConfig === undefined ? null : (
              <div className="ide-logbox">
                <div
                  className="ide-log"
                  ref={logRef}
                  onScroll={(event) => {
                    const el = event.currentTarget;
                    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                    const scrolledDown = el.scrollTop > lastTopRef.current;
                    lastTopRef.current = el.scrollTop;
                    if (!atBottom) {
                      setFollowing(false);           // 上滚即暂停（不管是谁滚的）
                    } else if (scrolledDown) {
                      // 只有"真的往下滚到最底"才算恢复。布局变化（例如底栏换行让日志变矮）
                      // 会把 scrollTop 夹小、也满足 atBottom，但 scrolledDown 为 false——
                      // 早先就是这样把用户刚按下的"暂停"悄悄解掉的。
                      setFollowing(true);
                      setPendingLines(0);
                    }
                  }}
                >
                  {shown.length === 0
                    ? (
                      <span className="ide-note">
                        {logLines.length > 0
                          ? '没有匹配的日志'
                          : isRunning(runState?.status) ? '等待输出…' : '点「启动」运行这条启动配置'}
                      </span>
                    )
                    : shown.map((row) => (
                      // key = 绝对序号（缓冲首行序号 + 该行在缓冲里的下标）。用数组下标当 key 时，
                      // 滑动尾窗每追加一批就把所有复用节点各改一次文本（2,000 次/批）。
                      <div key={seqBase + row.index} className={(row.hit ? 'ide-hit ' : '') + 'ide-lv-' + row.level}>{row.line}</div>
                    ))}
                </div>
                <div className="ide-note ide-logfoot">
                  <span className="ide-logstats">
                    显示 {shown.length} / 共 {filtered.length} 行（缓存 {logLines.length} 行）
                    {fromHistory
                      ? <span title={historyPath}>（含上次运行的输出{truncated ? '，只取了最近一段' : ''}）</span>
                      : runState?.lossy === true || truncated ? '（输出过快或过长，早期部分已丢弃）' : ''}
                    {filtered.length > RENDER_LIMIT ? `（仅渲染最近 ${RENDER_LIMIT} 行）` : ''}
                  </span>
                  {/* 控件跟在统计文字后面靠左：右下角是桌宠的地盘（固定定位），放那儿会被盖住 */}
                  <button
                    type="button"
                    className="ide-btn"
                    data-on={!following}
                    title={following
                      ? '跟随最新日志；点一下冻结视图（也可以直接上滚）'
                      : '已暂停；点一下恢复跟随并跳到最新'}
                    onClick={() => {
                      const next = !following;
                      setFollowing(next);
                      const el = logRef.current;
                      if (next && el !== null) el.scrollTop = el.scrollHeight;
                    }}
                  >
                    {following ? '跟随中' : '已暂停'}
                  </button>
                  {following ? null : (
                    <button
                      type="button"
                      className="ide-btn"
                      data-kind="primary"
                      title="跳到最新日志并恢复跟随"
                      onClick={() => {
                        setPendingLines(0);
                        setFollowing(true);
                        const el = logRef.current;
                        if (el !== null) el.scrollTop = el.scrollHeight;
                      }}
                    >
                      {pendingLines > 0 ? `↓ 跳到最新（${pendingLines}）` : '↓ 跳到最新'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="ide-btn"
                    title="只清面板里的显示；宿主缓冲与磁盘上的日志文件都不动（刷新页面可重新读到）"
                    onClick={clearLogView}
                  >
                    清空
                  </button>
                </div>
              </div>
            )}
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

  // 会话视图：运行控制台 + 面板内的配置块，不出现输入控件。
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    { name: 'conversation.view', id: VIEW_ID, order: VIEW_ORDER, label: 'IDE' },
    () => <IdeView api={api} ctx={ctx} />,
  ));

}
