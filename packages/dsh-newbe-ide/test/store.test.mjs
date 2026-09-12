/**
 * 存储接缝的行为测试：只走公开接口（createConfigStore / loadState / writeFileAtomic），
 * 不碰内部结构，重构实现不应让这些测试变红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 隔离 DSH home，避免测试碰到真实 ~/.dsh
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-newbe-ide-home-'));

const { createConfigStore, defaultState } = await import('../lib/index.js');

function tempFile() {
  return join(mkdtempSync(join(tmpdir(), 'dsh-newbe-ide-')), 'dsh-newbe-ide.json');
}

const sample = {
  projects: [{
    workspaceId: 'w1',
    path: '/tmp/kun-ai',
    title: 'kun-ai',
    activeConfigId: 'c1',
    hidden: false,
    configs: [{
      id: 'c1',
      name: 'web',
      command: 'mvn -o -pl kun-ai-web -am spring-boot:run',
      cwd: '/tmp/kun-ai',
      envs: [{ name: 'pingpongx.cloud.tag', value: 'QQ' }],
    }],
  }],
  activeWorkspaceId: 'w1',
  showOverview: true,
};

test('存储文件不存在时给出默认状态', () => {
  const store = createConfigStore(tempFile());
  assert.deepEqual(store.getState(), { projects: [], activeWorkspaceId: '', showOverview: false });
  assert.equal(store.warning, '');
});

test('提交后落盘、权限 0600、重新加载内容一致', async () => {
  const file = tempFile();
  const store = createConfigStore(file);
  const saved = await store.submit(sample);
  assert.deepEqual(saved, sample);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(createConfigStore(file).getState(), sample);
});

test('缺字段的提交被补齐为规范状态，未知字段被丢弃', async () => {
  const file = tempFile();
  const store = createConfigStore(file);
  const saved = await store.submit({ projects: [], 未来字段: 1 });
  assert.deepEqual(saved, { projects: [], activeWorkspaceId: '', showOverview: false });
});

test('非法提交被拒绝且不落盘', async () => {
  const file = tempFile();
  const store = createConfigStore(file);
  await store.submit(sample);
  const before = readFileSync(file, 'utf8');
  await assert.rejects(() => store.submit({ projects: [{ workspaceId: 1 }] }));
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('存储文件损坏时降级为空配置、给出告警且不覆盖原文件', () => {
  const file = tempFile();
  writeFileSync(file, '{ 这不是 JSON');
  const store = createConfigStore(file);
  assert.deepEqual(store.getState(), defaultState());
  assert.match(store.warning, /损坏/);
  assert.equal(readFileSync(file, 'utf8'), '{ 这不是 JSON');
});

test('损坏后再次提交可恢复写入', async () => {
  const file = tempFile();
  writeFileSync(file, 'null');
  const store = createConfigStore(file);
  await store.submit(sample);
  assert.deepEqual(createConfigStore(file).getState(), sample);
  assert.equal(store.warning, '');
});

test('老文件没有 hidden 字段时仍能读回（缺省视为未收起）', () => {
  const file = tempFile();
  // 模拟上一版写下的文件：project 条目里没有 hidden
  writeFileSync(file, JSON.stringify({
    projects: [{
      workspaceId: 'w1', path: '/tmp/p', title: 'p', activeConfigId: 'c1',
      configs: [{ id: 'c1', name: 'A', command: 'x', cwd: '/tmp/p', envs: [] }],
    }],
    activeWorkspaceId: 'w1',
    showOverview: false,
  }));
  const store = createConfigStore(file);
  assert.equal(store.warning, '', '不该被判为损坏');
  assert.equal(store.getState().projects.length, 1);
  assert.equal(store.getState().projects[0].hidden, false);
  assert.equal(store.getState().projects[0].configs.length, 1, '配置不能丢');
});

test('老文件没有 showOverview 字段时仍能读回（该字段已无 UI，但不能让文件作废）', () => {
  const file = tempFile();
  writeFileSync(file, JSON.stringify({
    projects: [{
      workspaceId: 'w1', path: '/tmp/p', title: 'p', activeConfigId: 'c1',
      configs: [{ id: 'c1', name: 'A', command: 'x', cwd: '/tmp/p', envs: [] }], hidden: false,
    }],
    activeWorkspaceId: 'w1',
  }));
  const store = createConfigStore(file);
  assert.equal(store.warning, '', '不该被判为损坏');
  assert.equal(store.getState().showOverview, false);
  assert.equal(store.getState().projects[0].configs.length, 1, '配置不能丢');
});
