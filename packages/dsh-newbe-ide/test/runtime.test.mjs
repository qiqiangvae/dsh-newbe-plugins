/**
 * 运行注册表接缝：与 DSH `shell` 服务的契约（resolve / start / readOutput / kill），
 * 用假 shell 驱动，不依赖真实进程。真实进程组回收已由动态插件原型的实测覆盖。
 *
 * 假进程如实模拟两件真实语义：
 *  - kill() 只是发信号，进程不会同步消失（SIGTERM 有宽限期）；
 *  - spawn 失败在 shell 契约里以 killed 收场，因此"不是我们停的 killed"必须区别对待。
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
    kill() { this.killed = true; return true; },
    /** 宽限期结束：进程真的没了。 */
    exitBySignal() { this.status = 'killed'; },
    finish(code) { this.status = 'completed'; this.exitCode = code; },
    emit(text) { delta += text; },
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

test('自然退出都记 exited，退出码如实带出（非 0 ≠ 启动失败）', () => {
  const shell = makeShell();
  const runs = createRunRegistry(() => shell);
  runs.start('w/c', SPEC);
  shell.started[0].proc.finish(0);
  assert.equal(runs.read('w/c', 0).status, 'exited');
  runs.start('w/c2', SPEC);
  shell.started[1].proc.finish(2);
  const done = runs.read('w/c2', 0);
  assert.equal(done.status, 'exited');
  assert.equal(done.exitCode, 2);
});

test('停止：发信号时进程可能还在，真退出后才记已停止', () => {
  const shell = makeShell();
  const runs = createRunRegistry(() => shell);
  runs.start('w/c', SPEC);
  assert.equal(runs.stop('w/c').status, 'running', '宽限期内不该抢报已停止');
  assert.equal(shell.started[0].proc.killed, true);
  shell.started[0].proc.exitBySignal();
  assert.equal(runs.read('w/c', 0).status, 'stopped');
});

test('不是我们停的 killed = 进程没起来：记 failed 并给出可读原因', () => {
  const shell = makeShell();
  const runs = createRunRegistry(() => shell);
  runs.start('w/c', SPEC);
  shell.started[0].proc.exitBySignal(); // shell 契约：spawn 失败也以 killed 收场
  const snap = runs.read('w/c', 0);
  assert.equal(snap.status, 'failed');
  assert.match(snap.error, /进程未能启动/);
});

test('dispose 回收仍在跑的进程，已退出的不碰', () => {
  const shell = makeShell();
  const runs = createRunRegistry(() => shell);
  runs.start('w/c', SPEC);
  runs.start('w/c2', SPEC);
  shell.started[1].proc.finish(0);
  runs.dispose();
  assert.equal(shell.started[0].proc.killed, true);
  assert.equal(shell.started[1].proc.killed, false);
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
  assert.deepEqual(runs.read('w/c', 5).lines, []);
});

test('偏移超前于当前缓冲（重启竞态）时整份重发并标记 dropped', () => {
  const shell = makeShell();
  const runs = createRunRegistry(() => shell);
  runs.start('w/c', SPEC);
  shell.started[0].proc.emit('old1\nold2\n');
  runs.read('w/c', 0);
  runs.stop('w/c');
  runs.start('w/c', SPEC);        // 重启：缓冲归零，客户端可能还拿着上一代的偏移
  shell.started[1].proc.emit('new1\nnew2\n');
  const snap = runs.read('w/c', 40);
  assert.equal(snap.dropped, true);
  assert.deepEqual(snap.lines, ['new1', 'new2']);
});

test('裸 CR 进度刷新每轮泵收成一行：不丢、也不在 pending 里无界堆积', () => {
  const shell = makeShell();
  const runs = createRunRegistry(() => shell);
  runs.start('w/c', SPEC);
  const { proc } = shell.started[0];
  proc.emit('Downloading 10%\r');
  runs.pump();
  assert.deepEqual(runs.read('w/c', 0).lines, ['Downloading 10%']);
  proc.emit('\rDownloading 60%');
  runs.pump();
  assert.deepEqual(runs.read('w/c', 1).lines, ['Downloading 60%']);
  proc.emit('\rDownloading 100% done\n');
  runs.pump();
  assert.deepEqual(runs.read('w/c', 2).lines, ['Downloading 100% done']);
});

test('shell 不可用 / 命令为空 / 重复启动给出可读错误', () => {
  assert.throws(() => createRunRegistry(() => undefined).start('w/c', SPEC), /shell 服务不可用/);
  const shell = makeShell();
  const runs = createRunRegistry(() => shell);
  assert.throws(() => runs.start('w/c', { ...SPEC, command: '   ' }), /启动命令为空/);
  runs.start('w/c', SPEC);
  assert.throws(() => runs.start('w/c', SPEC), /已在运行/);
});
