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

/**
 * 键 → 文件名：百分号编码，可逆且不会撞车。
 * 不用"把危险字符替换成下划线"那套：键里本来就有 `/`（`workspaceId/configId`），
 * 替换会让 `a/b` 与 `a_b` 落到同一个文件；补哈希又会让每个文件名都拖一串哈希。
 */
function fileName(key: string): string {
  return encodeURIComponent(key) + '.log';
}

/**
 * 从文件尾部读若干行。
 * `from` 会往前多取一个字节，用来判断起点是否正好落在行首——否则会把一条完整行当半行丢掉。
 */
function readTailLines(file: string, maxLines: number, tailBytes: number): { lines: string[]; more: boolean } {
  if (maxLines <= 0 || !existsSync(file)) return { lines: [], more: false };
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return { lines: [], more: false };
  }
  const want = Math.min(size, tailBytes);
  const from = Math.max(0, size - want - 1);
  const length = size - from;
  if (length <= 0) return { lines: [], more: false };
  const fd = openSync(file, 'r');
  let text: string;
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, from);
    text = buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
  let body = text;
  if (from > 0) {
    // from 指向 start-1：若它是换行，说明 start 正好是行首，整段都是完整行，不能丢。
    const cut = text[0] === '\n' ? 1 : text.indexOf('\n') + 1;
    if (cut === 0) return { lines: [], more: true }; // 这一段里没有换行，整段都是半行
    body = text.slice(cut);
  }
  const parts = body.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  const more = from > 0 || parts.length > maxLines;
  const lines = parts.length > maxLines ? parts.slice(parts.length - maxLines) : parts;
  return { lines, more };
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
      // 先读新一代；不够就补上一代（轮转出来的 .1）——否则"上次为什么挂"恰好落在被轮转掉的那一代里。
      const newest = readTailLines(pathOf(key), maxLines, tailBytes);
      if (newest.lines.length >= maxLines) return { lines: newest.lines, truncated: newest.more };
      const older = readTailLines(pathOf(key) + '.1', maxLines - newest.lines.length, tailBytes);
      return { lines: [...older.lines, ...newest.lines], truncated: older.more || newest.more };
    },
  };
}
