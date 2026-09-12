/**
 * 日志落盘接缝：追加、读尾部、轮转、键消毒。
 * 进程重启后能读回上一次的输出，就靠这里；它必须自己保证不无限增长。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { createFileLogSink } = await import('../lib/index.js');

const dir = () => mkdtempSync(join(tmpdir(), 'dsh-newbe-ide-log-'));

test('追加后能读回尾部', () => {
  const sink = createFileLogSink(dir());
  sink.append('w/c', ['one', 'two']);
  sink.append('w/c', ['three']);
  assert.deepEqual(sink.tail('w/c', 10).lines, ['one', 'two', 'three']);
  assert.equal(sink.tail('w/c', 10).truncated, false);
});

test('tail 只取最后 N 行并标记 truncated', () => {
  const sink = createFileLogSink(dir());
  sink.append('w/c', ['1', '2', '3', '4', '5']);
  const tail = sink.tail('w/c', 2);
  assert.deepEqual(tail.lines, ['4', '5']);
  assert.equal(tail.truncated, true);
});

test('没有日志文件时返回空且不抛', () => {
  const sink = createFileLogSink(dir());
  assert.deepEqual(sink.tail('nobody/here', 10).lines, []);
  assert.equal(sink.tail('nobody/here', 10).truncated, false);
});

test('超过上限时轮转，主文件重新开始，旧内容留在 .1', () => {
  const root = dir();
  const sink = createFileLogSink(root, { maxBytes: 64 });
  for (let i = 0; i < 20; i += 1) sink.append('w/c', [`line-${i}-padding-padding-padding`]);
  const files = readdirSync(root).sort();
  assert.equal(files.length, 2, '应有主文件与 .1：' + files.join(','));
  assert.ok(files.some((f) => f.endsWith('.log')));
  assert.ok(files.some((f) => f.endsWith('.log.1')));
  const main = readFileSync(join(root, files.find((f) => f.endsWith('.log'))), 'utf8');
  assert.ok(main.length <= 64 * 3, '主文件应当被轮转截断，实际 ' + main.length);
  assert.ok(/line-19/.test(main), '最新内容应在主文件里');
});

test('键里的路径分隔符被消毒，写不出去', () => {
  const root = dir();
  const sink = createFileLogSink(root);
  sink.append('../../evil', ['x']);
  const files = readdirSync(root);
  assert.equal(files.length, 1);
  assert.ok(!files[0].includes('/'), '文件名不得含分隔符：' + files[0]);
  assert.ok(statSync(join(root, files[0])).isFile());
});

test('已有的历史文件同样可读（进程重启后的场景）', () => {
  const root = dir();
  const sink = createFileLogSink(root);
  writeFileSync(sink.path('w/c'), 'old-1\nold-2\n');
  assert.deepEqual(sink.tail('w/c', 10).lines, ['old-1', 'old-2']);
});

test('tailBytes 正好落在行首时，不丢掉那条完整行', () => {
  const root = dir();
  // 20 条等长行（每条 4 字节），tailBytes=40 正好切在第 10 条的行首
  const lines = Array.from({ length: 20 }, (_, i) => 'L' + String(i).padStart(2, '0'));
  const sink = createFileLogSink(root, { tailBytes: 40 });
  sink.append('w/c', lines);
  const tail = sink.tail('w/c', 10);
  assert.deepEqual(tail.lines, lines.slice(10), '应当正好拿到后 10 条完整行');
});

test('轮转一次之后，上一代（.1）的内容仍能读回', () => {
  const root = dir();
  const sink = createFileLogSink(root, { maxBytes: 100, tailBytes: 4096 });
  sink.append('w/c', ['oldest-1', 'oldest-2']);        // 19 字节
  sink.append('w/c', ['x'.repeat(60)]);                // 累计 80，未到上限
  sink.append('w/c', ['newest-' + 'n'.repeat(30)]);    // 80 + 38 > 100 → 触发轮转
  const tail = sink.tail('w/c', 1000);
  assert.deepEqual(tail.lines, ['oldest-1', 'oldest-2', 'x'.repeat(60), 'newest-' + 'n'.repeat(30)],
    '两代内容都在，且顺序是旧的在前');
  assert.equal(tail.truncated, false, '两代都读全了就不该报截断');
});

test('只保留一代：第二次轮转会覆盖更早的那一代', () => {
  const root = dir();
  const sink = createFileLogSink(root, { maxBytes: 40, tailBytes: 4096 });
  sink.append('w/c', ['gen-1']);
  sink.append('w/c', ['y'.repeat(50)]);  // 第一次轮转：gen-1 进 .1
  sink.append('w/c', ['z'.repeat(50)]);  // 第二次轮转：覆盖 .1
  const tail = sink.tail('w/c', 1000);
  assert.ok(!tail.lines.includes('gen-1'), '只留一代是老一代被覆盖，这是设计：' + tail.lines.join('|'));
  assert.ok(tail.lines.includes('z'.repeat(50)));
});

test('消毒会撞车的两个键不会写到同一个文件', () => {
  const root = dir();
  const sink = createFileLogSink(root);
  sink.append('a/b', ['first']);
  sink.append('a_b', ['second']);
  const files = readdirSync(root).sort();
  assert.equal(files.length, 2, '两个不同的键必须是两个文件：' + files.join(','));
  assert.deepEqual(sink.tail('a/b', 10).lines, ['first']);
  assert.deepEqual(sink.tail('a_b', 10).lines, ['second']);
});
