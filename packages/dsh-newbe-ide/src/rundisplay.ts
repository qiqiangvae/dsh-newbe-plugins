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
 * 从日志里认监听端口：只认 `port <数字>` 这种明确写法。
 * 不拿 `:8083` 这类裸冒号去猜——时间戳里全是冒号，猜错比不显示更糟。
 */
export function parsePortFromLines(lines: readonly string[]): string {
  let found = '';
  for (const line of lines) {
    const matched = /\bport\s+(\d{2,5})\b/i.exec(line);
    if (matched !== null) found = matched[1];
  }
  return found;
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
