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
  writeFileSync(join(root, 'w_c.log'), 'old-1\nold-2\n');
  assert.deepEqual(sink.tail('w/c', 10).lines, ['old-1', 'old-2']);
});
