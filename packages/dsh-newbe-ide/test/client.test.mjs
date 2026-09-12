/**
 * 客户端 bundle 的接线测试：在假 module loader 里加载产物，验证
 * 1) bundle 形态正确（__ModuleLoader__.load + factory 返回插件）；
 * 2) 注册进正确的会话视图 tab 位（conversation.view / order 30 / label IDE）；
 * 3) 客户端 Remote contribution 的端点与宿主 Typert 清单逐条一致。
 * 不渲染 React（渲染由真实 DSH 验证），只锁接线契约。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const { TYPERT } = await import('../lib/typert.host.js');

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
};
const API_STUB = { load: async () => ({ ok: true, value: { config: { projects: [], activeWorkspaceId: '', showOverview: false }, projects: [], warning: '' } }), submit: async () => ({ ok: true, value: {} }) };

function loadClient() {
  let factory;
  const context = {
    window: { __ModuleLoader__: { load: ({ id, factory: f }) => { assert.equal(id, 'dsh-newbe-ide'); factory = f; } } },
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
      head: { appendChild() {} },
    },
    console,
    setTimeout: () => 0,
  };
  context.globalThis = context;
  vm.runInNewContext(bundle, context, { filename: 'lib/client.js' });
  assert.equal(typeof factory, 'function', 'bundle 未通过 __ModuleLoader__.load 自注册');
  const require = (name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return { jsx: React.createElement, jsxs: React.createElement, Fragment: 'Fragment' };
    if (name === 'react-dom') return {};
    throw new Error('未预期的 require：' + name);
  };
  return factory(require);
}

test('bundle 自注册并导出插件形态', () => {
  const plugin = loadClient();
  assert.equal(typeof plugin.apply, 'function');
  assert.deepEqual([...plugin.inject], ['slots', 'remote']);  // vm 里的数组原型不同，摊回宿主 realm 再比
});

test('注册会话视图 tab：对话/轨迹/上下文/IDE 里的第四个', async () => {
  const registered = [];
  const injected = [];
  let mounted;
  let unmounted = false;
  const slots = {
    inject: (key, callback) => { injected.push(key); callback(); return () => {}; },
    register: (options, component) => { registered.push({ options, component }); return () => {}; },
  };
  const ctx = {
    effect: (fn) => fn(),
    on: () => () => {},
    slots,
    remote: { $mount: async (contribution) => { mounted = contribution; return () => { unmounted = true; }; } },
    get: (name) => (name === 'remote.ideConfig' ? API_STUB : undefined),
  };
  await loadClient().apply(ctx);

  assert.deepEqual(injected, ['conversation.view'], '配置编辑已经在面板内，不再另注册设置页');

  const view = registered.find((r) => r.options.name === 'conversation.view');
  assert.ok(view !== undefined, '会话视图未注册');
  assert.equal(view.options.id, 'dsh-newbe-ide');
  assert.equal(view.options.order, 30, '对话 0 / 轨迹 10 / 上下文 20 / IDE 30');
  assert.equal(view.options.label, 'IDE');
  assert.equal(typeof view.component, 'function');

  assert.ok(mounted !== undefined, 'remote contribution 未挂载');
  assert.equal(unmounted, false);
});

test('$mount 失败不会让插件挂掉，面板仍注册（降级为可见提示）', async () => {
  const registered = [];
  const slots = {
    inject: (_key, callback) => { callback(); return () => {}; },
    register: (options, component) => { registered.push({ options, component }); return () => {}; },
  };
  const ctx = {
    effect: (fn) => fn(),
    on: () => () => {},
    slots,
    remote: { $mount: async () => { throw new Error('网关不可用'); } },
    get: () => undefined,
  };
  await loadClient().apply(ctx);
  assert.deepEqual(registered.map((r) => r.options.name), ['conversation.view']);
});

test('客户端端点与宿主 Typert 清单逐条一致', async () => {
  let mounted;
  const slots = { inject: (_k, cb) => { cb(); return () => {}; }, register: () => () => {} };
  const ctx = {
    effect: (fn) => fn(),
    on: () => () => {},
    slots,
    remote: { $mount: async (c) => { mounted = c; return async () => {}; } },
    get: (name) => (name === 'remote.ideConfig' ? API_STUB : undefined),
  };
  await loadClient().apply(ctx);
  const clientIds = Array.from(mounted.descriptors, (d) => d.id).sort();
  const hostIds = Array.from(TYPERT.invocations, (i) => i.id).sort();
  assert.deepEqual(clientIds, hostIds);
  assert.equal(mounted.package, TYPERT.package);
});
