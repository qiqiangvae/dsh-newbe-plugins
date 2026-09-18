/**
 * 客户端「切换会话 / 当前会话」接缝的回归测试。
 *
 * 锁住的是实测踩过的坑：0.1.6-alpha.2 把客户端 `sessions.open` 删了（导航改由
 * `uiWorkspace.openSession` 承担），老代码照旧调用 → 点收藏的会话、按快捷键都抛
 * `TypeError: ctx.sessions.open is not a function`，界面上就是"点了没反应"。
 * 同时锁住"不能把 uiWorkspace 写进 inject"——老版本没有它，硬依赖会让插件根本不挂载。
 *
 * 从 lib 产物取值，所以改 src 之后必须先 build。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  Fragment: 'Fragment',
};

/** 在假 module loader 里加载客户端产物，返回插件模块的导出。 */
function loadClient() {
  let factory;
  const context = {
    window: { __ModuleLoader__: { load: ({ id, factory: f }) => { assert.equal(id, 'dsh-newbe-my-favorites'); factory = f; } }, addEventListener() {}, removeEventListener() {} },
    document: { querySelector: () => null, createElement: () => ({ dataset: {}, textContent: '', remove() {}, appendChild() {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  context.globalThis = context;
  vm.runInNewContext(bundle, context, { filename: 'lib/client.js' });
  assert.equal(typeof factory, 'function', 'bundle 未通过 __ModuleLoader__.load 自注册');
  const require = (name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime' || name === 'react/jsx-dev-runtime') return { jsx: React.createElement, jsxs: React.createElement, Fragment: 'Fragment' };
    if (name === 'react-dom') return {};
    if (name === '@deepseek-ai/dsh-client-store') return { createSnapshotStore: (initial) => { let value = initial; return { getSnapshot: () => value, subscribe: () => () => {}, set: (next) => { value = next; } }; } };
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { IconFolderClose16: () => null, IconFolderOpen16: () => null };
    throw new Error(`未预期的 require：${name}`);
  };
  return factory(require);
}

const client = loadClient();

test('当前会话：老版本读 current，0.1.6+ 由 retainedBy.mainView 反推', () => {
  assert.equal(client.currentSessionId({ current: 's-old', byId: { 's-main': { retainedBy: { mainView: 1 } } } }), 's-old', '老版本快照里的 current 必须优先');
  assert.equal(client.currentSessionId({ byId: { a: { retainedBy: {} }, b: { retainedBy: { mainView: 2 } }, c: { retainedBy: { mainView: 1 } } } }), 'b');
  assert.equal(client.currentSessionId({ byId: { a: { retainedBy: {} } } }), undefined);
  assert.equal(client.currentSessionId(undefined), undefined);
});

test('切换会话：优先 uiWorkspace.openSession，回退老版本的 sessions.open', () => {
  const calls = [];
  const ctx = (extra) => ({
    get: (key) => (key === 'uiWorkspace' ? extra.uiWorkspace : undefined),
    sessions: { open: (id) => calls.push(['sessions.open', id]) },
    ...extra,
  });

  // 0.1.6-alpha.2：sessions.open 不存在，只有 uiWorkspace.openSession
  client.createSessionOpener({ get: (key) => (key === 'uiWorkspace' ? { openSession: (id) => calls.push(['uiWorkspace.openSession', id]) } : undefined), sessions: {} })('s-new');
  assert.deepEqual(calls, [['uiWorkspace.openSession', 's-new']]);

  // 两代都在时以 uiWorkspace 为准
  calls.length = 0;
  client.createSessionOpener(ctx({ uiWorkspace: { openSession: (id) => calls.push(['uiWorkspace.openSession', id]) } }))('s-both');
  assert.deepEqual(calls, [['uiWorkspace.openSession', 's-both']]);

  // 老版本：没有 uiWorkspace，回退 sessions.open
  calls.length = 0;
  client.createSessionOpener(ctx({ uiWorkspace: undefined }))('s-legacy');
  assert.deepEqual(calls, [['sessions.open', 's-legacy']]);

  // 两代都没有：不抛错（宁可什么都不做，也不能把事件处理器打崩）
  assert.doesNotThrow(() => client.createSessionOpener({ get: () => undefined, sessions: {} })('s-none'));
});

test('uiWorkspace 不进 inject（老版本没有它，硬依赖会让插件不挂载）', () => {
  assert.deepEqual([...client.inject], ['slots', 'remote', 'sessions', 'workspaces']);
});
