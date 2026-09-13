/**
 * 内置工具与 skill 的行为测试：只走公开接口（planSave / toolView / vanishedTargets / awaitVerdict /
 * createIdeTools / IDE_SKILL），不碰内部结构。
 *
 * 这里守的是本票最重要的三条边界：密钥值一个字节都不落盘、同名幂等、列表不泄露值。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 隔离 DSH home：lib/index.js 在导入时就会解析存储路径
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-newbe-ide-home-'));

const { IDE_SKILL, awaitVerdict, createIdeTools, planSave, resolveTarget, toolView, vanishedTargets, defaultState } =
  await import('../lib/index.js');

const SECRET = 'sk-live-do-not-leak-0123456789';
/** 盘上那条配置的命令：与下面 baseRequest 必须一致，否则"同名幂等"那几条测的就不是幂等了 */
const COMMAND = 'mvn -o -pl kun-ai-web spring-boot:run -Dspring-boot.run.main-class=com.x.KunAiApplication';

function empty() {
  return defaultState();
}

function withProject() {
  return {
    projects: [{
      workspaceId: 'p1',
      path: '/tmp/kun-ai',
      title: 'kun-ai',
      activeConfigId: 'c1',
      hidden: false,
      configs: [{
        id: 'c1', name: 'KunAiApplication',
        command: COMMAND,
        cwd: '/tmp/kun-ai',
        envs: [
          { name: 'HARNESS_LLM_API_KEY', value: '', from: 'credential' },
          { name: 'pingpongx.job.tag', value: 'dev', from: 'literal' },
        ],
        origin: 'human',
      }],
    }],
    activeWorkspaceId: 'p1',
    showOverview: false,
  };
}

const baseRequest = {
  path: '/tmp/kun-ai',
  name: 'KunAiApplication',
  command: COMMAND,
};

test('密钥命名的变量：值被丢掉，只登记变量名', () => {
  const plan = planSave(empty(), {
    ...baseRequest,
    path: '/tmp/new-proj',
    envs: [
      { name: 'HARNESS_LLM_API_KEY', value: SECRET },
      { name: 'NACOS_SERVER_ADDRESSES', value: '127.0.0.1:8848' },
      { name: 'DB_PASSWORD', value: SECRET },
    ],
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.result.action, 'created');
  const config = plan.next.projects[0].configs[0];
  const secret = config.envs.find((env) => env.name === 'HARNESS_LLM_API_KEY');
  assert.equal(secret.from, 'credential');
  assert.equal(secret.value, '', '值必须一个字节都不留在配置里');
  assert.equal(config.envs.find((env) => env.name === 'DB_PASSWORD').value, '');
  // 明文变量照旧
  assert.equal(config.envs.find((env) => env.name === 'NACOS_SERVER_ADDRESSES').value, '127.0.0.1:8848');
  // 回执里也不能出现值
  assert.equal(JSON.stringify(plan.result).includes(SECRET), false, '回执泄露了密钥');
  assert.deepEqual(plan.result.envs, { total: 3, credential: ['HARNESS_LLM_API_KEY', 'DB_PASSWORD'] });
});

test('新建项目配置：路径末段当标题，同一个路径第二次不再新建项目', () => {
  const first = planSave(empty(), { ...baseRequest, path: '/tmp/new-proj/' });
  assert.equal(first.next.projects.length, 1);
  assert.equal(first.next.projects[0].title, 'new-proj', '尾斜杠要去掉，标题取末段');
  assert.equal(first.next.projects[0].path, '/tmp/new-proj');

  const second = planSave(first.next, { ...baseRequest, path: '/tmp/new-proj', name: '另一条', command: 'npm run dev' });
  assert.equal(second.next.projects.length, 1, '同一路径不该出现第二条项目配置');
  assert.equal(second.next.projects[0].configs.length, 2);
});

test('同名幂等：内容一致是 no-op（连状态对象都不换），不一致才更新并列出改了什么', () => {
  const state = withProject();
  const same = planSave(state, baseRequest);
  assert.equal(same.result.action, 'noop');
  assert.equal(same.next, state, 'no-op 不该造新状态');

  const changed = planSave(state, { ...baseRequest, command: 'npm run dev' });
  assert.equal(changed.result.action, 'updated');
  assert.deepEqual(changed.result.changed, ['command']);
  assert.equal(changed.next.projects[0].configs[0].command, 'npm run dev');
  assert.equal(changed.next.projects[0].configs[0].origin, 'agent', 'agent 改过的要标出来');
});

test('no-op 不认领别人的配置：origin 保持原样', () => {
  const state = withProject();
  const same = planSave(state, baseRequest);
  assert.equal(same.result.action, 'noop');
  assert.equal(state.projects[0].configs[0].origin, 'human');
});

test('变量：省略 = 保持原样，空数组 = 清空，省略 value = 保留原值', () => {
  const state = withProject();
  const kept = planSave(state, baseRequest);
  assert.equal(kept.result.action, 'noop', '省略 envs 应当原样保留');

  const renamed = planSave(state, { ...baseRequest, envs: [{ name: 'pingpongx.job.tag' }] });
  assert.equal(renamed.result.action, 'updated');
  assert.deepEqual(renamed.next.projects[0].configs[0].envs, [{ name: 'pingpongx.job.tag', value: 'dev', from: 'literal' }], '省略 value 要保留原值');

  const cleared = planSave(state, { ...baseRequest, envs: [] });
  assert.equal(cleared.next.projects[0].configs[0].envs.length, 0);
});

test('删除：整条配置连同进程一起消失，被记住的选中项落到剩下的第一条', () => {
  const state = withProject();
  state.projects[0].configs.push({ id: 'c2', name: '第二条', command: 'x', cwd: '/tmp/kun-ai', envs: [], origin: 'human' });
  const plan = planSave(state, { path: '/tmp/kun-ai', name: 'KunAiApplication', remove: true });
  assert.equal(plan.result.action, 'removed');
  assert.deepEqual(plan.next.projects[0].configs.map((c) => c.name), ['第二条']);
  assert.equal(plan.next.projects[0].activeConfigId, 'c2');
  assert.deepEqual(vanishedTargets(state, plan.next), [{ workspaceId: 'p1', configId: 'c1' }]);
});

test('参数不合格时给结构化错误，不抛栈', () => {
  const cases = [
    [{ ...baseRequest, path: 'kun-ai' }, 'path 必须是绝对路径'],
    [{ ...baseRequest, path: '  ' }, 'path 不能为空'],
    [{ ...baseRequest, name: ' ' }, 'name 不能为空'],
    [{ ...baseRequest, command: '' }, 'command 不能为空'],
    [{ path: '/tmp/nope', name: 'x', remove: true }, '没有叫 x 的启动配置'],
  ];
  for (const [request, expected] of cases) {
    const plan = planSave(empty(), request);
    assert.equal(plan.ok, false, JSON.stringify(request));
    assert.equal(plan.result.ok, false);
    assert.match(plan.result.error, new RegExp(expected));
  }
});

test('resolveTarget：按路径 + 名字定位，找不到时说的是人话', () => {
  const state = withProject();
  assert.deepEqual(resolveTarget(state, '/tmp/kun-ai/', 'KunAiApplication'), { ok: true, target: { workspaceId: 'p1', configId: 'c1' } });
  assert.equal(resolveTarget(state, '/tmp/other', 'x').ok, false);
  assert.match(resolveTarget(state, '/tmp/kun-ai', '不存在').error, /没有叫 不存在/);
});

test('toolView 只给名字与来源——变量值一个都不出现', () => {
  const state = withProject();
  state.projects[0].configs[0].envs[1].value = SECRET;
  const view = toolView(state, [{
    key: 'p1/c1', status: 'running', exitCode: null, error: '', lossy: false,
    startedAtMs: 0, port: '8080', lastLine: 'started',
  }]);
  assert.equal(JSON.stringify(view).includes(SECRET), false, '列表泄露了变量值');
  assert.deepEqual(view[0].configs[0].envs, [
    { name: 'HARNESS_LLM_API_KEY', from: 'credential' },
    { name: 'pingpongx.job.tag', from: 'literal' },
  ]);
  assert.equal(view[0].configs[0].status, 'running');
  assert.equal(view[0].configs[0].port, '8080');
});

test('awaitVerdict：认出端口 = 起来了，进程结束 = 失败，超时 = 还在启动', async () => {
  const noSleep = async () => {};
  const snapshot = (over) => ({
    key: 'k', status: 'running', exitCode: null, error: '', lossy: false,
    startedAtMs: 0, port: '', lastLine: '', ...over,
  });

  const up = await awaitVerdict(snapshot({}), () => snapshot({ port: '8080' }), { sleep: noSleep, intervalMs: 0 });
  assert.equal(up.settled, 'port');

  const dead = await awaitVerdict(snapshot({}), () => snapshot({ status: 'exited', exitCode: 1 }), { sleep: noSleep, intervalMs: 0 });
  assert.equal(dead.settled, 'exited');

  let clock = 0;
  const slow = await awaitVerdict(snapshot({}), () => snapshot({}), {
    sleep: noSleep, intervalMs: 0, timeoutMs: 5, now: () => (clock += 3),
  });
  assert.equal(slow.settled, 'timeout', '一直没端口也不能永远等下去');
});

test('工具：注册形状齐备，参数是 JSON Schema（本包拿不到 dsh-tools 的类型，校验得自己写）', () => {
  const tools = createIdeTools({ state: empty, runs: () => [], apply: async (next) => next, start: async () => { throw new Error('x'); }, stop: async () => { throw new Error('x'); }, tail: () => [] });
  assert.deepEqual(tools.map((tool) => tool.name), ['ide_launch_list', 'ide_launch_save', 'ide_launch_run']);
  for (const tool of tools) {
    assert.equal(typeof tool.description, 'string');
    assert.ok(tool.description.length > 40, `${tool.name} 的描述太短，模型不知道该什么时候用它`);
    assert.equal(tool.parameters.type, 'object');
    assert.equal(typeof tool.output.render, 'function');
    assert.equal(typeof tool.output.schema, 'object');
    assert.equal(typeof tool.execute, 'function');
  }
  const listRender = tools[0].output.render({}, { projects: [] });
  assert.equal(listRender[0].type, 'text');
});

test('ide_launch_save：经宿主的 apply 落盘，并先停掉消失的进程', async () => {
  let state = withProject();
  const applied = [];
  const stopped = [];
  const tools = createIdeTools({
    state: () => state,
    runs: () => [],
    apply: async (next) => { applied.push(next); state = next; return next; },
    start: async () => { throw new Error('用不到'); },
    stop: async (target) => { stopped.push(target); return { key: 'x' }; },
    tail: () => [],
  });
  const save = tools.find((tool) => tool.name === 'ide_launch_save');

  const created = await save.execute({ ...baseRequest, path: '/tmp/kun-ai', name: '第二条', envs: [{ name: 'X_API_KEY', value: SECRET }] });
  assert.equal(created.action, 'created');
  assert.equal(applied.length, 1);
  assert.equal(JSON.stringify(applied[0]).includes(SECRET), false, '落盘的状态里出现了密钥值');

  // 再写一次同样的内容 → no-op，不落盘
  const again = await save.execute({ ...baseRequest, path: '/tmp/kun-ai', name: '第二条', envs: [{ name: 'X_API_KEY', value: SECRET }] });
  assert.equal(again.action, 'noop');
  assert.equal(applied.length, 1, 'no-op 不该写盘');

  // 删除 → 先停进程再落盘
  const removed = await save.execute({ path: '/tmp/kun-ai', name: '第二条', remove: true });
  assert.equal(removed.action, 'removed');
  assert.equal(stopped.length, 1, '删配置必须先把它的进程停掉');
  assert.equal(applied.length, 2);

  // 参数不合格 → 结构化回执，且不落盘
  const bad = await save.execute({ path: 'relative', name: 'x', command: 'y' });
  assert.equal(bad.ok, false);
  assert.equal(applied.length, 2);
});

test('ide_launch_run：起来了回端口，失败回最后几行错误，日志平时不进回执', async () => {
  const snapshot = (over) => ({
    key: 'p1/c1', status: 'running', exitCode: null, error: '', lossy: false,
    startedAtMs: 0, port: '', lastLine: '', ...over,
  });
  const deps = (first, later) => ({
    state: withProject,
    runs: () => [later ?? first],
    apply: async (next) => next,
    start: async () => first,
    stop: async () => snapshot({ status: 'stopped' }),
    tail: () => ['Caused by: 端口被占用'],
  });
  const run = (d) => createIdeTools(d).find((tool) => tool.name === 'ide_launch_run');

  const up = await run(deps(snapshot({}), snapshot({ port: '8080' }))).execute({ path: '/tmp/kun-ai', name: 'KunAiApplication', action: 'start' });
  assert.equal(up.ok, true);
  assert.equal(up.port, '8080');
  assert.deepEqual(up.errorTail, [], '成功时不带日志');

  const text = run(deps(snapshot({}), snapshot({ port: '8080' }))).output.render({ action: 'start', path: '/tmp/kun-ai', name: 'KunAiApplication' }, up);
  assert.match(text[0].text, /起来了/);

  const dead = await run(deps(snapshot({}), snapshot({ status: 'exited', exitCode: 1 }))).execute({ path: '/tmp/kun-ai', name: 'KunAiApplication', action: 'start' });
  assert.equal(dead.ok, true);
  assert.equal(dead.settled, 'exited');
  assert.deepEqual(dead.errorTail, ['Caused by: 端口被占用'], '失败时必须把错误尾巴带回来');

  const unknown = await run(deps(snapshot({}), snapshot({ port: '8080' }))).execute({ path: '/tmp/kun-ai', name: '不存在', action: 'start' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /没有叫 不存在/);

  const wrongAction = await run(deps(snapshot({}), snapshot({ port: '8080' }))).execute({ path: '/tmp/kun-ai', name: 'KunAiApplication', action: '重启' });
  assert.equal(wrongAction.ok, false);
});

test('内置 skill：名字合规、来源是 runtime、正文写着那几条硬边界', () => {
  assert.match(IDE_SKILL.name, /^[a-z][a-z0-9-]*$/);
  assert.equal(IDE_SKILL.source, 'runtime');
  assert.deepEqual(IDE_SKILL.invocation, { modelInvocable: true, userInvocable: true });
  assert.ok(IDE_SKILL.description.length > 30);
  assert.match(IDE_SKILL.content, /不要加 `-am`/, 'Maven 那个坑必须写进去');
  assert.match(IDE_SKILL.content, /不要直接编辑/);
  assert.match(IDE_SKILL.content, /dsh-newbe-ide\.json/);
  assert.match(IDE_SKILL.content, /ide_launch_save/);
  assert.match(IDE_SKILL.content, /ide_launch_run/);
});

/**
 * 复刻 DSH `assertSupportedJsonSchema` 的子集规则（`dsh-tools/lib/index.js` 的 checkSchemaNode）。
 *
 * 为什么值得复刻：`register` 会对 `output.schema` 跑这套校验，**不通过就是 `dsh web` 启动 fatal**。
 * 实测踩过：把 `defineTool` 的规格 DSL（逐属性 `required: true`）当 JSON Schema 交上去，
 * 重启直接失败、整个 web 起不来。那是只在重启时才暴露的错，所以在这里按住。
 */
const SUPPORTED_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const SUPPORTED_KEYS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title',
]);
/** 关键字只允许出现在哪种类型上（DSH 的报错就是 "x is not supported on type y"）。 */
const KEYWORD_OWNER = { properties: 'object', required: 'object', additionalProperties: 'object', items: 'array' };

function checkSchemaSubset(node, path, problems) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    problems.push(`${path} 必须是 schema 对象`);
    return;
  }
  for (const key of Object.keys(node)) {
    if (!SUPPORTED_KEYS.has(key)) problems.push(`${path}.${key} 不是受支持的关键字`);
  }
  const hasType = Object.hasOwn(node, 'type');
  const hasOneOf = Object.hasOwn(node, 'oneOf');
  if (hasType && hasOneOf) {
    problems.push(`${path} 不能同时声明 type 与 oneOf`);
    return;
  }
  if (hasOneOf) {
    for (const sibling of Object.keys(KEYWORD_OWNER)) {
      if (Object.hasOwn(node, sibling)) problems.push(`${path}.${sibling} 不能与 oneOf 并列`);
    }
    if (!Array.isArray(node.oneOf) || node.oneOf.length < 2) problems.push(`${path}.oneOf 至少要有两个 schema`);
    else node.oneOf.forEach((sub, index) => checkSchemaSubset(sub, `${path}.oneOf[${index}]`, problems));
    return;
  }
  if (!hasType) return;
  if (typeof node.type !== 'string' || !SUPPORTED_TYPES.has(node.type)) {
    problems.push(Array.isArray(node.type) ? `${path}.type 不能是数组（可空用 oneOf）` : `${path}.type 必须是受支持的单个类型`);
    return;
  }
  for (const [key, owner] of Object.entries(KEYWORD_OWNER)) {
    if (Object.hasOwn(node, key) && node.type !== owner) problems.push(`${path}.${key} 不支持类型 ${node.type}`);
  }
  if (node.type === 'object') {
    if (Object.hasOwn(node, 'properties')) {
      if (node.properties === null || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
        problems.push(`${path}.properties 必须是对象`);
      } else {
        for (const [name, sub] of Object.entries(node.properties)) checkSchemaSubset(sub, `${path}.properties.${name}`, problems);
      }
    }
    if (Object.hasOwn(node, 'required')) {
      if (!Array.isArray(node.required) || node.required.some((entry) => typeof entry !== 'string')) {
        problems.push(`${path}.required 必须是字符串数组——逐属性 required: true 是 defineTool 的规格 DSL，裸注册会被拒`);
      } else {
        for (const key of node.required) {
          if (!Object.hasOwn(node.properties ?? {}, key)) problems.push(`${path}.required 里的 ${key} 不在 properties 里`);
        }
      }
    }
    if (Object.hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
      problems.push(`${path}.additionalProperties 必须是布尔`);
    }
  }
  if (node.type === 'array' && Object.hasOwn(node, 'items')) checkSchemaSubset(node.items, `${path}.items`, problems);
}

test('工具 schema 走的是 DSH 支持的 JSON Schema 子集（不合格 = dsh web 启动 fatal）', () => {
  const tools = createIdeTools({
    state: empty, runs: () => [], apply: async (next) => next,
    start: async () => { throw new Error('用不到'); }, stop: async () => { throw new Error('用不到'); }, tail: () => [],
  });
  for (const tool of tools) {
    for (const [what, schema] of [['parameters', tool.parameters], ['output.schema', tool.output.schema]]) {
      const problems = [];
      checkSchemaSubset(schema, `${tool.name}.${what}`, problems);
      assert.deepEqual(problems, [], problems.join('；'));
    }
  }
});
