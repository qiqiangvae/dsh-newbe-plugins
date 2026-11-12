/**
 * 侧栏「收藏会话」入口的挂载位置与盒模型回归测试。
 *
 * DSH 0.2 的侧栏把「插件」「自动化任务」「记忆系统」「更多」渲染成 `nav.panelList` 里的全局面板行
 * （宿主 `.panelEntry` 提供 3px 透明内描边，行本身 `.panelRow`：`min-height:32px` / `padding:5px 9px` /
 * `background-clip:padding-box` / `gap:6px` / `border-radius:12px`，行盒 x=8..272、图标 x=20、文字 x=42）。
 *
 * 「收藏会话」不是 `sidebar.panellist` 注册项，而是把容器 DOM 插进 `nav.panelList` 的最前面：
 * 与这些行同列、同 2px 行距、随列表一起滚动。曾经插在「新建会话」按钮之后（header 区、滚动区之外），
 * 与面板行之间隔着容器 padding/margin 8px + scrollRegion margin-top 4px + 滚动区首行 8px，看起来是两块区域。
 * 这里同时锁住「挂在哪」和「行盒照抄宿主面板行」，避免退回按像素试出来的近似值。
 *
 * 从 lib 产物取值，所以改 src 之后必须先 build。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const rule = /\.mf-folderButton\{([^}]*)\}/.exec(bundle)?.[1] ?? '';

test('收藏入口挂在全局面板行那一列的最前面', () => {
  assert.ok(bundle.includes('container.className = "mf-panelListLeading"'), '产物里找不到面板列容器');
  assert.ok(bundle.includes('nav.className.includes("panelList")'), '没有按宿主 nav.panelList 定位');
  assert.ok(bundle.includes('panelList.prepend(container)'), '容器没有插进面板列表');
  assert.ok(!bundle.includes('insertAdjacentElement'), '入口又插回「新建会话」按钮后面了');
});

test('收藏入口与宿主全局面板行同一套盒模型', () => {
  assert.notEqual(rule, '', '产物里找不到 .mf-folderButton 规则');
  for (const decl of [
    'margin:0',
    'width:100%',
    'border-inline:var(--dsh-sidebar-paint-inset,3px) solid transparent',
    'padding:5px calc(var(--dsh-sidebar-row-padding,12px) - var(--dsh-sidebar-paint-inset,3px))',
    'background-clip:padding-box',
    'gap:var(--dsh-sidebar-label-gap,6px)',
    'border-radius:var(--dsw-radius-md,12px)',
    'min-height:32px',
    'line-height:22px',
  ]) {
    assert.ok(rule.includes(decl), `.mf-folderButton 缺少 ${decl}`);
  }
  assert.ok(!rule.includes('margin:0 2px'), '.mf-folderButton 又回到 2px 外边距（图标列会左偏）');
  assert.ok(!rule.includes('min-height:36px'), '.mf-folderButton 还留着旧宿主的 36px 行高（比面板行高 4px）');
});

test('收藏入口只显示名称，不带收藏数量', () => {
  const label = /className: "mf-folderLabel"([\s\S]{0,80})/.exec(bundle)?.[1] ?? '';
  assert.ok(label.includes('children: "'), '产物里找不到收藏入口的文字节点');
  assert.ok(!label.includes('sessions.length'), '收藏入口仍在渲染收藏数量');
});
