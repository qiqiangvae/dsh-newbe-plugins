/**
 * Host 半边加载测试：用临时 DSH_HOME 真跑 apply()，验证
 * 1) 插件能加载、提供 ideConfig 服务；
 * 2) load() 把 DSH 工作区映射成面板项目，注册表缺失时不崩；
 * 3) submit() 落盘后 load() 能读回（真文件往返）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
  await service.start({ workspaceId: 'w1', configId: 'c1' });   // 启动是异步的：凭据变量要等凭据库解析
  shell.started[0].proc.emit('hello\nworld\n');
  // 用 read() 触发一次 drain：它按契约会采集（`runs()` 只读当前态、不再顺手 drain——真实宿主里
  // 采集由 250ms 的 pump 负责，客户端每秒 1.25 次调 runs() 时重复采集是白烧 CPU）。
  service.read({ workspaceId: 'w1', configId: 'c1', from: 0 });

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
  assert.deepEqual([...found.candidates[0].envs], [{ name: 'pingpongx.cloud.tag', value: 'QQ', from: 'literal' }]);

  // 从真实工程路径生成命令（不带 -am）
  const built = mod.buildLaunchConfig(found.candidates[0], root);
  assert.equal(built.command, 'mvn -o -pl kun-ai-web spring-boot:run -Dspring-boot.run.main-class=com.pingpongx.kun.ai.web.KunAiApplication');
});

test('discover 对不在面板里的项目给出可读错误', () => {
  const { ctx, provided } = makeCtx(null, makeShell());
  mod.apply(ctx);
  assert.throws(() => provided.ideConfig.discover({ workspaceId: '不存在' }), /不在面板配置里/);
});

test('一个配置文件都没扫到时给出可读原因', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-newbe-ide-empty-'));
  const { ctx, provided } = makeCtx(null, makeShell());
  mod.apply(ctx);
  await provided.ideConfig.submit({
    projects: [{ workspaceId: 'w1', path: root, title: 'p', activeConfigId: '', configs: [], hidden: false }],
    activeWorkspaceId: 'w1',
    showOverview: false,
  });
  const found = provided.ideConfig.discover({ workspaceId: 'w1' });
  assert.deepEqual([...found.scanned], []);
  assert.equal(found.errors.length, 1);
  assert.match(found.errors[0], /没找到/);
});

/**
 * 假 ctx：额外提供 tools / skills / credentials。
 * `effect` 只释放「run pump」那个定时器（不释放的话 250ms 的 interval 会把测试进程吊住），
 * 工具与 skill 的注册保留下来，好在断言里看。
 */
function makeHostCtx(options = {}) {
  const shell = options.shell ?? makeShell();
  const registeredTools = [];
  const registeredSkills = [];
  const provided = {};
  const listeners = new Map();
  // 哪些服务"已经挂载"。`defer: true` 模拟服务比插件行晚挂载那种顺序。
  const live = new Set();
  if (options.tools !== false && options.defer !== true) live.add('tools');
  if (options.skills !== false && options.defer !== true) live.add('skills');
  if (options.credentials !== undefined) live.add('credentials');
  const ctx = {
    get(name) {
      if (name === 'shell') return shell;
      if (name === 'workspaceRegistry') return { list: () => options.workspaces ?? [] };
      if (!live.has(name)) return undefined;
      if (name === 'tools') return { register: (tool) => { registeredTools.push(tool); return () => {}; } };
      if (name === 'skills') return { register: (skill) => { registeredSkills.push(skill); return () => {}; } };
      if (name === 'credentials') return options.credentials;
      return undefined;
    },
    provide: (key, value) => { provided[key] = value; },
    on(name, handler) {
      const list = listeners.get(name) ?? [];
      list.push(handler);
      listeners.set(name, list);
      return () => {};
    },
    effect(fn, label) {
      const disposer = fn();
      if (String(label ?? '').includes('run pump') && typeof disposer === 'function') disposer();
      return disposer;
    },
  };
  /** 模拟一个服务此刻挂载（cordis 会发 internal/service）。 */
  const emitService = (name, value) => {
    live.add(name);
    for (const handler of listeners.get('internal/service') ?? []) handler(name, value);
  };
  return { ctx, provided, registeredTools, registeredSkills, shell, emitService };
}

test('服务比插件行晚挂载时补上注册：只 get 一次会静默漏掉工具', () => {
  const { ctx, registeredTools, registeredSkills, emitService } = makeHostCtx({ defer: true });
  mod.apply(ctx);
  assert.equal(registeredTools.length, 0, '服务还没出现时不该硬注册');
  assert.equal(registeredSkills.length, 0);

  emitService('tools', { register: (tool) => { registeredTools.push(tool); return () => {}; } });
  emitService('skills', { register: (skill) => { registeredSkills.push(skill); return () => {}; } });
  assert.deepEqual(registeredTools.map((tool) => tool.name), ['ide_launch_list', 'ide_launch_save', 'ide_launch_run']);
  assert.equal(registeredSkills.length, 1);
  assert.equal(registeredSkills[0].name, 'ide-launch-config');
});

test('装完即用：apply 就注册好内置工具与 skill，不需要改 preset', () => {
  const { ctx, provided, registeredTools, registeredSkills } = makeHostCtx();
  mod.apply(ctx);
  assert.deepEqual(registeredTools.map((tool) => tool.name), ['ide_launch_list', 'ide_launch_save', 'ide_launch_run']);
  assert.equal(registeredSkills.length, 1);
  assert.equal(registeredSkills[0].name, 'ide-launch-config');
  assert.equal(registeredSkills[0].source, 'runtime');
  assert.equal(typeof registeredSkills[0].content, 'string');
  assert.equal(typeof provided.ideConfig.secretInfo, 'function');
  assert.equal(typeof provided.ideConfig.secretSet, 'function');

  // tools / skills 服务缺席时不该崩（老版本宿主、别的装配方式）
  const bare = makeHostCtx({ tools: false, skills: false });
  mod.apply(bare.ctx);
  assert.equal(bare.registeredTools.length, 0);
  assert.equal(typeof bare.provided.ideConfig.load, 'function', '面板那条路不受影响');
});

test('agent 写一条配置：面板立刻看得到，密钥值一个字节都不落盘', async () => {
  const SECRET = 'sk-live-do-not-leak-0123456789';
  const { ctx, provided, registeredTools } = makeHostCtx();
  mod.apply(ctx);
  const save = registeredTools.find((tool) => tool.name === 'ide_launch_save');

  const result = await save.execute({
    path: '/tmp/agent-made',
    name: 'KunAiApplication',
    command: 'mvn -o -pl kun-ai-web spring-boot:run',
    envs: [{ name: 'HARNESS_LLM_API_KEY', value: SECRET }, { name: 'pingpongx.job.tag', value: 'dev' }],
  });
  assert.equal(result.action, 'created');
  assert.deepEqual(result.envs, { total: 2, credential: ['HARNESS_LLM_API_KEY'] });

  // 面板读得到（客户端每 3 次轮询重读一次，不需要任何新管道）
  // 这个文件里的测试共用一个 DSH_HOME（同一个存储文件），所以按路径找自己那条
  const loaded = provided.ideConfig.load();
  const config = loaded.config.projects.find((p) => p.path === '/tmp/agent-made').configs[0];
  assert.equal(config.name, 'KunAiApplication');
  assert.equal(config.origin, 'agent', '面板据此打「agent 写入」标记');
  assert.deepEqual(config.envs[0], { name: 'HARNESS_LLM_API_KEY', value: '', from: 'credential' });

  // 磁盘上也不能有值
  const onDisk = readFileSync(join(home, 'storages', 'dsh-newbe-ide.json'), 'utf8');
  assert.equal(onDisk.includes(SECRET), false, '密钥值落盘了');
});

test('凭据变量：启动时按变量名去凭据库取值注入 env；取不到就点名报错', async () => {
  // 假的凭据库：像真的那样"先存在、写进去才解析得到"
  const vault = new Map([['X_API_KEY', 'live-secret']]);
  const credentials = {
    resolve: async (ref) => (vault.has(ref) ? { value: vault.get(ref), source: 'file' } : undefined),
    describe: async (ref) => ({ configured: vault.has(ref), writable: true, source: vault.has(ref) ? 'file' : '' }),
    set: async (ref, value) => { vault.set(ref, value); },
  };
  const { ctx, provided, shell } = makeHostCtx({ credentials });
  mod.apply(ctx);
  await provided.ideConfig.submit({
    projects: [{
      workspaceId: 'w1', path: '/tmp/p', title: 'p', activeConfigId: 'c1', hidden: false,
      configs: [{
        id: 'c1', name: 'A', command: 'echo hi', cwd: '/tmp/p', origin: 'human',
        envs: [
          { name: 'X_API_KEY', value: '', from: 'credential' },
          { name: 'PLAIN', value: 'p', from: 'literal' },
          { name: 'MISSING_TOKEN', value: '', from: 'credential' },
        ],
      }],
    }],
    activeWorkspaceId: 'w1',
    showOverview: false,
  });

  await assert.rejects(() => provided.ideConfig.start({ workspaceId: 'w1', configId: 'c1' }), /凭据库里没有 MISSING_TOKEN/);
  assert.equal(shell.started.length, 0, '解析不到凭据时一个进程都不能起——空值悄悄跑起来最难查');

  // 把缺的那个补上（面板走 secretSet 写进凭据库），再启动
  await provided.ideConfig.secretSet({ name: 'MISSING_TOKEN', value: 'another-secret' });
  await provided.ideConfig.start({ workspaceId: 'w1', configId: 'c1' });
  assert.equal(shell.started.length, 1);
  assert.equal(shell.started[0].spec.env.X_API_KEY, 'live-secret');
  assert.equal(shell.started[0].spec.env.PLAIN, 'p');
});

test('secretInfo / secretSet：只回状态，值永远不回传', async () => {
  const written = [];
  const credentials = {
    resolve: async () => undefined,
    describe: async (ref) => ({ configured: true, writable: true, source: 'file' }),
    set: async (ref, value) => { written.push([ref, value, value.length]); },
  };
  const { ctx, provided } = makeHostCtx({ credentials });
  mod.apply(ctx);

  const info = await provided.ideConfig.secretInfo({ names: ['X_API_KEY'] });
  assert.deepEqual(info, [{ name: 'X_API_KEY', configured: true, writable: true, source: 'file' }]);
  assert.equal(JSON.stringify(info).includes('secret'), false);

  const status = await provided.ideConfig.secretSet({ name: 'X_API_KEY', value: 'v3ry-s3cret' });
  assert.equal(written.length, 1);
  assert.equal(JSON.stringify(status).includes('v3ry-s3cret'), false, '值不能顺着状态回传');

  // 凭据服务缺席时：状态是"未配置"，写值直接报错（不静默降级成明文存起来）
  const bare = makeHostCtx();
  mod.apply(bare.ctx);
  assert.deepEqual(await bare.provided.ideConfig.secretInfo({ names: ['X_API_KEY'] }), [{ name: 'X_API_KEY', configured: false, writable: false, source: '' }]);
  await assert.rejects(() => bare.provided.ideConfig.secretSet({ name: 'X_API_KEY', value: 'x' }), /凭据服务不可用/);
});

test('删掉启动配置时，它在磁盘上的日志一起消失（不留孤儿）', async () => {
  const shell = makeShell();
  const { ctx, provided } = makeCtx(null, shell);
  mod.apply(ctx);
  await provided.ideConfig.submit({
    projects: [{
      workspaceId: 'w-gone', path: '/tmp/p', title: 'p', activeConfigId: 'c1', hidden: false,
      configs: [{ id: 'c1', name: 'A', command: 'echo hi', cwd: '/tmp/p', envs: [], origin: 'human' }],
    }],
    activeWorkspaceId: 'w-gone',
    showOverview: false,
  });
  await provided.ideConfig.start({ workspaceId: 'w-gone', configId: 'c1' });
  shell.started[shell.started.length - 1].proc.emit('hello\n');
  // read() 触发一次采集：走磁盘的那条路（history 读的是落盘文件）
  provided.ideConfig.read({ workspaceId: 'w-gone', configId: 'c1', from: 0 });
  const history = provided.ideConfig.history({ workspaceId: 'w-gone', configId: 'c1', tail: 10 });
  assert.deepEqual([...history.lines], ['hello']);
  assert.equal(existsSync(history.path), true);

  // 把这条配置从状态里删掉：日志必须跟着走——键已不在状态里，留着就是谁也够不着的孤儿
  await provided.ideConfig.submit({ projects: [], activeWorkspaceId: '', showOverview: false });
  assert.equal(existsSync(history.path), false, '删了配置还留着日志文件');
});
