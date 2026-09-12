/**
 * 日志落盘：每条启动配置一个文件，追加写入、读尾部、超限轮转。
 *
 * 为什么需要它：进程输出只在内存环形缓冲里的话，DSH 一重启就没了；
 * 而"上次为什么挂的"往往正是重启之后才要看的。同时它必须自己保证不无限增长。
 */
import { appendFileSync, openSync, closeSync, existsSync, mkdirSync, readSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TAIL_BYTES = 512 * 1024;

export interface TailResult {
  lines: string[];
  /** 命中行数超过请求的 maxLines，或只读了文件尾部——更早的内容没进来。 */
  truncated: boolean;
}

export interface LogSink {
  append(key: string, lines: readonly string[]): void;
  tail(key: string, maxLines: number): TailResult;
  path(key: string): string;
}

export interface LogSinkOptions {
  maxBytes?: number;
  tailBytes?: number;
}

/** 键 → 文件名：只留安全字符，避免 ../ 之类的键写到目录外。 */
function fileName(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_') + '.log';
}

export function createFileLogSink(dir: string, options: LogSinkOptions = {}): LogSink {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const tailBytes = options.tailBytes ?? DEFAULT_TAIL_BYTES;
  const sizes = new Map<string, number>();

  const pathOf = (key: string) => join(dir, fileName(key));

  function sizeOf(file: string): number {
    try {
      return statSync(file).size;
    } catch {
      return 0;
    }
  }

  return {
    path: pathOf,

    append(key: string, lines: readonly string[]): void {
      if (lines.length === 0) return;
      const file = pathOf(key);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const text = lines.join('\n') + '\n';
      const known = sizes.get(file);
      const current = known ?? sizeOf(file);
      if (current + Buffer.byteLength(text) > maxBytes) {
        // 轮转：只留一代 .1，够回答"上次为什么挂"，又不会吃满磁盘。
        try {
          rmSync(file + '.1', { force: true });
          renameSync(file, file + '.1');
        } catch {
          /* 轮转失败就继续追加，宁可文件大一点也不丢日志 */
        }
        sizes.set(file, 0);
        appendFileSync(file, text, { mode: 0o600 });
        sizes.set(file, Buffer.byteLength(text));
        return;
      }
      appendFileSync(file, text, { mode: 0o600 });
      sizes.set(file, current + Buffer.byteLength(text));
    },

    tail(key: string, maxLines: number): TailResult {
      const file = pathOf(key);
      if (!existsSync(file)) return { lines: [], truncated: false };
      const size = sizeOf(file);
      const start = Math.max(0, size - tailBytes);
      const length = size - start;
      if (length <= 0) return { lines: [], truncated: false };
      const fd = openSync(file, 'r');
      let text: string;
      try {
        const buffer = Buffer.alloc(length);
        readSync(fd, buffer, 0, length, start);
        text = buffer.toString('utf8');
      } finally {
        closeSync(fd);
      }
      const parts = text.split('\n');
      // 从文件中段开始读时，第一行可能是半行，丢掉。
      if (start > 0) parts.shift();
      if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
      const truncated = parts.length > maxLines || start > 0;
      const lines = parts.length > maxLines ? parts.slice(parts.length - maxLines) : parts;
      return { lines, truncated };
    },
  };
}
