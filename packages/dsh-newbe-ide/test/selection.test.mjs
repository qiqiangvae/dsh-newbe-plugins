/**
 * 选中启动配置的判定：局部选择 > 磁盘记住的 > 第一条。
 * 这条判定必须与"异步回读"解耦，否则客户端刚点的选择会被周期性重读盖回去。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { pickActiveConfig } = await import('../lib/index.js');

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
