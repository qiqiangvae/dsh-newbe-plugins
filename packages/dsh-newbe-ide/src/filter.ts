/**
 * 日志过滤：级别识别与关键字/正则匹配。纯函数——过滤要在数千行上即时生效，
 * 所以它不碰 DOM、不碰进程，单独可测。
 */
export type RunLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'OTHER';

/** 默认开哪几级：DEBUG 默认关（量最大、平时不需要）。 */
export const DEFAULT_LEVELS: Record<RunLevel, boolean> = {
  ERROR: true, WARN: true, INFO: true, DEBUG: false, OTHER: true,
};

/** 行内的级别关键字；FATAL 并入 ERROR，TRACE 并入 DEBUG。 */
const LEVEL_PATTERN = /(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)/;

export function levelOf(line: string): RunLevel {
  const found = LEVEL_PATTERN.exec(line);
  if (found === null) return 'OTHER';
  if (found[1] === 'FATAL') return 'ERROR';
  if (found[1] === 'TRACE') return 'DEBUG';
  return found[1] as RunLevel;
}

export interface Matcher {
  test(line: string): boolean;
  /** true 表示这是字面匹配（关键字为空以外的原因，例如正则非法而退回）。 */
  literal: boolean;
}

export interface MatcherSpec {
  q: string;
  regex: boolean;
}

/** 空关键字返回 null（= 不过滤）；正则非法时退回字面匹配而不是抛错。 */
export function compileMatcher(spec: MatcherSpec): Matcher | null {
  const q = spec.q.trim();
  if (q === '') return null;
  if (spec.regex) {
    try {
      const re = new RegExp(q, 'i');
      return { test: (line) => re.test(line), literal: false };
    } catch {
      /* 非法正则退回字面匹配 */
    }
  }
  const lowered = q.toLowerCase();
  return { test: (line) => line.toLowerCase().includes(lowered), literal: true };
}

export interface FilteredLine {
  line: string;
  level: RunLevel;
  /** 是否命中关键字（无关键字时恒为 false）。 */
  hit: boolean;
}

export interface FilterState {
  matcher: Matcher | null;
  onlyMatch: boolean;
  levels: Record<RunLevel, boolean>;
}

/** 过滤但不改动原数组，保持原顺序；无关键字时 onlyMatch 不生效。 */
export function filterLines(lines: readonly string[], state: FilterState): FilteredLine[] {
  const out: FilteredLine[] = [];
  for (const line of lines) {
    const level = levelOf(line);
    if (state.levels[level] !== true) continue;
    const hit = state.matcher !== null && state.matcher.test(line);
    if (state.onlyMatch && state.matcher !== null && !hit) continue;
    out.push({ line, level, hit });
  }
  return out;
}
