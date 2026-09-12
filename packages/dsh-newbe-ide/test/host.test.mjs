/**
 * Host 半边加载测试：用临时 DSH_HOME 真跑 apply()，验证
 * 1) 插件能加载、提供 ideConfig 服务；
 * 2) load() 把 DSH 工作区映射成面板项目，注册表缺失时不崩；
 * 3) submit() 落盘后 load() 能读回（真文件往返）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-newbe-ide-host-'));
process.env.DSH_HOME = home;

const mod = await import('../lib/index.js');

function makeShell() {
  const started = [];
  return {
    started,
    resolve: (request) => request,
    start(spec) {
      let delta = '';
      const proc = {
        status: 'running',
        exitCode: null,
        done: new Promise(() => {}),
        readOutput() { const d = delta; delta = ''; return { delta: d, lossy: false }; },
        kill() { return true; },
        emit(text) { delta += text; },
      };
      started.push({ spec, proc });
      return proc;
    },
  };
}

function makeCtx(workspaces, shell) {
  const provided = {};
  const effects = [];
  return {
    provided,
    effects,
    ctx: {
      get: (name) => (name === 'workspaceRegistry' && workspaces !== null
        ? { list: () => workspaces }
        : name === 'shell' ? shell : undefined),
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

test('history 读回落盘的日志：进程输出 → 落盘 → 重启后再看', async () => {
  const shell = makeShell();
  const { ctx, provided } = makeCtx(null, shell);
  mod.apply(ctx);
  const service = provided.ideConfig;
  await service.submit({
    projects: [{
      workspaceId: 'w1', path: '/tmp/p', title: 'p', activeConfigId: 'c1',
      configs: [{ id: 'c1', name: 'A', command: 'echo hi', cwd: '/tmp/p', envs: [] }],
    }],
    activeWorkspaceId: 'w1',
    showOverview: false,
  });
  service.start({ workspaceId: 'w1', configId: 'c1' });
  shell.started[0].proc.emit('hello\nworld\n');
  service.runs(); // 一次 drain：入内存缓冲并落盘

  const history = service.history({ workspaceId: 'w1', configId: 'c1', tail: 100 });
  assert.deepEqual([...history.lines], ['hello', 'world']);
  assert.ok(history.path.endsWith('.log'));
  assert.ok(history.path.startsWith(home), '日志应落在 DSH_HOME 内：' + history.path);
  assert.ok(history.path.includes('dsh-newbe-ide'), '日志应落在插件自己的目录下');

  // 新建一份注册表（模拟 DSH 重启：内存缓冲没了）仍能读回同一份历史
  const fresh = mod.createFileLogSink(join(home, 'storages', 'dsh-newbe-ide', 'logs'));
  assert.deepEqual([...fresh.tail('w1/c1', 100).lines], ['hello', 'world']);
});

test('discover 扫 .idea/workspace.xml 与 .run/*.xml，只留 Spring Boot 配置', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-newbe-ide-proj-'));
  mkdirSync(join(root, '.idea'), { recursive: true });
  mkdirSync(join(root, '.run'), { recursive: true });
  writeFileSync(join(root, '.idea', 'workspace.xml'), `
<project version="4"><component name="RunManager">
  <configuration name="KunAiApplication" type="SpringBootApplicationConfigurationType" factoryName="Spring Boot">
    <envs><env name="pingpongx.cloud.tag" value="QQ" /></envs>
    <module name="kun-ai-web" />
    <option name="SPRING_BOOT_MAIN_CLASS" value="com.pingpongx.kun.ai.web.KunAiApplication" />
  </configuration>
  <configuration name="SomeTest" type="JUnit" factoryName="JUnit"><module name="kun-ai-web" /></configuration>
</component></project>`);
  writeFileSync(join(root, '.run', 'Worker.xml'), `
<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="worker" type="SpringBootApplicationConfigurationType" factoryName="Spring Boot">
    <module name="kun-ai-worker" />
    <option name="SPRING_BOOT_MAIN_CLASS" value="com.pingpongx.kun.ai.worker.WorkerApplication" />
  </configuration>
</component>`);

  const { ctx, provided } = makeCtx(null, makeShell());
  mod.apply(ctx);
  await provided.ideConfig.submit({
    projects: [{ workspaceId: 'w1', path: root, title: 'p', activeConfigId: '', configs: [] }],
    activeWorkspaceId: 'w1',
    showOverview: false,
  });

  const found = provided.ideConfig.discover({ workspaceId: 'w1' });
  assert.equal(found.scanned.length, 2, '两个文件都要扫到：' + found.scanned.join(','));
  assert.deepEqual([...found.candidates].map((c) => c.name), ['KunAiApplication', 'worker']);
  assert.ok(found.candidates.every((c) => c.source.startsWith(root)));
  assert.deepEqual([...found.errors], []);
  assert.deepEqual([...found.candidates[0].envs], [{ name: 'pingpongx.cloud.tag', value: 'QQ' }]);

  // 从真实工程路径生成命令（不带 -am）
  const built = mod.buildLaunchConfig(found.candidates[0], root);
  assert.equal(built.command, 'mvn -pl kun-ai-web spring-boot:run -Dspring-boot.run.main-class=com.pingpongx.kun.ai.web.KunAiApplication');
});

test('discover 对不在面板里的项目给出可读错误', () => {
  const { ctx, provided } = makeCtx(null, makeShell());
  mod.apply(ctx);
  assert.throws(() => provided.ideConfig.discover({ workspaceId: '不存在' }), /不在面板配置里/);
});
