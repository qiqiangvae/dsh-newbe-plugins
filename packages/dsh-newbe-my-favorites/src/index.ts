/**
 * dsh-my-favorites Host 侧：
 * 1. 收藏状态持久化到 `$DSH_HOME/storages/dsh-my-favorites.json`（原子写），
 *    不再注册 DSH settings 命名空间，不污染 settings.yaml。
 * 2. 提供 `myFavorites` 服务（getState / setField），经手写 Typert 清单
 *    （./typert → lib/typert.host.js，由 typert-loader 自动注册）暴露给 Web 客户端，
 *    客户端经 `remote.myFavorites.*` 调用。
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { FAVORITES_NAMESPACE, MIN_RECENT, MAX_RECENT, DEFAULT_RECENT } from './constants.js';
import {
  favoritesFieldSchema,
  favoritesStateSchema,
  type FavoritesField,
  type FavoritesState,
  type SessionFavorite,
  type UrlFavorite,
} from './schema.js';

export { FAVORITES_NAMESPACE, MIN_RECENT, MAX_RECENT, DEFAULT_RECENT };
export type { FavoritesState, FavoritesField };

/** 持久化文件：$DSH_HOME/storages/dsh-my-favorites.json（与其它领域存储同目录）。 */
export const STORAGE_PATH = dshHomePath('storages', 'dsh-my-favorites.json');

export function defaultState(): FavoritesState {
  return { sessions: [], urls: [], mode: 'favorites', recentCount: DEFAULT_RECENT, urlsEnabled: true };
}

/** 补默认值 + 收敛边界，得到可持久化的规范状态。 */
export function normalizeState(input: unknown): FavoritesState {
  const parsed = favoritesStateSchema.safeParse(input);
  const value = parsed.success ? parsed.data : defaultState();
  return {
    sessions: value.sessions,
    urls: value.urls,
    mode: value.mode,
    recentCount: clampRecentCount(value.recentCount),
    urlsEnabled: value.urlsEnabled,
  };
}

export function clampRecentCount(value: unknown): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_RECENT;
  return Math.min(MAX_RECENT, Math.max(MIN_RECENT, Math.round(num)));
}

/**
 * 原子整文件替换：同目录临时文件（wx 独占创建，0600）→ fsync → rename → 目录 fsync（尽力而为）。
 * 读取方只会看到旧内容或完整的新内容；失败时清理临时文件并重新抛出。
 */
export function writeFileAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = join(dirname(file), `.${randomUUID()}.tmp`);
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    try { rmSync(tmp, { force: true }); } catch { /* 清理尽力而为 */ }
    throw error;
  }
  closeSync(fd);
  try {
    renameSync(tmp, file);
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch { /* 清理尽力而为 */ }
    throw error;
  }
  try {
    const dirFd = openSync(dirname(file), 'r');
    fsyncSync(dirFd);
    closeSync(dirFd);
  } catch { /* 目录 fsync 在部分平台上不可用，忽略 */ }
}

/** 启动时加载磁盘状态；缺失或损坏时回退默认值（仅告警，不覆盖文件）。 */
export function loadState(file: string): FavoritesState {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return defaultState();
  }
  try {
    return normalizeState(JSON.parse(text));
  } catch (error) {
    console.warn(`[dsh-my-favorites] 存储文件损坏，使用默认状态（${file}）：${String(error)}`);
    return defaultState();
  }
}

function sanitizeSessions(value: unknown): SessionFavorite[] {
  if (!Array.isArray(value)) throw new Error('sessions 必须是数组');
  return value
    .filter((item) => item != null && typeof item === 'object')
    .map((item) => ({ id: String((item as any).id ?? ''), title: String((item as any).title ?? '') }))
    .filter((item) => item.id !== '');
}

function sanitizeUrls(value: unknown): UrlFavorite[] {
  if (!Array.isArray(value)) throw new Error('urls 必须是数组');
  return value
    .filter((item) => item != null && typeof item === 'object')
    .map((item) => ({
      id: String((item as any).id ?? ''),
      name: String((item as any).name ?? ''),
      url: String((item as any).url ?? ''),
      icon: String((item as any).icon ?? ''),
      useFavicon: Boolean((item as any).useFavicon),
    }))
    .filter((item) => item.id !== '');
}

/** 把单个字段写入候选状态（不改磁盘，不校验整体）。 */
function applyField(state: FavoritesState, field: FavoritesField, value: unknown): void {
  switch (field) {
    case 'sessions':
      state.sessions = sanitizeSessions(value);
      break;
    case 'urls':
      state.urls = sanitizeUrls(value);
      break;
    case 'mode':
      if (value !== 'favorites' && value !== 'recent') throw new Error('mode 必须是 favorites 或 recent');
      state.mode = value;
      break;
    case 'recentCount':
      state.recentCount = clampRecentCount(value);
      break;
    case 'urlsEnabled':
      if (typeof value !== 'boolean') throw new Error('urlsEnabled 必须是布尔值');
      state.urlsEnabled = value;
      break;
  }
}

/**
 * 创建 myFavorites 服务：内存态为唯一事实源，写入在单条链上串行化，
 * 先落盘再更新内存（磁盘失败时内存保持旧值，读写不漂移）。
 * 手写 `typertRemote` 绑定（service/serviceKey/namespace），供 API 网关校验。
 */
function createFavoritesService(file: string) {
  let state = loadState(file);
  let chain: Promise<void> = Promise.resolve();

  const persist = (next: FavoritesState) => writeFileAtomic(file, JSON.stringify(next, null, 2) + '\n');

  const service = {
    /** 返回当前完整状态副本（经 RPC 序列化前不暴露内部引用）。 */
    getState(): FavoritesState {
      return normalizeState(state);
    },
    /** 写入单个字段，返回提交后的完整状态；非法字段/值直接抛错且不落盘。 */
    setField(field: unknown, value: unknown): Promise<FavoritesState> {
      const parsed = favoritesFieldSchema.safeParse(field);
      if (!parsed.success) return Promise.reject(new Error(`未知的收藏设置字段：${JSON.stringify(field)}`));
      const task = chain.then(async () => {
        const next = normalizeState(state);
        applyField(next, parsed.data, value);
        const normalized = normalizeState(next);
        await persist(normalized);
        state = normalized;
        return normalizeState(state);
      });
      chain = task.then(() => void 0, () => void 0);
      return task;
    },
  };

  Object.defineProperty(service, 'typertRemote', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { service, serviceKey: 'myFavorites', namespace: 'myFavorites' },
  });
  return service;
}

export const name = 'dsh-my-favorites';

export function apply(ctx: any) {
  const service = createFavoritesService(STORAGE_PATH);
  console.log(`[dsh-my-favorites] 存储文件：${STORAGE_PATH}`);
  // 客户端经 remote.myFavorites.* 调用（./typert 清单由 typert-loader 自动注册）。
  ctx.provide('myFavorites', service);
}
