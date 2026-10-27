/**
 * 侧栏「收藏会话」入口的盒模型回归测试。
 *
 * DSH 0.2 的侧栏多了一列全局面板行（「插件」「自动化任务」「记忆系统」「更多」，宿主 `.kB3qhq_panelRow`：
 * `margin:0 2px` / `padding:7px 8px` / `gap:8px` / `min-height:36px` / `line-height:22px`）。
 * 「收藏会话」入口渲染在 `.kB3qhq_newSession` 之后、面板列表之前，早先镜像的是工作区行
 * （`.projectRow`：`padding:0 8px` / `height:34px` / `gap:6px`），于是图标列左偏 2px、行高矮 2px，
 * 和插件/自动化任务那几行对不齐。这里锁住新的一套数值，避免下次又悄悄退回去。
 *
 * 从 lib 产物取值，所以改 src 之后必须先 build。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const rule = /\.mf-folderButton\{([^}]*)\}/.exec(bundle)?.[1] ?? '';

test('收藏入口与宿主全局面板行同一套盒模型', () => {
  assert.notEqual(rule, '', '产物里找不到 .mf-folderButton 规则');
  for (const decl of ['margin:0 2px', 'width:calc(100% - 4px)', 'padding:7px 8px', 'gap:8px', 'min-height:36px', 'line-height:22px']) {
    assert.ok(rule.includes(decl), `.mf-folderButton 缺少 ${decl}`);
  }
  assert.ok(!rule.includes('height:34px'), '.mf-folderButton 还留着工作区行的 34px 行高');
});

test('收藏入口只显示名称，不带收藏数量', () => {
  const label = /className: "mf-folderLabel"([\s\S]{0,80})/.exec(bundle)?.[1] ?? '';
  assert.ok(label.includes('children: "'), '产物里找不到收藏入口的文字节点');
  assert.ok(!label.includes('sessions.length'), '收藏入口仍在渲染收藏数量');
});
