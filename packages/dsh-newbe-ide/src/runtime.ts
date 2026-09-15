/**
 * 运行注册表：一条启动配置对应一个受管进程，输出增量采集进内存环形缓冲。
 *
 * 只依赖 DSH `shell` 服务的公开契约（resolve / start / ShellProcess.readOutput / kill），
 * 因此可以用假 shell 完整验证；真实进程组回收另有实测覆盖。
 */
import { cleanLine, isSecretName, maskSecrets, splitLines } from './lines.js';
import { parsePort } from './rundisplay.js';
import type { LogSink } from './logsink.js';
import type { RunRead, RunSnapshot, RunStatus } from './schema.js';

interface ShellOutputDelta {
  delta: string;
  lossy: boolean;
}

interface ShellProcessLike {
  status: string;
  exitCode: number | null;
  done: Promise<void>;
  readOutput(): ShellOutputDelta;
  kill(): boolean;
}

interface ShellServiceLike {
  /**
   * `sandboxPolicy` **必须显式给**：`dsh-bash-sandbox` 的 resolve 实现是
   * `request.sandboxPolicy ?? ctx.sandboxPolicy.resolve()`——不给就套上环境默认策略，
   * 而默认策略在 `workspace-write` 下只允许写 `{workspaceRoot, /tmp, $TMPDIR}`。
   * 实测后果：面板启动的进程**连自己项目目录与 `~/.m2` 都写不了**，
   * `mvn` 直接 `resolver-status.properties (Operation not permitted)` + BUILD FAILURE。
   * 这里显式放行：面板启动的是用户自己的开发进程（dev server / mvn / uv），
   * 构建工具必须能写自己的 `target/`、`node_modules/` 与全局缓存——与 IDEA 点 Run 同类。
   * （策略结构只有 mode / workspaceRoot / sessionId，没有"额外可写路径"可加，
   * 所以只能整体放行；`workspaceRoot` 在放行模式下不参与判定，给 cwd 占位。）
   */
  resolve(request: {
    command: string;
    workdir?: string;
    env?: Record<string, string>;
    sandboxPolicy?: { mode: 'read-only' | 'workspace-write' | 'danger-full-access'; workspaceRoot: string };
  }): unknown;
  start(spec: unknown): ShellProcessLike;
}

export interface RunSpec {
  command: string;
  cwd: string;
  envs: readonly { name: string; value: string }[];
}

interface RunRegistry {
  start(key: string, spec: RunSpec): RunSnapshot;
  stop(key: string): RunSnapshot;
  read(key: string, from: number): RunRead;
  snapshot(key: string): RunSnapshot;
  snapshots(): RunSnapshot[];
  /** 把所有在跑进程的缓冲读空（由定时器驱动，保证输出及时入缓冲）。 */
  pump(): void;
  dispose(): void;
}

const DEFAULT_MAX_LINES = 5000;
const MAX_PENDING_CHARS = 65536;

interface RunRecord {
  key: string;
  status: RunStatus;
  exitCode: number | null;
  error: string;
  lossy: boolean;
  lines: string[];
  base: number;
  pending: string;
  secrets: string[];
  proc: ShellProcessLike | null;
  /** 是我们主动停的，还是进程自己没起来就死了——决定 killed 该记「已停止」还是「启动失败」。 */
  stopRequested: boolean;
  /** 本轮待落盘的行：一次 drain 批一次写，别一行一次 fsync。 */
  pendingAppend: string[];
  /** 本次启动时刻（毫秒）；未启动为 0。 */
  startedAtMs: number;
  /** 从输出里认出的端口；逐行更新，避免每次快照重扫整段缓冲。 */
  port: string;
  /** 缓冲里最后一条非空行；同样逐行维护。 */
  lastLine: string;
}

/** shell 服务可能后到（cordis 服务可增可减），因此用取值函数而不是实例。 */
type ShellProvider = () => ShellServiceLike | undefined;

interface RunRegistryOptions {
  maxLines?: number;
  /** 落盘去处；不传就只在内存里留（测试与无盘环境）。 */
  sink?: LogSink;
}

export function createRunRegistry(provideShell: ShellProvider, options: RunRegistryOptions = {}): RunRegistry {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  /** 批量丢弃的粒度：见 pushLine。按上限的 1/10 取，小上限时退化成逐行丢弃。 */
  const trimSlack = Math.max(1, Math.floor(maxLines / 10));
  const sink = options.sink;
  const runs = new Map<string, RunRecord>();

  function record(key: string): RunRecord {
    const existing = runs.get(key);
    if (existing !== undefined) return existing;
    const fresh: RunRecord = {
      key, status: 'idle', exitCode: null, error: '', lossy: false,
      lines: [], base: 0, pending: '', secrets: [], proc: null, stopRequested: false, pendingAppend: [], startedAtMs: 0, port: '', lastLine: '',
    };
    runs.set(key, fresh);
    return fresh;
  }

  /** 入环形缓冲，同时排队落盘（落盘失败不影响内存日志）。 */
  function emit(run: RunRecord, line: string): void {
    pushLine(run, line);
    run.pendingAppend.push(line);
    const port = parsePort(line);
    if (port !== '') run.port = port;
    if (line.trim() !== '') run.lastLine = line;
  }

  function flushAppend(run: RunRecord): void {
    if (run.pendingAppend.length === 0) return;
    const batch = run.pendingAppend;
    run.pendingAppend = [];
    try {
      sink?.append(run.key, batch);
    } catch {
      /* 磁盘写不进去也不能让日志流断掉 */
    }
  }

  function pushLine(run: RunRecord, line: string): void {
    run.lines.push(line);
    // 饱和后逐行 `splice(0, 1)` 每来一行都要把 5,000 个槽往前搬一次（纯搬移，白烧 CPU）。
    // 改成攒一批再丢：摊还 O(1)/行，代价是缓冲最多多留 maxLines/10 行（5,000 → 最多 5,500）。
    // slack 按上限比例取，是为了小上限（测试里的 maxLines=3）保持逐行丢弃的老行为。
    const excess = run.lines.length - maxLines;
    if (excess < trimSlack) return;
    run.lines.splice(0, excess);
    run.base += excess;
  }

  function drain(run: RunRecord): void {
    try {
      drainInto(run);
    } finally {
      // 无论从哪个分支返回，本轮的输出都要落盘——放在 finally 里，
      // 将来给 drainInto 加早退也不会悄悄丢掉排队的那批行。
      flushAppend(run);
    }
  }

  function drainInto(run: RunRecord): void {
    const proc = run.proc;
    if (proc === null) return;
    let output: ShellOutputDelta | undefined;
    try {
      output = proc.readOutput();
    } catch {
      return;
    }
    if (output !== undefined) {
      if (typeof output.delta === 'string' && output.delta.length > 0) {
        const split = splitLines(run.pending, output.delta);
        run.pending = split.pending;
        for (const line of split.lines) emit(run, maskSecrets(line, run.secrets));
      }
      if (output.lossy === true) run.lossy = true;
    }
    // 裸 \r 刷新（进度条）不产生 \n，若一直攒在 pending 里就既看不见又会无界增长：
    // 每轮泵把它收成一行（只保留最后一次覆写），面板因此每轮最多多出一行。
    if (run.pending.includes('\r')) {
      const progress = cleanLine(run.pending);
      if (progress !== '') emit(run, maskSecrets(progress, run.secrets));
      run.pending = '';
    } else if (run.pending.length > MAX_PENDING_CHARS) {
      emit(run, maskSecrets(run.pending.slice(0, MAX_PENDING_CHARS) + ' …（超长行已截断）', run.secrets));
      run.pending = '';
    }
    if (proc.status === 'running') {
      run.status = 'running';
      return;
    }
    // 进程已结束：把最后半行补成一行，再落状态。
    if (run.pending !== '') {
      emit(run, maskSecrets(cleanLine(run.pending), run.secrets));
      run.pending = '';
    }
    run.exitCode = proc.exitCode ?? null;
    if (proc.status === 'killed') {
      // shell 契约里 spawn 失败也以 killed 收场，所以只有"我们主动停的"才算已停止。
      if (run.stopRequested) {
        run.status = 'stopped';
      } else {
        run.status = 'failed';
        run.error = '进程未能启动（命令或工作目录不可用，详见日志）';
      }
    } else {
      // 自然退出：非 0 退出码不是"启动失败"，退出码本身已经说明问题（如 127 = 命令不存在）。
      run.status = 'exited';
    }
  }

  /**
   * 收尾后再判断：已经自然退出的进程不该再被杀。
   * 不在这里把状态改成「已停止」——SIGTERM 到真正退出之间有宽限期，
   * 抢报会让面板在进程还活着时说已停；由下一次泵看到 killed 再翻转。
   */
  function killIfRunning(run: RunRecord): boolean {
    drain(run);
    if (run.proc === null || run.status !== 'running') return false;
    run.stopRequested = true;
    try { run.proc.kill(); } catch { /* 已退出 */ }
    drain(run);
    return true;
  }

  function snapshotOf(run: RunRecord): RunSnapshot {
    return {
      key: run.key,
      status: run.status,
      exitCode: run.exitCode,
      error: run.error,
      lossy: run.lossy,
      startedAtMs: run.startedAtMs,
      port: run.port,
      lastLine: run.lastLine,
    };
  }

  return {
    start(key: string, spec: RunSpec): RunSnapshot {
      const shell = provideShell();
      const run = record(key);
      if (run.status === 'running' && !run.stopRequested) throw new Error('该启动配置已在运行');
      if (shell === undefined) throw new Error('shell 服务不可用，无法启动进程');
      if (spec.command.trim() === '') throw new Error('启动命令为空，先在「⚙ 启动配置」里填好');
      run.lines = [];
      run.base = 0;
      run.pending = '';
      run.lossy = false;
      run.stopRequested = false;
      run.exitCode = null;
      run.startedAtMs = Date.now();
      run.port = '';
      run.lastLine = '';
      run.error = '';
      run.secrets = spec.envs.filter((e) => isSecretName(e.name) && e.value !== '').map((e) => e.value);
      const env: Record<string, string> = {};
      for (const entry of spec.envs) if (entry.name !== '') env[entry.name] = entry.value;
      try {
        const resolved = shell.resolve({
          command: spec.command,
          workdir: spec.cwd,
          env,
          // 不给策略 = 套上环境默认沙箱 = 连 target/ 与 ~/.m2 都写不了（见 ShellServiceLike 的注释）
          sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: spec.cwd },
        });
        run.proc = shell.start(resolved);
        run.status = 'running';
      } catch (error) {
        run.proc = null;
        run.status = 'failed';
        run.error = String((error as Error)?.message ?? error);
        throw new Error(run.error);
      }
      return snapshotOf(run);
    },

    stop(key: string): RunSnapshot {
      const run = record(key);
      killIfRunning(run);
      return snapshotOf(run);
    },

    read(key: string, from: number): RunRead {
      const run = record(key);
      drain(run);
      const offset = Number.isFinite(from) ? Math.max(0, from) : 0;
      const end = run.base + run.lines.length;
      // offset 超前于当前缓冲 = 客户端还拿着上一代进程的偏移（重启竞态）：整份重发。
      const ahead = offset > end;
      const start = ahead ? 0 : Math.max(0, Math.min(run.lines.length, offset - run.base));
      return {
        ...snapshotOf(run),
        lines: run.lines.slice(start),
        next: end,
        dropped: ahead || offset < run.base,
      };
    },

    snapshot(key: string): RunSnapshot {
      const run = record(key);
      drain(run);
      return snapshotOf(run);
    },

    /**
     * 只读当前态，**不 drain**：输出由 250ms 的 pump 抽干，这里再抽一次是纯重复劳动——
     * 客户端每秒调 1.25 次，每次都会为每个配置做一遍 `Buffer.concat`（O(保留窗口)）。
     * 代价是这些字段最多旧 250ms，而客户端本来就是 800ms 轮询。
     */
    snapshots(): RunSnapshot[] {
      const out: RunSnapshot[] = [];
      for (const run of runs.values()) out.push(snapshotOf(run));
      return out;
    },

    pump(): void {
      for (const run of runs.values()) drain(run);
    },

    dispose(): void {
      for (const run of runs.values()) killIfRunning(run);
    },
  };
}
