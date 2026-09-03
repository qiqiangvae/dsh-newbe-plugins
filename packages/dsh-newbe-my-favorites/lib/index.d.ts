import { FAVORITES_NAMESPACE, MIN_RECENT, MAX_RECENT, DEFAULT_RECENT } from './constants.js';
import { type FavoritesField, type FavoritesState } from './schema.js';
export { FAVORITES_NAMESPACE, MIN_RECENT, MAX_RECENT, DEFAULT_RECENT };
export type { FavoritesState, FavoritesField };
/** 持久化文件：$DSH_HOME/storages/dsh-my-favorites.json（与其它领域存储同目录）。 */
export declare const STORAGE_PATH: string;
export declare function defaultState(): FavoritesState;
/** 补默认值 + 收敛边界，得到可持久化的规范状态。 */
export declare function normalizeState(input: unknown): FavoritesState;
export declare function clampRecentCount(value: unknown): number;
/**
 * 原子整文件替换：同目录临时文件（wx 独占创建，0600）→ fsync → rename → 目录 fsync（尽力而为）。
 * 读取方只会看到旧内容或完整的新内容；失败时清理临时文件并重新抛出。
 */
export declare function writeFileAtomic(file: string, text: string): void;
/** 启动时加载磁盘状态；缺失或损坏时回退默认值（仅告警，不覆盖文件）。 */
export declare function loadState(file: string): FavoritesState;
export declare const name = "dsh-my-favorites";
export declare function apply(ctx: any): void;
