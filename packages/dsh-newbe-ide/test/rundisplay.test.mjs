/**
 * 运行态展示的纯函数接缝：时长文案、从日志里认端口、一级 tab 的聚合状态。
 * 这些都要在每 800ms 一次的重绘里跑，且不能依赖具体日志格式猜错。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { formatUptime, parsePort, aggregateStatus } = await import('../lib/index.js');

test('时长文案：秒 / 分秒 / 时分', () => {
  assert.equal(formatUptime(0, 1000), '');
  assert.equal(formatUptime(1000, 1000 + 42_000), '42s');
  assert.equal(formatUptime(1000, 1000 + 3 * 60_000 + 5000), '3m 5s');
  assert.equal(formatUptime(1000, 1000 + 2 * 3_600_000 + 7 * 60_000), '2h 7m');
});

test('时长文案：时间倒流（时钟回拨）不显示负数', () => {
  assert.equal(formatUptime(5000, 1000), '');
});

test('从 Spring Boot 日志里认出端口', () => {
  assert.equal(parsePort('2026-09-12 10:12:36.904  INFO 1 --- [main] o.s.b.w.e.t.TomcatWebServer : Tomcat started on port 8083 (http)'), '8083');
  assert.equal(parsePort('Netty started on port 8080'), '8080');
});

test('认不出端口就返回空串，不猜时间戳里的数字', () => {
  assert.equal(parsePort('2026-09-12 10:12:36.904  INFO 1 --- [nio-8083-exec-2] X : hi'), '');
  assert.equal(parsePort('nothing here'), '');
});

test('聚合状态优先级：运行中 > 启动失败 > 已退出 > 已停止 > 未启动', () => {
  assert.equal(aggregateStatus(['idle', 'idle']), 'idle');
  assert.equal(aggregateStatus(['stopped', 'idle']), 'stopped');
  // 自然退出（可能带非零码）比"我们主动停的"更值得注意，所以 exited 压过 stopped
  assert.equal(aggregateStatus(['stopped', 'exited']), 'exited');
  assert.equal(aggregateStatus(['exited', 'failed']), 'failed');
  // 但只要还有一条在跑，一级 tab 就是绿的
  assert.equal(aggregateStatus(['failed', 'running']), 'running');
  assert.equal(aggregateStatus(['idle', 'failed', 'running']), 'running');
  assert.equal(aggregateStatus([]), 'idle');
});
