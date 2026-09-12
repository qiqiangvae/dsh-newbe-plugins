/**
 * 启动配置持久化：读宽容（损坏/缺失都降级并留告警）、写严格（非法输入拒绝且不落盘）。
 *
 * 原子写与 dsh-newbe-my-favorites 的实现刻意重复，不做跨包依赖：
 * 两个插件各自独立发布，共享包会把它们的版本绑在一起。
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultState, ideStateSchema, type IdeState } from './schema.js';

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
  } catch { /* 部分平台不支持目录 fsync，忽略 */ }
}

/** 读取磁盘状态；文件缺失返回空配置，损坏则降级并给出告警（原文件保持不动）。 */
export function loadState(file: string): { state: IdeState; warning: string } {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { state: defaultState(), warning: '' };
  }
  const parsed = ideStateSchema.safeParse(safeJson(text));
  if (parsed.success) return { state: parsed.data, warning: '' };
  const warning = `启动配置存储文件损坏，已改用空配置（原文件保持不动）：${file}`;
  console.warn(`[dsh-newbe-ide] ${warning}`);
  return { state: defaultState(), warning };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface ConfigStore {
  /** 加载期告警（'' 表示无）；用于面板上的可见提示。 */
  readonly warning: string;
  getState(): IdeState;
  /** 写入整份配置：非法输入 reject 且不落盘，成功返回提交后的状态。 */
  submit(input: unknown): Promise<IdeState>;
}

/** 内存态为唯一事实源，写入在单条链上串行化，先落盘再更新内存。 */
export function createConfigStore(file: string): ConfigStore {
  const loaded = loadState(file);
  let state = loaded.state;
  let warning = loaded.warning;
  let chain: Promise<void> = Promise.resolve();

  return {
    get warning() {
      return warning;
    },
    getState(): IdeState {
      return state;
    },
    submit(input: unknown): Promise<IdeState> {
      // 顶层宽容（缺字段补默认），嵌套严格（结构不对就拒绝）。
      const raw = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
      const parsed = ideStateSchema.safeParse({ ...defaultState(), ...raw });
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const where = first !== undefined && first.path.length > 0 ? first.path.join('.') : '顶层';
        return Promise.reject(new Error(`启动配置数据不合法（${where}）：${first?.message ?? '结构错误'}`));
      }
      const next = parsed.data;
      const task = chain.then(async () => {
        writeFileAtomic(file, JSON.stringify(next, null, 2) + '\n');
        state = next;
        warning = '';
        return state;
      });
      chain = task.then(() => undefined, () => undefined);
      return task;
    },
  };
}
