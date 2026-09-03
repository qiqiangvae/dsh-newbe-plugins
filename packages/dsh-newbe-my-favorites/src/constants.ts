/** 设置命名空间（Host 与 Client 共用）。 */
export const FAVORITES_NAMESPACE = 'my-favorites';

/** 「最近 N 个会话」的 N 边界（单一事实来源：客户端 clamp 与 schema 校验共用）。 */
export const MIN_RECENT = 5;
export const MAX_RECENT = 20;
export const DEFAULT_RECENT = 10;
