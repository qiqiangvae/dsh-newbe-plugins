/**
 * 日志过滤接缝：级别识别、关键字/正则匹配、过滤结果的形状。
 * 纯函数，不碰 DOM 也不碰进程——过滤必须在数千行量级即时完成，所以它是独立的可测单元。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { levelOf, compileMatcher, filterLines, DEFAULT_LEVELS } = await import('../lib/index.js');

const BOOT = [
  '2026-09-12 10:12:31.204  INFO 41207 --- [           main] c.p.k.a.web.KunAiApplication : Starting KunAiApplication',
  '2026-09-12 10:12:35.117  WARN 41207 --- [           main] c.p.k.a.core.config.RedisConfiguration : Redis 连接池使用默认超时 2000ms',
  '2026-09-12 10:12:35.990 ERROR 41207 --- [           main] c.p.k.a.core.review.RuleLoader : 规则文件加载失败',
  '\tat com.pingpongx.kun.ai.core.review.RuleLoader.load(RuleLoader.java:64)',
  '2026-09-12 10:12:36.911  INFO 41207 --- [           main] c.p.k.a.web.KunAiApplication : Started KunAiApplication in 6.482 seconds',
];

test('级别识别：TRACE 归入 DEBUG，FATAL 归入 ERROR，无级别归 OTHER', () => {
  assert.equal(levelOf('2026-09-12 INFO 1 --- [main] X : hi'), 'INFO');
  assert.equal(levelOf('2026-09-12 ERROR 1 --- [main] X : hi'), 'ERROR');
  assert.equal(levelOf('2026-09-12 FATAL 1 --- [main] X : hi'), 'ERROR');
  assert.equal(levelOf('2026-09-12 TRACE 1 --- [main] X : hi'), 'DEBUG');
  assert.equal(levelOf('\tat com.foo.Bar.baz(Bar.java:1)'), 'OTHER');
  assert.equal(levelOf('pure text'), 'OTHER');
});

test('默认级别集合：ERROR/WARN/INFO/OTHER 开，DEBUG 关', () => {
  assert.deepEqual({ ...DEFAULT_LEVELS }, { ERROR: true, WARN: true, INFO: true, DEBUG: false, OTHER: true });
});

test('关键字过滤不区分大小写，且标出命中', () => {
  const m = compileMatcher({ q: 'redis', regex: false });
  const out = filterLines(BOOT, { matcher: m, onlyMatch: false, levels: DEFAULT_LEVELS });
  assert.equal(out.length, 5, '未开"仅看匹配"时行数不变');
  assert.equal(out.filter((r) => r.hit).length, 1);
  assert.match(out.find((r) => r.hit).line, /Redis 连接池/);
});

test('仅看匹配：只留命中行', () => {
  const m = compileMatcher({ q: 'Redis', regex: false });
  const out = filterLines(BOOT, { matcher: m, onlyMatch: true, levels: DEFAULT_LEVELS });
  assert.equal(out.length, 1);
  assert.equal(out[0].level, 'WARN');
});

test('正则开关生效；非法正则退回字面匹配且不抛', () => {
  const ok = compileMatcher({ q: 'Rule\\w+', regex: true });
  // 命中两行：ERROR 那行的 RuleLoader，以及它下面那条堆栈帧（同样含 RuleLoader）——
  // 堆栈跟着错误一起留下，正是过滤时想要的行为。
  const hits = filterLines(BOOT, { matcher: ok, onlyMatch: true, levels: DEFAULT_LEVELS });
  assert.equal(hits.length, 2);
  assert.ok(hits.every((r) => r.line.includes('RuleLoader')));
  // 非法正则不抛错，按字面理解：把同样的字符当普通文本，能匹配到就命中。
  const fellBack = compileMatcher({ q: 'RuleLoader(', regex: true });
  assert.ok(fellBack !== null);
  assert.equal(filterLines(['see RuleLoader( now'], { matcher: fellBack, onlyMatch: true, levels: DEFAULT_LEVELS }).length, 1);
  const noMatch = compileMatcher({ q: '([unclosed', regex: true });
  assert.equal(filterLines(BOOT, { matcher: noMatch, onlyMatch: true, levels: DEFAULT_LEVELS }).length, 0);
});

test('级别徽章：关掉 WARN 后 WARN 行消失', () => {
  const levels = { ...DEFAULT_LEVELS, WARN: false };
  const out = filterLines(BOOT, { matcher: null, onlyMatch: false, levels });
  assert.equal(out.length, 4);
  assert.ok(!out.some((r) => r.level === 'WARN'));
});

test('空关键字视为不过滤', () => {
  assert.equal(compileMatcher({ q: '', regex: false }), null);
  assert.equal(compileMatcher({ q: '   ', regex: false }), null);
  assert.equal(filterLines(BOOT, { matcher: null, onlyMatch: true, levels: DEFAULT_LEVELS }).length, 5);
});

test('过滤不改动原数组、保持顺序', () => {
  const copy = BOOT.slice();
  const out = filterLines(BOOT, { matcher: null, onlyMatch: false, levels: DEFAULT_LEVELS });
  assert.deepEqual(BOOT, copy);
  assert.deepEqual(out.map((r) => r.line), BOOT);
});
