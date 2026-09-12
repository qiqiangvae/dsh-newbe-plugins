/**
 * Host 半边加载测试：用临时 DSH_HOME 真跑 apply()，验证
 * 1) 插件能加载、提供 ideConfig 服务；
 * 2) load() 把 DSH 工作区映射成面板项目，注册表缺失时不崩；
 * 3) submit() 落盘后 load() 能读回（真文件往返）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-newbe-ide-host-'));
process.env.DSH_HOME = home;

const mod = await import('../lib/index.js');

function makeCtx(workspaces) {
  const provided = {};
  const effects = [];
  return {
    provided,
    effects,
    ctx: {
      get: (name) => (name === 'workspaceRegistry' && workspaces !== null ? { list: () => workspaces } : undefined),
      provide: (key, value) => { provided[key] = value; },
      // 真 ctx 的 effect 会保留回调返回的清理函数；这里执行后立刻释放，
      // 覆盖 effect 的注册与清理路径，又不会让定时器吊住测试进程。
      effect: (fn) => {
        const disposer = fn();
        effects.push(typeof disposer);
        if (typeof disposer === 'function') disposer();
        return disposer;
      },
    },
  };
}

test('apply 提供 ideConfig 服务并把工作区映射成项目', () => {
  const { ctx, provided } = makeCtx([
    { id: 'w1', title: 'kun-ai', path: '/tmp/kun-ai', sessionIds: ['s1'], setTitle: async () => {}, attachSession: async () => {}, insertSessionBefore: async () => {}, detachSession: async () => {}, status: async () => 'ok', createdAt: '', updatedAt: '' },
    { id: 'w2', title: 'hague-config', path: '/tmp/hague-config', sessionIds: [], setTitle: async () => {}, attachSession: async () => {}, insertSessionBefore: async () => {}, detachSession: async () => {}, status: async () => 'ok', createdAt: '', updatedAt: '' },
  ]);
  mod.apply(ctx);
  const service = provided.ideConfig;
  assert.equal(typeof service.load, 'function');
  assert.equal(typeof service.submit, 'function');
  const load = service.load();
  assert.deepEqual([...load.projects], [
    { workspaceId: 'w1', title: 'kun-ai', path: '/tmp/kun-ai' },
    { workspaceId: 'w2', title: 'hague-config', path: '/tmp/hague-config' },
  ]);
  assert.deepEqual(load.config, { projects: [], activeWorkspaceId: '', showOverview: false });
  assert.equal(load.warning, '');
});

test('apply 注册了 effect 并返回可调用的清理函数', () => {
  const { ctx, effects } = makeCtx(null);
  mod.apply(ctx);
  assert.ok(effects.length >= 1, 'apply 应当至少注册一个 effect');
  assert.deepEqual([...new Set(effects)], ['function'], '每个 effect 都应返回清理函数');
});

test('typertRemote 绑定满足网关校验：service 必须是服务对象本身', () => {
  // 回归：网关 readBinding 里 `Reflect.get(value,'service') !== original` 会抛 gateway/binding-invalid，
  // 传服务名字符串会让每一次 remote.ideConfig.* 调用失败。
  const { ctx, provided } = makeCtx(null);
  mod.apply(ctx);
  const service = provided.ideConfig;
  assert.equal(service.typertRemote.service, service);
  assert.equal(service.typertRemote.serviceKey, 'ideConfig');
  assert.equal(service.typertRemote.namespace, 'ideConfig');
});

test('工作区注册表缺失时返回空项目列表而不是崩', () => {
  const { ctx, provided } = makeCtx(null);
  mod.apply(ctx);
  assert.deepEqual([...provided.ideConfig.load().projects], []);
});

test('submit 落盘后 load 能读回，文件权限 0600', async () => {
  const { ctx, provided } = makeCtx(null);
  mod.apply(ctx);
  const service = provided.ideConfig;
  const saved = await service.submit({
    projects: [{ workspaceId: 'w1', path: '/tmp/kun-ai', title: 'kun-ai', activeConfigId: 'c1', configs: [
      { id: 'c1', name: 'web', command: 'mvn spring-boot:run', cwd: '/tmp/kun-ai', envs: [{ name: 'A', value: '1' }] },
    ] }],
    activeWorkspaceId: 'w1',
    showOverview: true,
  });
  assert.equal(saved.projects[0].configs[0].name, 'web');
  assert.deepEqual(service.load().config, saved);
  assert.equal(statSync(mod.STORAGE_PATH).mode & 0o777, 0o600);
  assert.ok(mod.STORAGE_PATH.startsWith(home), '存储路径应当落在 DSH_HOME 内');
});
