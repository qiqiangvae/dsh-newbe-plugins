/**
 * 选中启动配置的判定：局部选择 > 磁盘记住的 > 第一条。
 * 这条判定必须与"异步回读"解耦，否则客户端刚点的选择会被周期性重读盖回去。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { pickActiveConfig, basenameOf, uniqueTitle, availableWorkspaces } = await import('../lib/index.js');

const project = {
  workspaceId: 'w1', path: '/tmp/p', title: 'p', activeConfigId: 'b',
  configs: [
    { id: 'a', name: 'A', command: '', cwd: '/tmp/p', envs: [] },
    { id: 'b', name: 'B', command: '', cwd: '/tmp/p', envs: [] },
  ],
};

test('局部选择优先于磁盘记住的', () => {
  assert.equal(pickActiveConfig(project, 'a').id, 'a');
});

test('没有局部选择时用磁盘记住的', () => {
  assert.equal(pickActiveConfig(project, '').id, 'b');
});

test('局部选择指向已删除的配置时回退', () => {
  assert.equal(pickActiveConfig(project, 'gone').id, 'b');
});

test('磁盘值也失效时退回第一条', () => {
  const broken = { ...project, activeConfigId: 'gone' };
  assert.equal(pickActiveConfig(broken, '').id, 'a');
});

test('没有任何配置时返回 undefined', () => {
  assert.equal(pickActiveConfig({ ...project, configs: [], activeConfigId: '' }, 'a'), undefined);
});

test('路径末段：任意路径建项目配置时的默认标题', () => {
  assert.equal(basenameOf('/Users/qiqiang/Code/zagent'), 'zagent');
  assert.equal(basenameOf('/Users/qiqiang/Code/zagent/'), 'zagent');
  assert.equal(basenameOf('~/work/x/'), 'x');
  assert.equal(basenameOf('/'), '/');
});

test('同名标题自动让路：同一路径可以有多条项目配置', () => {
  assert.equal(uniqueTitle('kun-ai', []), 'kun-ai');
  assert.equal(uniqueTitle('kun-ai', ['kun-ai']), 'kun-ai (2)');
  assert.equal(uniqueTitle('kun-ai', ['kun-ai', 'kun-ai (2)']), 'kun-ai (3)');
  assert.equal(uniqueTitle('kun-ai', ['other']), 'kun-ai');
});

test('新增卡片的工作区列表：按路径排除已有项目配置，并在列表内按路径去重', () => {
  const reg = [
    { workspaceId: 'w-zagent', title: 'zagent', path: '/code/zagent' },
    { workspaceId: 'w-home', title: 'Home', path: '/home/me' },
    { workspaceId: 'w-home-dup', title: 'Home（重复登记）', path: '/home/me' },
    { workspaceId: 'w-other', title: 'other', path: '/code/other' },
  ];
  // 'w-zagent' 的 id 与已有条目**不一致**（条目存的是它自己的 id），但路径相同 ⇒ 必须按路径排除
  const got = availableWorkspaces(reg, ['/code/zagent', '/elsewhere']);
  assert.deepEqual(got.map((x) => x.title), ['Home', 'other']);
  assert.deepEqual(availableWorkspaces(reg, []).map((x) => x.title), ['zagent', 'Home', 'other']);
  assert.deepEqual(availableWorkspaces([], ['/x']), []);
  // 注册表里的路径都已有项目配置 → 列表空（卡片会改说"都已有项目配置"）
  assert.deepEqual(availableWorkspaces(reg, ['/code/zagent', '/home/me', '/code/other']), []);
});
