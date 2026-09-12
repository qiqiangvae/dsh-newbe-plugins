/**
 * IDEA 运行配置解析接缝：从 .idea/workspace.xml 与 .run/*.xml 里认出 Spring Boot 配置，
 * 并生成可执行的 Maven 命令。纯函数——解析错了会生成跑不起来的命令，所以它单独可测。
 *
 * 样例取自用户真实的 kun-ai 工程（值已脱敏为占位）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseSpringBootConfigurations, buildLaunchConfig, plannedConfigName } = await import('../lib/index.js');

const WORKSPACE = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="RunManager">
    <configuration name="KunAiApplication-workflow" type="SpringBootApplicationConfigurationType" factoryName="Spring Boot">
      <envs>
        <env name="ai-review.workflow.python.base-url" value="http://localhost:8080" />
        <env name="pingpongx.cloud.tag" value="QQ" />
      </envs>
      <module name="kun-ai-web" />
      <option name="SPRING_BOOT_MAIN_CLASS" value="com.pingpongx.kun.ai.web.KunAiApplication" />
      <method v="2">
        <option name="Make" enabled="true" />
      </method>
    </configuration>
    <configuration name="KunAiApplication" type="SpringBootApplicationConfigurationType" factoryName="Spring Boot" nameIsGenerated="true">
      <envs>
        <env name="HARNESS_LLM_API_KEY" value="sk-abc" />
      </envs>
      <module name="kun-ai-web" />
      <option name="SPRING_BOOT_MAIN_CLASS" value="com.pingpongx.kun.ai.web.KunAiApplication" />
    </configuration>
    <configuration name="ThreadPoolConfigurationTest" type="JUnit" factoryName="JUnit" temporary="true">
      <module name="kun-ai-web" />
      <option name="MAIN_CLASS_NAME" value="com.pingpongx.kun.ai.core.config.ThreadPoolConfigurationTest" />
    </configuration>
    <configuration name="debug" type="Remote">
      <module name="kun-ai-web" />
      <option name="HOST" value="172.21.45.115" />
      <option name="PORT" value="18080" />
    </configuration>
  </component>
</project>`;

test('只认 Spring Boot 类型的配置，JUnit 与 Remote 跳过', () => {
  const found = parseSpringBootConfigurations(WORKSPACE);
  assert.deepEqual(found.map((c) => c.name), ['KunAiApplication-workflow', 'KunAiApplication']);
});

test('解析出模块、主类与环境变量', () => {
  const [first] = parseSpringBootConfigurations(WORKSPACE);
  assert.equal(first.module, 'kun-ai-web');
  assert.equal(first.mainClass, 'com.pingpongx.kun.ai.web.KunAiApplication');
  assert.deepEqual(first.envs, [
    { name: 'ai-review.workflow.python.base-url', value: 'http://localhost:8080' },
    { name: 'pingpongx.cloud.tag', value: 'QQ' },
  ]);
  assert.equal(first.problem, '');
});

test('.run/*.xml 的包装结构同样能解析', () => {
  const runFile = `<component name="ProjectRunConfigurationManager">
  <configuration default="false" name="KunAiApplication" type="SpringBootApplicationConfigurationType" factoryName="Spring Boot">
    <module name="kun-ai-web" />
    <option name="SPRING_BOOT_MAIN_CLASS" value="com.pingpongx.kun.ai.web.KunAiApplication" />
  </configuration>
</component>`;
  const found = parseSpringBootConfigurations(runFile);
  assert.equal(found.length, 1);
  assert.equal(found[0].module, 'kun-ai-web');
});

test('字段不全的配置带可读原因，而不是产生半截配置', () => {
  const broken = `<component name="RunManager">
    <configuration name="NoModule" type="SpringBootApplicationConfigurationType">
      <option name="SPRING_BOOT_MAIN_CLASS" value="com.foo.Bar" />
    </configuration>
    <configuration name="NoMain" type="SpringBootApplicationConfigurationType">
      <module name="kun-ai-web" />
    </configuration>
  </component>`;
  const found = parseSpringBootConfigurations(broken);
  assert.equal(found.length, 2);
  assert.match(found[0].problem, /模块/);
  assert.match(found[1].problem, /主类/);
});

test('生成命令：不带 -am，带主类，目录与模块正确', () => {
  const [first] = parseSpringBootConfigurations(WORKSPACE);
  const config = buildLaunchConfig(first, '/Users/me/Code/kun-ai');
  assert.equal(
    config.command,
    'mvn -pl kun-ai-web spring-boot:run -Dspring-boot.run.main-class=com.pingpongx.kun.ai.web.KunAiApplication',
  );
  assert.ok(!config.command.includes('-am'), '不能带 -am：run 目标会先作用在没有主类的聚合工程上');
  assert.equal(config.cwd, '/Users/me/Code/kun-ai');
  assert.equal(config.name, 'KunAiApplication-workflow');
  assert.deepEqual(config.envs, first.envs);
});

test('XML 实体被解码', () => {
  const xml = `<configuration name="A&amp;B" type="SpringBootApplicationConfigurationType">
    <module name="m1" />
    <option name="SPRING_BOOT_MAIN_CLASS" value="com.foo.Bar" />
    <envs><env name="URL" value="http://x?a=1&amp;b=2" /></envs>
  </configuration>`;
  const [cfg] = parseSpringBootConfigurations(xml);
  assert.equal(cfg.name, 'A&B');
  assert.deepEqual(cfg.envs, [{ name: 'URL', value: 'http://x?a=1&b=2' }]);
});

test('空环境变量名被丢弃，重复的环境变量保留最后一个', () => {
  const xml = `<configuration name="X" type="SpringBootApplicationConfigurationType">
    <module name="m1" />
    <option name="SPRING_BOOT_MAIN_CLASS" value="com.foo.Bar" />
    <envs>
      <env name="" value="junk" />
      <env name="A" value="1" />
      <env name="A" value="2" />
    </envs>
  </configuration>`;
  const [cfg] = parseSpringBootConfigurations(xml);
  assert.deepEqual(cfg.envs, [{ name: 'A', value: '2' }]);
});

test('非 XML 文本不抛错，返回空列表', () => {
  assert.deepEqual(parseSpringBootConfigurations('这不是 XML'), []);
  assert.deepEqual(parseSpringBootConfigurations(''), []);
});

test('同名不覆盖：导入时自动让路到 名字 (2)、(3)', () => {
  assert.equal(plannedConfigName('web', []), 'web');
  assert.equal(plannedConfigName('web', ['web']), 'web (2)');
  assert.equal(plannedConfigName('web', ['web', 'web (2)']), 'web (3)');
});
