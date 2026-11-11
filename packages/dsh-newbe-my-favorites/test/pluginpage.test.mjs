/**
 * 设置页挂在「插件」面板的插件页里（DSH 0.1.6-alpha.2 起，当前 0.2）。
 *
 * 官方插件的配置页（web-search / shell / agent-loop …）都注册在 `plugins.bundle.config`：
 * 「插件」面板按 npm 包名分派该槽位，key 与包名对不上时页面静默空白。旧入口
 * `settings.plugins.tab` 只剩「内置插件」的只读清单，本插件的设置页不再挂在那里。
 *
 * 从 lib 产物取值，所以改 src 之后必须先 build。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

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
    document: { querySelector: () => null, createElement: () => ({ dataset: {}, textContent: '', remove() {}, appendChild() {} }), head: { append() {}, appendChild() {} }, body: { appendChild() {} } },
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

test('设置页注册进「插件」面板的 bundle 配置槽位，key 是包名', async () => {
  const registrations = [];
  const ctx = {
    remote: undefined,
    get: () => undefined,
    effect: (fn) => { fn(); },
    slots: {
      inject: (_name, fn) => { fn(); return () => {}; },
      register: (options) => { registrations.push(options); return () => {}; },
    },
    sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
    workspaces: { list: { getSnapshot: () => ({}), subscribe: () => () => {} } },
  };
  await client.apply(ctx);
  const page = registrations.find((entry) => entry.name === 'plugins.bundle.config');
  assert.ok(page, '没有注册 plugins.bundle.config，插件页里不会出现设置页');
  assert.equal(page.key, manifest.name, '配置页的 key 必须等于 npm 包名');
  assert.ok(!registrations.some((entry) => entry.name === 'settings.plugins.tab'), '设置页仍注册到 settings.plugins.tab');
});

test('槽位声明包写进 dsh.client.inject，保证「插件」面板先于本插件就位', () => {
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-plugin-manager'));
});

test('插件页的标题/说明来自包内 locale 的 meta，manifest 导出了 locale 资源', () => {
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json');
  const zh = JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8'));
  assert.equal(zh.meta.title, '收藏');
  assert.ok(JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8')).meta.title.length > 0);
});
