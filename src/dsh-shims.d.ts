/**
 * DSH v0.1.2-rc.1 起，`@deepseek-ai/dsh-client-store` 与
 * `@deepseek-ai/dsh-client-ui-primitives` 不再是独立发布的 npm 包，而是由 Web
 * 外壳以「基线静态模块」（PLATFORM_MODULES）注入浏览器模块表。此处按宿主编译产物
 * 的实际签名垫类型，仅供 `pnpm run typecheck` 使用（构建时按 `external` 处理）。
 */
declare module '@deepseek-ai/dsh-client-store' {
  export interface SnapshotStore<T> {
    getSnapshot(): T;
    subscribe(fn: () => void): () => void;
    update(mutator: (draft: T) => void): void;
    set(next: T): void;
  }
  export function createSnapshotStore<T>(init: T, opts?: {
    flush?: 'raf' | 'sync';
    persist?: { name: string };
  }): SnapshotStore<T>;
  export function shallowEqual(a: unknown, b: unknown): boolean;
}

/**
 * DSH v0.1.2-alpha.1 官方图标集（私有包，未发布 npm）。宿主编译产物无 .d.ts，
 * 此处仅垫需要用到的一对「文件夹关/开」图标。
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactElement } from 'react';
  export interface DshIconProps {
    size?: number;
    className?: string;
  }
  export function IconFolderClose16(props?: DshIconProps): ReactElement;
  export function IconFolderOpen16(props?: DshIconProps): ReactElement;
}
