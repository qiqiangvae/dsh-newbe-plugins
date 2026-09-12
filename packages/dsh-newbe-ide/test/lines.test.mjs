/**
 * 日志行切分接缝：把任意文本块变成"整行"，处理跨 chunk 半行、\r 覆写、ANSI 转义、
 * 以及密钥掩码。这是纯函数边界，不碰进程也不碰 UI。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { splitLines, cleanLine, maskSecrets } = await import('../lib/index.js');

test('整行输出直接切分，末尾半行留作 pending', () => {
  assert.deepEqual(splitLines('', 'a\nb\nc'), { lines: ['a', 'b'], pending: 'c' });
});

test('半行跨 chunk 拼接成一行', () => {
  const first = splitLines('', 'par');
  assert.deepEqual(first, { lines: [], pending: 'par' });
  assert.deepEqual(splitLines(first.pending, 'tial\nrest'), { lines: ['partial'], pending: 'rest' });
});

test('\\r 覆写只保留最后一次内容（Maven 进度行）', () => {
  assert.equal(cleanLine('Downloading 50% \rDownloading 100% done'), 'Downloading 100% done');
});

test('ANSI 转义被剥离', () => {
  assert.equal(cleanLine('\u001b[32mINFO\u001b[0m started'), 'INFO started');
});

test('密钥值在整行里被掩码，空值不参与', () => {
  assert.equal(maskSecrets('token=sk-abc end', ['sk-abc']), 'token=**** end');
  assert.equal(maskSecrets('nothing here', []), 'nothing here');
  assert.equal(maskSecrets('a b c', ['', 'b']), 'a **** c');
});
