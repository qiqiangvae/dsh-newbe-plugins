/**
 * 日志过滤：级别识别与关键字/正则匹配。纯函数——过滤要在数千行上即时生效，
 * 所以它不碰 DOM、不碰进程，单独可测。
 */
export type RunLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'OTHER';

/** 级别的展示顺序：UI 的徽章、渲染用的 CSS 类都从这一份派生。 */
export const LEVELS: readonly RunLevel[] = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'OTHER'];

/** 默认全部打开：不主动隐藏任何输出，要看哪一级由用户关掉徽章决定。 */
export const DEFAULT_LEVELS: Record<RunLevel, boolean> = {
  ERROR: true, WARN: true, INFO: true, DEBUG: true, OTHER: true,
};

/**
 * 级别关键字按**独立词**匹配，不做子串匹配：`com.x.ErrorHandler` 不是 ERROR。
 * 先看标准日志格式里的大写 token；没有再小写兜底（npm / node / go 那些 `error:` 输出）。
 * FATAL 并入 ERROR，TRACE 并入 DEBUG。
 */
const UPPER_LEVEL = /\b(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b/;
const LOWER_LEVEL = /\b(trace|debug|info|warn|error|fatal)\b/i;

export function levelOf(line: string): RunLevel {
  const found = UPPER_LEVEL.exec(line) ?? LOWER_LEVEL.exec(line);
  if (found === null) return 'OTHER';
  const keyword = found[1].toUpperCase();
  if (keyword === 'FATAL') return 'ERROR';
  if (keyword === 'TRACE') return 'DEBUG';
  return keyword as RunLevel;
}

export interface Matcher {
  test(line: string): boolean;
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
      return { test: (line) => re.test(line) };
    } catch {
      /* 非法正则退回字面匹配 */
    }
  }
  const lowered = q.toLowerCase();
  return { test: (line) => line.toLowerCase().includes(lowered) };
}

export interface FilteredLine {
  line: string;
  level: RunLevel;
  /** 是否命中关键字（无关键字时恒为 false）。 */
  hit: boolean;
  /** 该行在**入参数组**里的下标：渲染拿它算绝对序号（滑动窗口下标会整体前移，不能当 key）。 */
  index: number;
}

export interface FilterState {
  matcher: Matcher | null;
  onlyMatch: boolean;
  levels: Record<RunLevel, boolean>;
}

/** 过滤但不改动原数组，保持原顺序；无关键字时 onlyMatch 不生效。 */
export function filterLines(lines: readonly string[], state: FilterState): FilteredLine[] {
  const out: FilteredLine[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const level = levelOf(line);
    if (state.levels[level] !== true) continue;
    const hit = state.matcher !== null && state.matcher.test(line);
    if (state.onlyMatch && state.matcher !== null && !hit) continue;
    out.push({ line, level, hit, index });
  }
  return out;
}
