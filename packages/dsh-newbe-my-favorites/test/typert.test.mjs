/**
 * 宿主 Typert 清单的接线测试：DSH 0.1.6-alpha.2 起 typert-loader 只认
 * `{ mode: 'strict', typeSymbol, create }`——codec 必须用 create() 惰性给出 schema，
 * 直接挂 schema 字段会让整个 `dsh web` 在启动时 fatal（result codec has no create() factory）。
 * 从 lib 产物取值，所以改 src 之后必须先 build。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { TYPERT } = await import('../lib/typert.host.js');

test('宿主清单的每个严格 codec 都带 create() 工厂', () => {
  assert.equal(TYPERT.package, 'dsh-newbe-my-favorites');
  assert.equal(TYPERT.face, 'host');

  const codecsOf = (invocation) => [invocation.result, ...invocation.parameters.map((p) => p.codec)];
  for (const invocation of TYPERT.invocations) {
    for (const codec of codecsOf(invocation)) {
      assert.equal(codec.mode, 'strict', `${invocation.id} 用了非严格 codec`);
      assert.ok(codec.typeSymbol.length > 0, `${invocation.id} 的 codec 缺 typeSymbol`);
      assert.equal(typeof codec.create, 'function', `${invocation.id} 的 codec 没有 create() 工厂`);
      assert.equal(typeof codec.create().parse, 'function', `${invocation.id} 的 create() 没给出可 parse 的 schema`);
    }
  }
});
