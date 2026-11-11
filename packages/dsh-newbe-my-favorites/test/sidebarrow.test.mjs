/**
 * 侧栏「收藏会话」入口的盒模型回归测试。
 *
 * DSH 0.2 的侧栏把「插件」「自动化任务」「记忆系统」「更多」渲染成全局面板行（宿主 `.kB3qhq_panelRow`：
 * `margin:0` / `border-inline:3px solid transparent` / `padding:7px 9px` / `background-clip:padding-box` /
 * `gap:6px` / `border-radius:12px`，行盒 x=8..272、图标 x=20、文字 x=42）。
 * 「收藏会话」入口插在 `.kB3qhq_newSession` 之后、面板列表之前，容器与 `.kB3qhq_panelList` 同宽（x=8、w=264），
 * 但行自身曾用 `margin:0 2px` + `padding:7px 8px` + `gap:8px`：图标落在 x=18，比宿主面板行左偏 2px。
 * 这里锁住「照抄宿主面板行盒模型」的各项声明，并确保不再退回按像素试出来的近似值。
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
  for (const decl of [
    'margin:0',
    'width:100%',
    'border-inline:var(--dsh-sidebar-paint-inset,3px) solid transparent',
    'padding:7px calc(var(--dsh-sidebar-row-padding,12px) - var(--dsh-sidebar-paint-inset,3px))',
    'background-clip:padding-box',
    'gap:var(--dsh-sidebar-label-gap,6px)',
    'border-radius:var(--dsw-radius-md,12px)',
    'min-height:36px',
    'line-height:22px',
  ]) {
    assert.ok(rule.includes(decl), `.mf-folderButton 缺少 ${decl}`);
  }
  assert.ok(!rule.includes('margin:0 2px'), '.mf-folderButton 又回到 2px 外边距（图标列会左偏）');
  assert.ok(!rule.includes('height:34px'), '.mf-folderButton 还留着工作区行的 34px 行高');
});

test('收藏入口只显示名称，不带收藏数量', () => {
  const label = /className: "mf-folderLabel"([\s\S]{0,80})/.exec(bundle)?.[1] ?? '';
  assert.ok(label.includes('children: "'), '产物里找不到收藏入口的文字节点');
  assert.ok(!label.includes('sessions.length'), '收藏入口仍在渲染收藏数量');
});
