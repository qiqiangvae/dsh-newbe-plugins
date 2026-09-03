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

/** 收藏持久化状态（~/.dsh/storages/dsh-my-favorites.json 的完整内容）。 */
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

export type SessionFavorite = z.infer<typeof sessionFavoriteSchema>;
export type UrlFavorite = z.infer<typeof urlFavoriteSchema>;
export type SwitcherMode = z.infer<typeof switcherModeSchema>;
export type FavoritesState = z.infer<typeof favoritesStateSchema>;
export type FavoritesField = z.infer<typeof favoritesFieldSchema>;
