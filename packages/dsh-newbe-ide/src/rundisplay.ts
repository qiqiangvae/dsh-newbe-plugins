/**
 * 运行态的展示计算：时长文案、从日志里认端口、一级 tab 的聚合状态。
 * 纯函数——它们每 800ms 跑一次，且"猜错端口"比"不显示端口"更糟，所以单独可测。
 */
import type { RunStatus } from './schema.js';

/** 运行时长文案；时间倒流（时钟回拨）或未启动时返回空串。 */
export function formatUptime(startedAtMs: number, nowMs: number): string {
  if (startedAtMs <= 0 || nowMs <= startedAtMs) return '';
  const seconds = Math.floor((nowMs - startedAtMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * 从一行输出里认监听端口：只认 `port <数字>` 这种明确写法。
 * 不拿 `:8083` 这类裸冒号去猜——时间戳里全是冒号，猜错比不显示更糟。
 * 只做单行：调用方是逐行喂进来的，行的先后由调用方决定（后出现的覆盖先出现的）。
 */
export function parsePort(line: string): string {
  const matched = /\bport\s+(\d{2,5})\b/i.exec(line);
  return matched === null ? '' : matched[1];
}

const SEVERITY: Record<RunStatus, number> = { idle: 0, stopped: 1, exited: 2, failed: 3, running: 4 };

/** 一级 tab 的聚合状态：任一条在跑就是运行中；都不在跑时显示最"需要注意"的那个。 */
export function aggregateStatus(statuses: readonly RunStatus[]): RunStatus {
  if (statuses.length === 0) return 'idle';
  let worst: RunStatus = 'idle';
  for (const status of statuses) {
    if (SEVERITY[status] > SEVERITY[worst]) worst = status;
  }
  return worst;
}

/**
 * 这次读取是不是**真的丢了早期行**——决定面板要不要说"早期部分已丢弃"。
 *
 * 宿主的 `dropped` 有两种成因，含义完全不同：
 *   - `offset < base`：环形缓冲滚过了，早期行确实不在内存里 → 丢。
 *   - `offset > next`（我们手里的偏移超过宿主当前末尾）：进程重启后的重新同步，
 *     宿主把整份缓冲重发了一遍，**一行没丢**。
 * 后者也报 `dropped`，照搬就会在"刚重启"时冤枉自己丢了日志（客户端自己就能把两者分开：
 * 前者 `from <= next`，后者 `from > next`）。
 */
export function readLostLines(from: number, chunk: { next: number; dropped: boolean }): boolean {
  return chunk.dropped && from <= chunk.next;
}
