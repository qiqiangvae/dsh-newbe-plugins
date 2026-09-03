/**
 * 收藏数据的 wire schema（zod v4）。
 * Host 侧持久化校验、./typert 清单与客户端 Remote contribution 三方共用，
 * 保证磁盘状态与 RPC 编解码使用同一份结构定义。
 */
import { z } from 'zod';
export declare const sessionFavoriteSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
}, z.core.$strip>;
export declare const urlFavoriteSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    url: z.ZodString;
    icon: z.ZodString;
    useFavicon: z.ZodBoolean;
}, z.core.$strip>;
export declare const switcherModeSchema: z.ZodUnion<readonly [z.ZodLiteral<"favorites">, z.ZodLiteral<"recent">]>;
/** 收藏持久化状态（~/.dsh/storages/dsh-my-favorites.json 的完整内容）。 */
export declare const favoritesStateSchema: z.ZodObject<{
    sessions: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
    }, z.core.$strip>>;
    urls: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        url: z.ZodString;
        icon: z.ZodString;
        useFavicon: z.ZodBoolean;
    }, z.core.$strip>>;
    mode: z.ZodUnion<readonly [z.ZodLiteral<"favorites">, z.ZodLiteral<"recent">]>;
    recentCount: z.ZodNumber;
    urlsEnabled: z.ZodBoolean;
}, z.core.$strip>;
/** setField 允许写入的字段名。 */
export declare const favoritesFieldSchema: z.ZodUnion<readonly [z.ZodLiteral<"sessions">, z.ZodLiteral<"urls">, z.ZodLiteral<"mode">, z.ZodLiteral<"recentCount">, z.ZodLiteral<"urlsEnabled">]>;
/** setField 的字段值：类型随字段不同，由 Host 侧按字段语义校验。 */
export declare const favoritesFieldValueSchema: z.ZodUnknown;
export type SessionFavorite = z.infer<typeof sessionFavoriteSchema>;
export type UrlFavorite = z.infer<typeof urlFavoriteSchema>;
export type SwitcherMode = z.infer<typeof switcherModeSchema>;
export type FavoritesState = z.infer<typeof favoritesStateSchema>;
export type FavoritesField = z.infer<typeof favoritesFieldSchema>;
