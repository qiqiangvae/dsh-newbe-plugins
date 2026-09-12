/**
 * 运行注册表：一条启动配置对应一个受管进程，输出增量采集进内存环形缓冲。
 *
 * 只依赖 DSH `shell` 服务的公开契约（resolve / start / ShellProcess.readOutput / kill），
 * 因此可以用假 shell 完整验证；真实进程组回收另有实测覆盖。
 */
import { cleanLine, maskSecrets, splitLines } from './lines.js';

export interface ShellOutputDelta {
  delta: string;
  lossy: boolean;
}

export interface ShellProcessLike {
  status: string;
  exitCode: number | null;
  done: Promise<void>;
  readOutput(): ShellOutputDelta;
  kill(): boolean;
}

export interface ShellServiceLike {
  resolve(request: { command: string; workdir?: string; env?: Record<string, string> }): unknown;
  start(spec: unknown): ShellProcessLike;
}

export type RunStatus = 'idle' | 'running' | 'exited' | 'stopped' | 'failed';

export interface RunSpec {
  command: string;
  cwd: string;
  envs: readonly { name: string; value: string }[];
}

export interface RunSnapshot {
  key: string;
  status: RunStatus;
  exitCode: number | null;
  error: string;
  lossy: boolean;
}

export interface RunRead extends RunSnapshot {
  lines: string[];
  next: number;
  /** 请求的起点早于环形缓冲的最旧行，前面的已经丢掉了。 */
  dropped: boolean;
}

export interface RunRegistry {
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
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD/i;

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
}

/** shell 服务可能后到（cordis 服务可增可减），因此用取值函数而不是实例。 */
export type ShellProvider = () => ShellServiceLike | undefined;

export function createRunRegistry(provideShell: ShellProvider, maxLines: number = DEFAULT_MAX_LINES): RunRegistry {
  const runs = new Map<string, RunRecord>();

  function record(key: string): RunRecord {
    const existing = runs.get(key);
    if (existing !== undefined) return existing;
    const fresh: RunRecord = {
      key, status: 'idle', exitCode: null, error: '', lossy: false,
      lines: [], base: 0, pending: '', secrets: [], proc: null,
    };
    runs.set(key, fresh);
    return fresh;
  }

  function pushLine(run: RunRecord, line: string): void {
    run.lines.push(line);
    if (run.lines.length <= maxLines) return;
    const drop = run.lines.length - maxLines;
    run.lines.splice(0, drop);
    run.base += drop;
  }

  function drain(run: RunRecord): void {
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
        for (const line of split.lines) pushLine(run, maskSecrets(line, run.secrets));
      }
      if (output.lossy === true) run.lossy = true;
    }
    if (proc.status === 'running') {
      run.status = 'running';
      return;
    }
    // 进程已结束：把最后半行补成一行，再落状态。
    if (run.pending !== '') {
      pushLine(run, maskSecrets(cleanLine(run.pending), run.secrets));
      run.pending = '';
    }
    run.exitCode = proc.exitCode ?? null;
    if (proc.status === 'killed') run.status = 'stopped';
    else run.status = run.exitCode === 0 ? 'exited' : 'failed';
  }

  function snapshotOf(run: RunRecord): RunSnapshot {
    return { key: run.key, status: run.status, exitCode: run.exitCode, error: run.error, lossy: run.lossy };
  }

  return {
    start(key: string, spec: RunSpec): RunSnapshot {
      const shell = provideShell();
      const run = record(key);
      if (run.status === 'running') throw new Error('该启动配置已在运行');
      if (shell === undefined) throw new Error('shell 服务不可用，无法启动进程');
      if (spec.command.trim() === '') throw new Error('启动命令为空，先在「⚙ 启动配置」里填好');
      run.lines = [];
      run.base = 0;
      run.pending = '';
      run.lossy = false;
      run.exitCode = null;
      run.error = '';
      run.secrets = spec.envs.filter((e) => SECRET_NAME.test(e.name) && e.value !== '').map((e) => e.value);
      const env: Record<string, string> = {};
      for (const entry of spec.envs) if (entry.name !== '') env[entry.name] = entry.value;
      try {
        const resolved = shell.resolve({ command: spec.command, workdir: spec.cwd, env });
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
      if (run.proc !== null && run.status === 'running') {
        try { run.proc.kill(); } catch { /* 已退出 */ }
        drain(run);
        if (run.status === 'running') run.status = 'stopped';
      }
      return snapshotOf(run);
    },

    read(key: string, from: number): RunRead {
      const run = record(key);
      drain(run);
      const offset = Number.isFinite(from) ? Math.max(0, from) : 0;
      const start = Math.max(0, Math.min(run.lines.length, offset - run.base));
      return {
        ...snapshotOf(run),
        lines: run.lines.slice(start),
        next: run.base + run.lines.length,
        dropped: offset < run.base,
      };
    },

    snapshot(key: string): RunSnapshot {
      const run = record(key);
      drain(run);
      return snapshotOf(run);
    },

    snapshots(): RunSnapshot[] {
      const out: RunSnapshot[] = [];
      for (const run of runs.values()) {
        drain(run);
        out.push(snapshotOf(run));
      }
      return out;
    },

    pump(): void {
      for (const run of runs.values()) drain(run);
    },

    dispose(): void {
      for (const run of runs.values()) {
        drain(run); // 先收尾：已经自然退出的进程不该再被杀
        if (run.proc === null || run.status !== 'running') continue;
        try { run.proc.kill(); } catch { /* 已退出 */ }
        run.status = 'stopped';
      }
    },
  };
}
