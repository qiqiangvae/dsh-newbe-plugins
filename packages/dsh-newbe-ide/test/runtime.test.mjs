/**
 * 运行注册表接缝：与 DSH `shell` 服务的契约（resolve / start / readOutput / kill），
 * 用假 shell 驱动，不依赖真实进程。真实进程组回收已由动态插件原型的实测覆盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createRunRegistry } = await import('../lib/index.js');

function makeFakeProcess() {
  let delta = '';
  return {
    status: 'running',
    exitCode: null,
    done: new Promise(() => {}),
    killed: false,
    readOutput() { const d = delta; delta = ''; return { delta: d, lossy: false }; },
    kill() { this.killed = true; this.status = 'killed'; return true; },
    emit(text) { delta += text; },
    finish(code) { this.status = 'completed'; this.exitCode = code; },
  };
}

function makeShell() {
  const started = [];
  return {
    started,
    resolve(request) { return request; },
    start(spec) { const proc = makeFakeProcess(); started.push({ spec, proc }); return proc; },
  };
}

const SPEC = { command: 'mvn -o test', cwd: '/tmp/kun-ai', envs: [{ name: 'A', value: '1' }] };

test('启动把命令、工作目录、环境变量交给 shell，并进入运行中', () => {
  const shell = makeShell();
  const runs = createRunRegistry(() => shell);
  assert.equal(runs.start('w/c', SPEC).status, 'running');
  assert.equal(shell.started.length, 1);
  assert.equal(shell.started[0].spec.command, 'mvn -o test');
  assert.equal(shell.started[0].spec.workdir, '/tmp/kun-ai');
  assert.deepEqual({ ...shell.started[0].spec.env }, { A: '1' });
});

test('读取是增量的：第二次读不重复已给过的行', () => {
  const shell = makeShell();
  const runs = createRunRegistry(() => shell);
  runs.start('w/c', SPEC);
  const { proc } = shell.started[0];
  proc.emit('one\ntwo\n');
  const first = runs.read('w/c', 0);
  assert.deepEqual(first.lines, ['one', 'two']);
  assert.equal(first.next, 2);
  proc.emit('three\n');
  const second = runs.read('w/c', first.next);
  assert.deepEqual(second.lines, ['three']);
  assert.equal(second.next, 3);
});

test('半行跨 chunk 在注册表里也拼成一行', () => {
  const shell = makeShell();
  const runs = createRunRegistry(() => shell);
  runs.start('w/c', SPEC);
  const { proc } = shell.started[0];
  proc.emit('par');
  assert.deepEqual(runs.read('w/c', 0).lines, []);
  proc.emit('tial\n');
  assert.deepEqual(runs.read('w/c', 0).lines, ['partial']);
});

test('进程自然退出：退出码 0 记 exited，非 0 记 failed', () => {
  const shell = makeShell();
  const runs = createRunRegistry(() => shell);
  runs.start('w/c', SPEC);
  shell.started[0].proc.finish(0);
  assert.equal(runs.read('w/c', 0).status, 'exited');
  runs.start('w/c2', SPEC);
  shell.started[1].proc.finish(2);
  const failed = runs.read('w/c2', 0);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.exitCode, 2);
});

test('停止调用 kill 并置为已停止', () => {
  const shell = makeShell();
  const runs = createRunRegistry(() => shell);
  runs.start('w/c', SPEC);
  assert.equal(runs.stop('w/c').status, 'stopped');
  assert.equal(shell.started[0].proc.killed, true);
});

test('dispose 回收仍在跑的进程', () => {
  const shell = makeShell();
  const runs = createRunRegistry(() => shell);
  runs.start('w/c', SPEC);
  runs.start('w/c2', SPEC);
  shell.started[1].proc.finish(0);
  runs.dispose();
  assert.equal(shell.started[0].proc.killed, true);
  assert.equal(shell.started[1].proc.killed, false, '已退出的进程不该再杀');
});

test('密钥值在日志里被掩码', () => {
  const shell = makeShell();
  const runs = createRunRegistry(() => shell);
  runs.start('w/c', { ...SPEC, envs: [{ name: 'HARNESS_LLM_API_KEY', value: 'sk-secret' }] });
  shell.started[0].proc.emit('using sk-secret to call\n');
  assert.deepEqual(runs.read('w/c', 0).lines, ['using **** to call']);
});

test('超过上限从头部丢弃，并标记 dropped', () => {
  const shell = makeShell();
  const runs = createRunRegistry(() => shell, 3);
  runs.start('w/c', SPEC);
  shell.started[0].proc.emit('1\n2\n3\n4\n5\n');
  const all = runs.read('w/c', 0);
  assert.deepEqual(all.lines, ['3', '4', '5']);
  assert.equal(all.dropped, true);
  assert.equal(all.next, 5);
  const tail = runs.read('w/c', 5);
  assert.deepEqual(tail.lines, []);
});

test('shell 不可用 / 命令为空 / 重复启动给出可读错误', () => {
  assert.throws(() => createRunRegistry(() => undefined).start('w/c', SPEC), /shell 服务不可用/);
  const shell = makeShell();
  const runs = createRunRegistry(() => shell);
  assert.throws(() => runs.start('w/c', { ...SPEC, command: '   ' }), /启动命令为空/);
  runs.start('w/c', SPEC);
  assert.throws(() => runs.start('w/c', SPEC), /已在运行/);
});
