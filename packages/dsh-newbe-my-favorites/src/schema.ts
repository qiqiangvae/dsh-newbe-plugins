/**
 * 收藏数据的 wire schema（zod v4）。
 * Host 侧持久化校验、./typert 清单与客户端 Remote contribution 三方共用，
 * 保证磁盘状态与 RPC 编解码使用同一份结构定义。
 */
import { z } from 'zod';

export const sessionFavoriteSchema = z.object({
  id: z.string(),
  title: z.string(),
});

export const urlFavoriteSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  icon: z.string(),
  useFavicon: z.boolean(),
});

export const switcherModeSchema = z.union([z.literal('favorites'), z.literal('recent')]);

/** 收藏持久化状态（~/.dsh/storages/dsh-newbe-my-favorites.json 的完整内容）。 */
export const favoritesStateSchema = z.object({
  sessions: z.array(sessionFavoriteSchema),
  urls: z.array(urlFavoriteSchema),
  mode: switcherModeSchema,
  recentCount: z.number(),
  urlsEnabled: z.boolean(),
});

/** setField 允许写入的字段名。 */
export const favoritesFieldSchema = z.union([
  z.literal('sessions'),
  z.literal('urls'),
  z.literal('mode'),
  z.literal('recentCount'),
  z.literal('urlsEnabled'),
]);

/** setField 的字段值：类型随字段不同，由 Host 侧按字段语义校验。 */
export const favoritesFieldValueSchema = z.unknown();

/**
 * 一个严格 Typert codec（宿主 ./typert 清单与客户端 descriptors 共用）。
 * 两个字段**都要带**，才能跨 DSH 版本：
 * - `schema`：≤ 0.1.6-alpha.1 的 typert-loader / registry 直接读它（要求是 zod v4 实例、有 `parse`）；
 * - `create()`：≥ 0.1.6-alpha.2 只认惰性工厂，老写法会让 `dsh web` 启动 fatal
 *   （`result codec has no create() factory`）。
 * 两边的校验都只查自己认识的字段，多带一个不影响。
 */
export function strictCodec<T extends { parse(value: unknown): unknown }>(typeSymbol: string, schema: T) {
  return { mode: 'strict' as const, typeSymbol, schema, create: () => schema };
}

export type SessionFavorite = z.infer<typeof sessionFavoriteSchema>;
export type UrlFavorite = z.infer<typeof urlFavoriteSchema>;
export type SwitcherMode = z.infer<typeof switcherModeSchema>;
export type FavoritesState = z.infer<typeof favoritesStateSchema>;
export type FavoritesField = z.infer<typeof favoritesFieldSchema>;
