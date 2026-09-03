import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as ReactDOM from 'react-dom';
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import { IconFolderClose16, IconFolderOpen16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { favoritesFieldSchema, favoritesFieldValueSchema, favoritesStateSchema } from './schema.js';
import { MIN_RECENT, MAX_RECENT, DEFAULT_RECENT } from './constants.js';

export const NS = 'newbe-my-favorites';

export type SessionFavorite = { id: string; title: string };
export type UrlFavorite = { id: string; name: string; url: string; icon: string; useFavicon: boolean };
export type SwitcherMode = 'favorites' | 'recent';
type SettingsValue = { sessions: SessionFavorite[]; urls: UrlFavorite[]; mode?: SwitcherMode; recentCount?: number; urlsEnabled?: boolean };
type SettingField = 'sessions' | 'urls' | 'mode' | 'recentCount' | 'urlsEnabled';
type Scope = { getSnapshot(): { value?: SettingsValue }; subscribe(listener: () => void): () => void; set(field: SettingField, value: unknown): Promise<void> };

/** Remote 代理：客户端经 remote.myFavorites.* 调用宿主服务（方法返回 RPC 信封）。 */
type RemoteEnvelope<T> = { ok: true; value: T } | { ok: false; error?: { message?: string } };
type RemoteFavorites = {
  getState(): Promise<RemoteEnvelope<unknown>>;
  setField(field: string, value: unknown): Promise<RemoteEnvelope<unknown>>;
};

/** 客户端 Remote contribution：与宿主 ./typert 清单的端点（namespace/method）逐一对应。 */
const REMOTE_CONTRIBUTION = {
  package: 'dsh-newbe-my-favorites',
  descriptors: [
    {
      id: 'dsh-newbe-my-favorites#myFavorites/getState', service: 'myFavorites', namespace: 'myFavorites', method: 'getState',
      invocation: { kind: 'direct' as const }, parameters: [],
      result: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-my-favorites#FavoritesState', schema: favoritesStateSchema },
    },
    {
      id: 'dsh-newbe-my-favorites#myFavorites/setField', service: 'myFavorites', namespace: 'myFavorites', method: 'setField',
      invocation: { kind: 'direct' as const },
      parameters: [
        { name: 'field', wire: 'field', source: 'json' as const, codec: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-my-favorites#FavoritesField', schema: favoritesFieldSchema } },
        { name: 'value', wire: 'value', source: 'json' as const, codec: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-my-favorites#FavoritesFieldValue', schema: favoritesFieldValueSchema } },
      ],
      result: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-my-favorites#FavoritesState', schema: favoritesStateSchema },
    },
  ],
};

function normalizeStateValue(value: unknown): SettingsValue {
  const fallback: SettingsValue = { sessions: [], urls: [], mode: 'favorites', recentCount: DEFAULT_RECENT, urlsEnabled: true };
  if (value == null || typeof value !== 'object') return fallback;
  const v = value as Partial<SettingsValue>;
  return {
    sessions: Array.isArray(v.sessions) ? v.sessions : [],
    urls: Array.isArray(v.urls) ? v.urls : [],
    mode: v.mode === 'recent' ? 'recent' : 'favorites',
    recentCount: clampRecentCount(v.recentCount ?? DEFAULT_RECENT),
    urlsEnabled: v.urlsEnabled !== false,
  };
}

function envelopeValue(result: RemoteEnvelope<unknown>, action: string): unknown {
  if (result && typeof result === 'object' && (result as any).ok === true) return (result as any).value;
  throw new Error((result as any)?.error?.message ?? `${action} 失败`);
}

/**
 * 收藏设置 scope：与旧 settingsScope 完全相同的契约（getSnapshot/subscribe/set），
 * 数据经 remote.myFavorites RPC 读写宿主侧 ~/.dsh/storages/dsh-newbe-my-favorites.json。
 * remote 不可用（非回环浏览器等）时退化为内存态：读默认值、写 no-op。
 */
function createFavoritesScope(remote: RemoteFavorites | undefined, ctx: any): Scope {
  const store = createSnapshotStore<{ value?: SettingsValue }>({ value: undefined });
  let tail: Promise<void> = Promise.resolve();
  const applyState = (state: unknown) => store.update((draft) => { draft.value = normalizeStateValue(state); });
  const reload = async () => {
    if (!remote) return;
    try { applyState(envelopeValue(await remote.getState(), 'getState')); }
    catch (error) { console.error('[newbe-my-favorites] 状态加载失败', error); }
  };
  const set = (field: SettingField, value: unknown): Promise<void> => {
    if (!remote) return Promise.resolve();
    const task = tail.then(async () => {
      try { applyState(envelopeValue(await remote.setField(field, value), 'setField')); }
      catch (error) { console.error('[newbe-my-favorites] 状态写入失败', error); await reload(); }
    });
    tail = task.catch(() => {});
    return task;
  };
  if (remote) {
    void reload();
    ctx.effect(() => ctx.on('connection/reset', () => { void reload(); }), 'newbe-my-favorites: reconnect reload');
  }
  return { getSnapshot: store.getSnapshot, subscribe: store.subscribe, set };
}

const STYLE_ID = 'dsh-newbe-my-favorites';

function ensureStyles() {
  if (document.querySelector(`style[data-plugin="${STYLE_ID}"]`)) return () => {};
  const style = document.createElement('style'); style.dataset.plugin = STYLE_ID;
  style.textContent = `
.mf-switcher-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9999;background:var(--dsw-alias-bg-module-platform,#fff);border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:8px;padding:8px 14px;font-size:13px;color:var(--dsw-alias-label-primary,#1f2329);box-shadow:0 4px 16px rgba(0,0,0,.12)}.mf-sessionSettings{display:flex;flex-direction:column;gap:10px}.mf-modeGroup{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.mf-modeGroup label{display:inline-flex;align-items:center;gap:5px;font-size:13px;cursor:pointer}.mf-sessionSettings .mf-countRow{display:flex;align-items:center;gap:8px}.mf-sessionSettings .mf-countRow input{width:70px}.mf-sessionSettings .mf-modeNote{color:var(--dsw-alias-label-secondary,#697586);font-size:12px}
.mf-headerButton,.mf-iconButton,.mf-urlTag{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#697586);font:inherit;cursor:pointer}.mf-headerButton,.mf-iconButton{align-items:center;justify-content:center;display:inline-flex;border-radius:7px;width:30px;height:30px}.mf-headerButton:hover,.mf-iconButton:hover,.mf-urlTag:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.07));color:var(--dsw-alias-label-primary,#1f2329)}.mf-headerButton[data-active=true]{color:var(--dsw-alias-state-warn-primary,#e7a100)}.mf-belowNewSessionBridge{position:relative;padding:4px 8px;margin:4px 0}.mf-favorites{display:flex;flex-direction:column;gap:6px}.mf-urlTags{display:flex;flex-wrap:wrap;gap:6px}.mf-urlTag{align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:7px;display:inline-flex;min-width:30px;max-width:72px;height:30px;padding:0 7px;overflow:hidden;font-size:12px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}.mf-favicon{width:16px;height:16px;max-width:16px;max-height:16px;min-width:0;min-height:0;object-fit:contain;flex:0 0 16px;align-self:center}.mf-folderButton{box-sizing:border-box;align-items:center;gap:6px;border:0;background:transparent;border-radius:8px;display:flex;width:100%;height:34px;padding:0 8px;color:var(--dsw-alias-label-primary,#1f2329);font:inherit;font-size:14px;line-height:20px;text-align:left;cursor:pointer;user-select:none}.mf-folderButton:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.07))}.mf-folderIcon{width:16px;height:16px;color:var(--dsw-alias-label-primary,#1f2329);justify-content:center;align-items:center;display:inline-flex;flex:none}.mf-folderLabel{flex:1;min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.mf-sessionFolder{display:flex;flex-direction:column;gap:2px;max-height:240px;overflow:auto;padding-top:2px}.mf-sessionRow{align-items:center;box-sizing:border-box;height:32px;border-radius:8px;cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary,#1f2329);display:flex;gap:0}.mf-slot{width:16px;height:20px;color:var(--dsw-alias-label-tertiary,#9aa4b2);justify-content:center;align-items:center;display:inline-flex;flex:none}.mf-sessionRow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.07))}.mf-sessionRow[data-drag-ready=true]{cursor:grab}.mf-sessionRow[data-dragging=true]{opacity:.45}.mf-sessionRow[data-drop-target=true]{box-shadow:inset 0 2px 0 var(--dsw-alias-state-business-primary,#2468f2)}.mf-sessionRow[data-active=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.07))}.mf-sessionButton{border:0;background:transparent;color:var(--dsw-alias-label-primary,#1f2329);font:inherit;cursor:pointer;flex:1;min-width:0;overflow:hidden;margin:0 6px 0 4px;text-align:left;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px}.mf-switcher-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center}.mf-switcher-panel{background:var(--dsw-specific-menu,var(--dsw-alias-bg-module-platform,#fff));border:1px solid var(--dsw-alias-border-inverted,var(--dsw-alias-border-l2,#d9dce1));border-radius:12px;min-width:320px;max-width:560px;max-height:60vh;display:flex;flex-direction:column;box-shadow:var(--dsw-shadow-lv3,0 12px 40px rgba(0,0,0,.22));overflow:hidden}.mf-switcher-head{padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1,#d9dce1)}.mf-switcher-head strong{display:block;font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary,#1f2329);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mf-switcher-head small{display:block;margin-top:2px;font-size:11px;color:var(--dsw-alias-label-caption,#697586);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mf-switcher-list{display:flex;flex-direction:column;padding:6px;overflow-y:auto}.mf-switcher-item{display:flex;align-items:center;height:32px;padding:0 8px;border-radius:8px;border:0;background:transparent;color:var(--dsw-alias-label-primary,#1f2329);cursor:pointer;user-select:none;appearance:none}
mf-switcher-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.07))}.mf-switcher-item[data-active=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.07))}.mf-switcher-item .mf-switcher-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px}.mf-switcher-item .mf-switcher-workspace{flex:none;margin-left:8px;padding:0 6px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-caption,#697586);font-size:11px;line-height:18px;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mf-switcher-item[data-active=true] .mf-switcher-workspace{background:rgba(255,255,255,.2);color:inherit}.mf-switcher-hint{padding:8px 16px;border-top:1px solid var(--dsw-alias-border-l1,#d9dce1);font-size:11px;color:var(--dsw-alias-label-caption,#697586)}.mf-invalid{color:var(--dsw-alias-label-tertiary,#9aa4b2);text-decoration:line-through}.mf-remove{color:var(--dsw-alias-label-tertiary,#9aa4b2);flex:none;opacity:0;pointer-events:none;transition:opacity .12s}.mf-sessionRow:hover .mf-remove,.mf-sessionRow:focus-within .mf-remove{opacity:1;pointer-events:auto}.mf-empty{color:var(--dsw-alias-label-tertiary,#9aa4b2);font-size:12px;line-height:1.5;padding:7px 8px}.mf-settings{max-width:760px;display:flex;flex-direction:column;gap:16px}.mf-settings h2{margin:0}.mf-card{border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:12px;padding:16px}.mf-toggleRow{display:inline-flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-top:12px}.mf-form{display:grid;grid-template-columns:1.1fr 2fr 1fr auto auto;gap:8px;align-items:center;margin-top:12px}.mf-urlRow{display:grid;grid-template-columns:1.1fr 2fr 1fr auto auto auto;gap:8px;align-items:center}.mf-field{border:1px solid var(--dsw-alias-border-l2,#d9dce1);border-radius:7px;background:transparent;color:inherit;padding:7px 8px;font:inherit;min-width:0}.mf-primary{border:0;border-radius:7px;background:var(--dsw-alias-state-business-primary,#2468f2);color:var(--dsw-alias-label-primary-inverted,#fff);padding:8px 12px;cursor:pointer}.mf-danger{color:var(--dsw-alias-state-error-primary,#d03050)}.mf-urlList{display:flex;flex-direction:column;gap:8px;margin-top:12px}.mf-error{color:var(--dsw-alias-state-error-primary,#d03050);font-size:12px;margin:8px 0 0}@media(max-width:600px){.mf-form,.mf-urlRow{grid-template-columns:1fr}}
`;
  document.head.append(style); return () => style.remove();
}

function useSettings(scope: Scope): SettingsValue { const snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope)); const value = snapshot.value ?? { sessions: [], urls: [] }; return { sessions: value.sessions ?? [], urls: value.urls ?? [], mode: value.mode ?? 'favorites', recentCount: clampRecentCount(value.recentCount ?? DEFAULT_RECENT), urlsEnabled: value.urlsEnabled ?? true }; }
function clampRecentCount(value: number): number { const num = Number.isFinite(value) ? value : DEFAULT_RECENT; return Math.min(MAX_RECENT, Math.max(MIN_RECENT, Math.round(num))); }
function sessionTitle(session: any, fallback: string) { return session?.displayTitle ?? session?.title ?? fallback; }
/** 工作区项目名：优先显式 title，否则取 path 的最后一段（basename）。 */
function workspaceTitleOf(title: string | undefined, path: string | undefined): string {
  if (title != null && title !== '') return title;
  if (path != null && path !== '') { const base = path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ''; if (base) return base; }
  return '';
}
function validUrl(value: string) { try { return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol); } catch { return false; } }
function Star({ filled }: { filled: boolean }) { return <span aria-hidden="true">{filled ? '★' : '☆'}</span>; }

function FavoriteToggle({ sessionId, useSessions, scope }: any) {
  const value = useSettings(scope); const favorite = value.sessions.find((item) => item.id === sessionId);
  const liveTitle = useSessions((state: any) => sessionTitle(state.byId?.[sessionId], sessionId)); const title = liveTitle === sessionId ? favorite?.title ?? sessionId : liveTitle;
  const toggle = () => scope.set('sessions', favorite ? value.sessions.filter((item) => item.id !== sessionId) : [...value.sessions, { id: sessionId, title }]);
  return <button className="mf-headerButton" data-active={Boolean(favorite)} type="button" onClick={toggle} title={favorite ? '取消收藏会话' : '收藏会话'} aria-label={favorite ? '取消收藏会话' : '收藏会话'}><Star filled={Boolean(favorite)} /></button>;
}

function faviconUrl(value: string) { try { const parsed = new URL(value); return `${parsed.protocol}//${parsed.host}/favicon.ico`; } catch { return ''; } }
function UrlTag({ item }: { item: UrlFavorite }) {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const favicon = item.useFavicon && !faviconFailed ? faviconUrl(item.url) : '';
  const fallback = item.icon || item.name;
  return <button className="mf-urlTag" type="button" title={`${item.name}\n${item.url}`} aria-label={`打开网址：${item.name}`} onClick={() => { if (validUrl(item.url)) window.open(item.url, '_blank', 'noopener,noreferrer'); }}>{favicon ? <img className="mf-favicon" src={favicon} alt="" onError={() => setFaviconFailed(true)} /> : fallback}</button>;
}
function UrlTags({ urls }: { urls: UrlFavorite[] }) {
  if (!urls.length) return null;
  return <div className="mf-urlTags" aria-label="收藏网址">{urls.map((item) => <UrlTag key={item.id} item={item} />)}</div>;
}

function SessionFolder({ sessions, scope, useSessions, openSession }: any) {
  const [open, setOpen] = useState(false); const [commandDown, setCommandDown] = useState(false); const [dragging, setDragging] = useState<string | null>(null); const [target, setTarget] = useState<string | null>(null);
  const roster = useSessions((state: any) => state.byId ?? {});
  const current = useSessions((state: any) => state.current as string | undefined);
  useEffect(() => { const down = (event: KeyboardEvent) => setCommandDown(event.metaKey); const up = () => setCommandDown(false); window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', up); return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', up); }; }, []);
  const reorder = async (sourceId: string, targetId: string) => { if (sourceId === targetId) return; const next = [...sessions]; const source = next.findIndex((item) => item.id === sourceId); const destination = next.findIndex((item) => item.id === targetId); if (source < 0 || destination < 0) return; const [item] = next.splice(source, 1); next.splice(destination, 0, item); await scope.set('sessions', next); };
  return <div><button className="mf-folderButton" data-open={open} type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? <IconFolderOpen16 className="mf-folderIcon" /> : <IconFolderClose16 className="mf-folderIcon" />}<span className="mf-folderLabel">收藏会话 ({sessions.length})</span></button>{open && <div className="mf-sessionFolder" aria-label="收藏会话">{sessions.length === 0 ? <div className="mf-empty">尚未收藏会话；在会话标题栏点击 ☆ 收藏当前会话。</div> : sessions.map((item: SessionFavorite) => { const live = roster[item.id]; const title = sessionTitle(live, item.title); const invalid = !live; const dragReady = commandDown; return <div className="mf-sessionRow" key={item.id} data-active={item.id === current} data-drag-ready={dragReady} data-dragging={dragging === item.id} data-drop-target={target === item.id} draggable={dragReady} title={dragReady ? '按住 ⌘ 拖动以排序' : undefined} onDragStart={(event) => { if (!commandDown) { event.preventDefault(); return; } event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); setDragging(item.id); }} onDragOver={(event) => { if (!dragging || dragging === item.id) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setTarget(item.id); }} onDrop={(event) => { event.preventDefault(); const source = event.dataTransfer.getData('text/plain'); if (source) reorder(source, item.id); setDragging(null); setTarget(null); }} onDragEnd={() => { setDragging(null); setTarget(null); }}><span className="mf-slot" aria-hidden="true" /><button className={`mf-sessionButton ${invalid ? 'mf-invalid' : ''}`} type="button" disabled={invalid} title={invalid ? `${item.title}（已失效）` : title} onClick={() => { openSession(item.id); }}>{invalid ? `${item.title}（已失效）` : title}</button><button className="mf-iconButton mf-remove" type="button" title="移除收藏" aria-label={`移除收藏：${item.title}`} onClick={() => scope.set('sessions', sessions.filter((entry: SessionFavorite) => entry.id !== item.id))}>×</button></div>; })}</div>}</div>;
}

function FavoritesLauncher({ scope, useSessions, openSession }: any) { const value = useSettings(scope); return <div className="mf-favorites">{value.urlsEnabled ? <UrlTags urls={value.urls} /> : null}<SessionFolder sessions={value.sessions} scope={scope} useSessions={useSessions} openSession={openSession} /></div>; }

function SidebarBelowNewSessionBridge({ scope, useSessions, openSession, wide }: any) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { const candidates = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="新建会话"], button[aria-label="New session"]')]; const newSession = candidates.find((button) => button.className.includes('newSession')); if (!newSession?.parentElement) return; const container = document.createElement('div'); container.className = 'mf-belowNewSessionBridge'; newSession.insertAdjacentElement('afterend', container); setHost(container); return () => container.remove(); }, []);
  // 侧边栏折叠（rail，宽 56px）时同步切换宿主容器显隐，整体隐藏收藏网址标签与会话收藏夹，并清除空 div 残留的间距。
  useEffect(() => { if (host) host.style.display = wide ? '' : 'none'; }, [host, wide]);
  // 折叠态直接不渲染任何内容。
  if (!wide) return null;
  return host ? ReactDOM.createPortal(<FavoritesLauncher scope={scope} useSessions={useSessions} openSession={openSession} />, host) : null;
}

function UrlSettingsCard({ scope }: { scope: Scope }) {
  const value = useSettings(scope); const [draft, setDraft] = useState({ name: '', url: '', icon: '', useFavicon: false }); const [error, setError] = useState('');
  const add = async () => { if (!draft.name.trim()) return setError('请填写名称。'); if (!validUrl(draft.url.trim())) return setError('网址仅支持 http、https 或 mailto。'); await scope.set('urls', [...value.urls, { id: crypto.randomUUID(), name: draft.name.trim(), url: draft.url.trim(), icon: draft.icon.trim(), useFavicon: draft.useFavicon }]); setDraft({ name: '', url: '', icon: '', useFavicon: false }); setError(''); };
  const update = (id: string, patch: Partial<UrlFavorite>) => scope.set('urls', value.urls.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
  const move = (index: number, direction: -1 | 1) => { const target = index + direction; if (target < 0 || target >= value.urls.length) return; const next = [...value.urls]; [next[index], next[target]] = [next[target], next[index]]; scope.set('urls', next); };
  const fields = (item: UrlFavorite, patch: (patch: Partial<UrlFavorite>) => void) => <><input className="mf-field" aria-label="名称" value={item.name} onChange={(e) => patch({ name: e.target.value })}/><input className="mf-field" aria-label="网址" value={item.url} onChange={(e) => patch({ url: e.target.value })}/><input className="mf-field" aria-label="自定义图标" placeholder="自定义 icon" value={item.icon} onChange={(e) => patch({ icon: e.target.value })}/><label title="使用 {协议}://{域名}/favicon.ico；加载失败时回退为自定义 icon 或名称"><input type="checkbox" checked={item.useFavicon} onChange={(e) => patch({ useFavicon: e.target.checked })}/> 使用网站图标</label></>;
  return <div className="mf-card"><strong>网址设置</strong><label className="mf-toggleRow" title="关闭后侧栏不再显示网址快捷标签"><input type="checkbox" checked={value.urlsEnabled} onChange={(e) => scope.set('urlsEnabled', e.target.checked)}/> 启用收藏的网站</label><div className="mf-urlList">{value.urls.map((item, index) => <div className="mf-urlRow" key={item.id}>{fields(item, (patch) => update(item.id, patch))}<button className="mf-iconButton" type="button" onClick={() => move(index, -1)} disabled={index === 0}>↑</button><button className="mf-iconButton mf-danger" type="button" onClick={() => scope.set('urls', value.urls.filter((entry) => entry.id !== item.id))}>×</button></div>)}</div><div className="mf-form"><input className="mf-field" placeholder="名称" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/><input className="mf-field" placeholder="https://example.com" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })}/><input className="mf-field" placeholder="自定义 icon（可选）" value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })}/><label title="使用网站自己的 favicon"><input type="checkbox" checked={draft.useFavicon} onChange={(e) => setDraft({ ...draft, useFavicon: e.target.checked })}/> 使用网站图标</label><button className="mf-primary" type="button" onClick={add}>添加</button></div>{error && <div className="mf-error">{error}</div>}</div>;
}

function SessionSettingsCard({ scope }: { scope: Scope }) {
  const value = useSettings(scope);
  const [countDraft, setCountDraft] = useState(String(value.recentCount ?? DEFAULT_RECENT));
  useEffect(() => setCountDraft(String(value.recentCount ?? DEFAULT_RECENT)), [value.recentCount]);
  const commitCount = () => { const parsed = clampRecentCount(Number(countDraft)); setCountDraft(String(parsed)); if (parsed !== value.recentCount) scope.set('recentCount', parsed); };
  return <div className="mf-card"><strong>会话切换</strong><div className="mf-sessionSettings">
    <div className="mf-modeGroup" role="radiogroup" aria-label="切换模式">
      <label><input type="radio" name="switcher-mode" checked={value.mode !== 'recent'} onChange={() => { if (value.mode !== 'favorites') scope.set('mode', 'favorites'); }} /> 收藏的会话</label>
      <label><input type="radio" name="switcher-mode" checked={value.mode === 'recent'} onChange={() => { if (value.mode !== 'recent') scope.set('mode', 'recent'); }} /> 最近的会话</label>
    </div>
    {value.mode === 'recent' && <div className="mf-countRow"><label htmlFor="mf-recent-count">最近 N 个会话</label><input id="mf-recent-count" className="mf-field" type="number" min={MIN_RECENT} max={MAX_RECENT} value={countDraft} onChange={(e) => setCountDraft(e.target.value)} onBlur={commitCount} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /></div>}
    <p className="mf-modeNote">快捷键 <code>⌘⌥`</code> / <code>Ctrl+`</code> 快速切换；按住弹出列表循环选择。「最近」按会话最近活动时间倒序（含当前会话）。</p>
  </div></div>;
}

function SettingsCard({ scope }: { scope: Scope }) {
  return <section className="mf-settings"><div><h2>收藏</h2><p>网址标签展示优先级：网站图标 → 自定义 icon → 名称。</p></div><SessionSettingsCard scope={scope} /><UrlSettingsCard scope={scope} /></section>;
}

/** 长按判定窗口：在此窗口内若出现 key-repeat 则判定为长按（0.25s）。 */
const SWITCHER_HOLD_MS = 250;
/** 列表循环的最小步进间隔（节流 OS key-repeat，默认约 33ms/次太快）。 */
const SWITCHER_STEP_MS = 160;
/** 弹框后首次步进前的停留时间（0.5s），给用户一个反应窗口。 */
const SWITCHER_FIRST_STEP_MS = 500;

/** macOS 上纯 ⌘+` 被系统占用（窗口切换），因此要求 ⌘+⌥+`；其它平台仍用 Ctrl+`。 */
function primaryModifier(event: KeyboardEvent): boolean {
  const isMac = navigator.platform.startsWith('Mac') || navigator.userAgent.includes('Macintosh');
  if (isMac) return event.metaKey && event.altKey;
  return event.ctrlKey;
}

/** 把 id 移到 LRU 栈顶（去重）。 */
function touchOrder(list: string[], id: string): string[] {
  const without = list.filter((entry) => entry !== id);
  return [id, ...without];
}

type SwitcherItem = { id: string; title: string; sub?: string; workspaceTitle?: string };
type SwitcherSnapshot = { open: boolean; activeIndex: number; items: SwitcherItem[]; hint: string | null };

/**
 * 模块级会话切换状态机：与 React 生命周期彻底解耦。
 * 键盘监听在启动时注册一次，永不因会话切换而销毁重建（这正是之前
 * “松开按键后弹框不消失、也不切换”的竞态根因——effect 依赖 current，
 * openSession 触发 current 变化 → 监听器被 cleanup，后续 keyup 无人处理）。
 */
class SwitcherMachine {
  private listeners = new Set<() => void>();
  private lru: string[] = [];
  private current: string | undefined;
  private sessions: SessionFavorite[] = [];
  private roster: Record<string, any> = {};
  private recentIds: string[] = [];
  private listPhase: 'pending' | 'ready' = 'pending';
  private mode: SwitcherMode = 'favorites';
  private recentCount = DEFAULT_RECENT;
  private open = false;
  private activeIndex = 0;
  private hint: string | null = null;
  private hintTimer: number | null = null;
  private phase: 'idle' | 'pending' = 'idle';
  private lastStepAt = 0;
  private holdTimer: number | null = null;
  private openSession: (id: string) => void = () => {};
  private disposers: Array<() => void> = [];
  /** session id → 所属工作区项目名（title，缺失时回退 path basename）。 */
  private workspaceTitleById: Record<string, string> = {};

  start(opts: {
    openSession: (id: string) => void;
    getList: () => { current?: string; byId?: Record<string, any>; ids?: string[]; phase?: 'pending' | 'ready' };
    subscribeList: (fn: () => void) => () => void;
    getWorkspaces: () => { items?: Array<{ workspaceId?: string; title?: string; path?: string; sessionIds?: string[] }> };
    subscribeWorkspaces: (fn: () => void) => () => void;
    getSettings: () => SettingsValue;
    subscribeSettings: (fn: () => void) => () => void;
    setSettings: (field: SettingField, value: unknown) => Promise<void>;
  }) {
    this.openSession = opts.openSession;

    const sync = () => {
      const list = opts.getList();
      this.roster = list.byId ?? {};
      this.recentIds = list.ids ?? [];
      this.listPhase = list.phase ?? 'pending';
      if (list.current && list.current !== this.current) {
        this.lru = touchOrder(this.lru, list.current);
      }
      this.current = list.current;
      const settings = opts.getSettings();
      this.sessions = settings.sessions ?? [];
      this.mode = settings.mode ?? 'favorites';
      this.recentCount = clampRecentCount(settings.recentCount ?? DEFAULT_RECENT);

      // 工作区项目名映射：遍历 workspaces.items，用 sessionIds 反查所属 workspace。
      const wsTitles: Record<string, string> = {};
      const wsItems = opts.getWorkspaces().items ?? [];
      for (const ws of wsItems) {
        const name = workspaceTitleOf(ws.title, ws.path);
        if (name && ws.sessionIds) for (const sid of ws.sessionIds) wsTitles[sid] = name;
      }
      this.workspaceTitleById = wsTitles;

      // 删除后清除残留：会话被宿主删除（session.list 不再返回该 id）后，
      // 只在该列表「就绪」态下判定失效并不可逆地清除收藏，杜绝 pending 期间误删。
      this.lru = this.lru.filter((id) => this.roster[id]);
      if (this.listPhase === 'ready') {
        const alive = this.sessions.filter((s) => this.roster[s.id]);
        if (alive.length !== this.sessions.length) {
          this.sessions = alive;
          void opts.setSettings('sessions', alive);
        }
      }

      this.emit();
    };

    this.disposers = [opts.subscribeList(() => sync()), opts.subscribeSettings(() => sync()), opts.subscribeWorkspaces(() => sync())];
    sync();
    this.disposers.push(this.installKeyboard());
  }

  private installKeyboard(): () => void {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { if (this.open) { event.preventDefault(); this.close(); } return; }
      // 死键（dead key）：` 的 event.key 是 'Dead'，只认物理键位 event.code === 'Backquote'。
      if (event.code !== 'Backquote') return;
      if (!primaryModifier(event)) return;
      event.preventDefault();
      if (event.repeat) {
        // 已弹框时，repeat 驱动列表循环（带首步停留节流）。
        if (this.open) { this.step(); }
        return;
      }
      // 首次按下（非 repeat）。
      if (this.open) { this.step(); return; }
      this.phase = 'pending';
      this.clearHold();
      // 长按判定：修饰键 250ms 内未松（keyup 没到）即视为长按 → 弹框。
      // 快速按靠修饰键 keyup 在此窗口内到达来提前触发，见 onKeyUp。
      this.holdTimer = window.setTimeout(() => {
        this.holdTimer = null;
        if (this.phase !== 'pending') return;
        this.phase = 'idle';
        this.openList();
      }, SWITCHER_HOLD_MS);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const isMod = event.key === 'Meta' || event.key === 'Control' || event.key === 'Alt';
      if (this.open) {
        // 列表态：修饰键上行即确认（死键 ` 无 keyup）。
        if (isMod) { this.confirm(); }
        return;
      }
      if (this.phase === 'pending' && isMod) {
        // 快速按：修饰键在 250ms 内松开 → 立即回溯，不等定时器。
        this.phase = 'idle';
        this.clearHold();
        this.quickStep();
      }
    };
    const onBlur = () => this.close();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur, true);
    return () => { window.removeEventListener('keydown', onKeyDown, true); window.removeEventListener('keyup', onKeyUp, true); window.removeEventListener('blur', onBlur, true); this.clearHold(); };
  }

  private clearHold() { if (this.holdTimer != null) { clearTimeout(this.holdTimer); this.holdTimer = null; } }

  private items(): SwitcherItem[] {
    if (this.mode === 'recent') return this.recentItems();
    return this.favoriteItems();
  }

  /** 收藏模式：当前会话 + LRU（最近访问）+ 剩余收藏。 */
  private favoriteItems(): SwitcherItem[] {
    const favLookup = new Set(this.sessions.map((s) => s.id).filter((id) => this.roster[id]));
    const lruFav = this.lru.filter((id) => favLookup.has(id));
    const currentIn = this.current && favLookup.has(this.current) ? this.current : null;
    const ordered = currentIn ? [currentIn, ...lruFav.filter((id) => id !== currentIn)] : lruFav;
    for (const id of this.sessions.map((s) => s.id)) if (favLookup.has(id) && !ordered.includes(id)) ordered.push(id);
    return ordered.map((id) => ({ id, title: sessionTitle(this.roster[id], id), sub: this.roster[id]?.cwd, workspaceTitle: this.workspaceTitleById[id] }));
  }

  /** 最近模式：以 LRU（最近访问）为排序源，冷启动时用宿主 updatedAt 倒序 ids 兜底；过滤空会话（blank）与子 agent 会话后取前 N。 */
  private recentItems(): SwitcherItem[] {
    // 排序源 = lru（最近访问，栈顶最新）+ 兜底 recentIds（updatedAt 倒序，去重补足）。
    const ordered = [...this.lru.filter((id) => this.roster[id])];
    for (const id of this.recentIds) if (this.roster[id] && !ordered.includes(id)) ordered.push(id);
    const windowSize = this.recentCount + 32;
    return ordered.slice(0, windowSize)
      .map((id) => this.roster[id])
      .filter((session): session is Record<string, any> => !session.blank && !session.origin)
      .slice(0, this.recentCount)
      .map((session) => ({ id: session.id, title: sessionTitle(session, session.id), sub: session.cwd, workspaceTitle: this.workspaceTitleById[session.id] }));
  }

  private openList() {
    const list = this.items();
    if (list.length === 0) { this.showHint('没有可切换的会话。'); return; }
    const currentIdx = list.findIndex((item) => item.id === this.current);
    this.activeIndex = currentIdx === 0 && list.length > 1 ? 1 : 0;
    // 弹框后预留 0.5s 停留：把 lastStepAt 前推，使首次 step 被节流延后到 500ms 后。
    this.lastStepAt = Date.now() + (SWITCHER_FIRST_STEP_MS - SWITCHER_STEP_MS);
    this.open = true;
    this.emit();
  }
  private step() {
    const list = this.items();
    if (!list.length) return;
    const now = Date.now();
    if (now - this.lastStepAt < SWITCHER_STEP_MS) return;
    this.lastStepAt = now;
    this.activeIndex = (this.activeIndex + 1) % list.length;
    this.emit();
  }
  private confirm() {
    const list = this.items();
    const target = list[Math.min(Math.max(this.activeIndex, 0), list.length - 1)];
    const wasOpen = this.open;
    this.open = false;
    this.emit();
    if (wasOpen && target && target.id !== this.current) this.openSession(target.id);
  }
  private close() {
    this.phase = 'idle';
    this.clearHold();
    if (this.open) { this.open = false; this.emit(); }
  }
  /** 鼠标点击列表项：确认并切换。 */
  focusById(id: string) {
    const list = this.items();
    const idx = list.findIndex((item) => item.id === id);
    if (idx >= 0) this.activeIndex = idx;
    this.confirm();
  }
  /** 鼠标点击遮罩：取消（不切换）。 */
  cancelById() { this.close(); }
  private quickStep() {
    const list = this.items();
    if (list.length === 0) { this.showHint('没有可切换的会话。'); return; }
    if (list.length === 1) {
      if (list[0].id !== this.current) this.openSession(list[0].id);
      else this.showHint('没有其他会话可切换。');
      return;
    }
    const currentIdx = list.findIndex((item) => item.id === this.current);
    if (currentIdx < 0) { if (list[0].id !== this.current) this.openSession(list[0].id); return; }
    const prev = list[(currentIdx + 1) % list.length];
    if (prev.id !== this.current) this.openSession(prev.id);
    else this.showHint('没有其他会话可切换。');
  }

  private emit() { this.snapshot = { open: this.open, activeIndex: this.activeIndex, items: this.items(), hint: this.hint }; for (const fn of this.listeners) fn(); }
  private snapshot: SwitcherSnapshot = { open: false, activeIndex: 0, items: [], hint: null };
  getSnapshot = (): SwitcherSnapshot => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  dispose() { for (const d of this.disposers) { try { d(); } catch {} } this.disposers = []; this.listeners.clear(); this.open = false; this.clearHint(); }

  /** 短暂提示（无目标可切等边界场景）。 */
  private showHint(message: string) {
    this.hint = message; this.emit(); this.clearHint();
    this.hintTimer = window.setTimeout(() => { this.hint = null; this.emit(); }, 1600);
  }
  private clearHint() { if (this.hintTimer != null) { clearTimeout(this.hintTimer); this.hintTimer = null; } }
}

const switcherMachine = new SwitcherMachine();

function SessionSwitcherOverlay({ items, activeId, hint, onConfirm, onCancel }: { items: SwitcherItem[]; activeId: string | null; hint: string | null; onConfirm: (id: string) => void; onCancel: () => void }) {
  const active = items.find((item) => item.id === activeId) ?? items[1] ?? items[0];
  const visible = items.slice(0, 20);
  return <div className="mf-switcher-overlay" onClick={onCancel}><div className="mf-switcher-panel" onClick={(event) => event.stopPropagation()}><div className="mf-switcher-head">{active ? <><strong>{active.title}</strong>{(active.workspaceTitle || active.sub) ? <small>{active.workspaceTitle || active.sub}</small> : null}</> : <strong>收藏会话</strong>}</div><div className="mf-switcher-list">{visible.map((item) => <button key={item.id} type="button" className="mf-switcher-item" data-active={item.id === active?.id} data-anchor={visible.indexOf(item) === 0} onClick={() => onConfirm(item.id)}><span className="mf-switcher-title">{item.title}</span>{item.workspaceTitle ? <span className="mf-switcher-workspace">{item.workspaceTitle}</span> : null}</button>)}</div><div className="mf-switcher-hint">继续按 ` / ~ 循环选择 · 松开确认 · Esc 取消</div></div></div>;
}

/** 纯提示浮层：无目标可切时的短暂提示（不遮挡操作）。 */
function SwitcherHintHost() {
  const snap = useSyncExternalStore(switcherMachine.subscribe, switcherMachine.getSnapshot);
  if (!snap.hint) return null;
  return ReactDOM.createPortal(<div className="mf-switcher-toast" role="status">{snap.hint}</div>, document.body);
}

/** 纯渲染层：订阅 SwitcherMachine 快照，渲染浮层。不含任何键盘逻辑，生命周期无关。 */
function SessionSwitcherHost() {
  const snap = useSyncExternalStore(switcherMachine.subscribe, switcherMachine.getSnapshot);
  if (!snap.open) return null;
  const activeId = snap.items[snap.activeIndex]?.id ?? null;
  return ReactDOM.createPortal(<SessionSwitcherOverlay items={snap.items} activeId={activeId} hint={snap.hint} onConfirm={(id) => { switcherMachine.focusById(id); }} onCancel={() => switcherMachine.cancelById()} />, document.body);
}

export const inject = ['slots', 'remote', 'sessions', 'workspaces'];
export async function apply(ctx: any) {
  const host = ctx.remote;
  let remote: RemoteFavorites | undefined;
  let unmount: (() => void) | undefined;
  if (host && typeof host.$mount === 'function') {
    try {
      unmount = await host.$mount(REMOTE_CONTRIBUTION);
      remote = ctx.get('remote.myFavorites');
      if (remote === undefined) console.warn('[newbe-my-favorites] remote.myFavorites 不可用，收藏设置退化为内存态');
    } catch (error) {
      console.error('[newbe-my-favorites] remote contribution 挂载失败', error);
    }
  } else {
    console.warn('[newbe-my-favorites] 客户端缺少 remote 服务，收藏设置退化为内存态');
  }
  if (unmount) ctx.effect(() => () => { void unmount(); }, 'newbe-my-favorites: remote unmount');
  const scope: Scope = createFavoritesScope(remote, ctx);
  ctx.effect(() => ensureStyles(), 'newbe-my-favorites: styles'); ctx.effect(() => { try { const sessionsList = ctx.sessions.list; const workspacesList = ctx.workspaces.list; switcherMachine.start({ openSession: (id: string) => ctx.sessions.open(id), getList: () => sessionsList.getSnapshot(), subscribeList: (fn) => sessionsList.subscribe(fn), getWorkspaces: () => workspacesList.getSnapshot(), subscribeWorkspaces: (fn) => workspacesList.subscribe(fn), getSettings: () => scope.getSnapshot().value ?? { sessions: [], urls: [], mode: 'favorites', recentCount: DEFAULT_RECENT }, subscribeSettings: (fn) => scope.subscribe(fn), setSettings: (field, value) => scope.set(field, value) }); } catch (e) { console.error('[newbe-my-favorites] switcher start FAILED', e); } return () => switcherMachine.dispose(); }, 'newbe-my-favorites: switcher'); ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: 'newbe-my-favorites-toggle', order: -5, inject: () => ({ scope }) }, FavoriteToggle)); ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'newbe-my-favorites-below-new-session-bridge', order: 5, inject: () => ({ scope, openSession: (id: string) => ctx.sessions.open(id) }) }, SidebarBelowNewSessionBridge)); ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'newbe-my-favorites-session-switcher', order: 6, inject: () => ({}) }, SessionSwitcherHost)); ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 'newbe-my-favorites-switcher-hint', order: 7, inject: () => ({}) }, SwitcherHintHost)); ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({ name: 'settings.plugins.tab', id: 'newbe-my-favorites', order: 30, label: () => '收藏', inject: () => ({ scope }) }, SettingsCard)); }
