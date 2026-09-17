/**
 * 宿主 Typert 清单的接线测试：codec 必须**同时**满足两代 DSH 的契约，缺一个就红——
 * 老一代（≤ 0.1.6-alpha.1）的 typert-loader 直接读 `codec.schema`，要求它是带 `parse` 的 zod v4 实例；
 * 新一代（≥ 0.1.6-alpha.2）只认 `create()` 惰性工厂，没有它整个 `dsh web` 启动就 fatal
 * （result codec has no create() factory）。
 * 从 lib 产物取值，所以改 src 之后必须先 build。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { TYPERT } = await import('../lib/typert.host.js');

test('宿主清单的每个严格 codec 都同时带 schema 与 create() 工厂', () => {
  assert.equal(TYPERT.package, 'dsh-newbe-my-favorites');
  assert.equal(TYPERT.face, 'host');

  const codecsOf = (invocation) => [invocation.result, ...invocation.parameters.map((p) => p.codec)];
  for (const invocation of TYPERT.invocations) {
    for (const codec of codecsOf(invocation)) {
      assert.equal(codec.mode, 'strict', `${invocation.id} 用了非严格 codec`);
      assert.ok(codec.typeSymbol.length > 0, `${invocation.id} 的 codec 缺 typeSymbol`);
      assert.equal(typeof codec.schema?.parse, 'function', `${invocation.id} 的 codec 没有老一代要的 schema.parse`);
      assert.ok('_zod' in codec.schema, `${invocation.id} 的 codec.schema 不是 zod v4 实例`);
      assert.equal(typeof codec.create, 'function', `${invocation.id} 的 codec 没有新一代要的 create() 工厂`);
      assert.equal(typeof codec.create().parse, 'function', `${invocation.id} 的 create() 没给出可 parse 的 schema`);
    }
  }
});
