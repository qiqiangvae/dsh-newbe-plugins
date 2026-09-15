/**
 * 复现/回归脚本（手工跑，不进 CI）：见同目录 run-delete-check.sh。
 * 前提：本机跑着 `dsh web`（127.0.0.1:3080），装了 playwright-cli。
 *
 * 验的是**总览卡片上的删除链路**（这块没有 React 单测，只能驱动真面板）：
 *   1. 卡片右上角有 `…` 菜单，三项：收起 / 重命名 / 删除
 *   2. 重命名是内联输入框；Escape 取消、保存生效
 *   3. 删除是**两步**：第一下只变成「确认删除（含日志）」且卡片还在，第二下才真删
 *   4. 行内 `×` 同样是两步
 *
 * 全程只碰一条自建的临时项目配置（`/tmp/__ui-delete-check`），开头先清残留、末尾删干净，
 * 不触碰用户已有的任何项目配置。
 */
async page => {
  const PATH = '/tmp/__ui-delete-check';
  const RENAMED = '__ui-delete-check-renamed';
  const log = [];
  const mark = (ok, msg) => { log.push((ok ? 'PASS ' : 'FAIL ') + msg); return ok; };

  const bootstrap = async () => {
    if ((await page.$('.ide-root')) !== null) return;
    if ((await page.$('[role=tab]')) === null) {
      for (const item of await page.$$('[role=treeitem]')) {
        const text = (await item.textContent()) ?? '';
        if (!/(刚刚|\d+\s*(分钟|小时|天))/.test(text)) continue;
        await item.click();
        await page.waitForSelector('[role=tab]', { timeout: 4000 }).catch(() => {});
        if ((await page.$('[role=tab]')) !== null) break;
      }
    }
    const tab = await page.$('[role=tab]:has-text("IDE")');
    if (tab !== null) await tab.click();
    await page.waitForSelector('.ide-root', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
  };

  const gotoBoard = async () => {
    const chip = await page.$('.ide-tools .ide-chip:has-text("总览")');
    if (chip !== null && (await chip.getAttribute('data-sel')) !== 'true') { await chip.click(); await page.waitForTimeout(500); }
    const tab = await page.$('.ide-tab:has-text("总览")');
    if (tab !== null && (await tab.getAttribute('data-sel')) !== 'true') { await tab.click(); await page.waitForTimeout(500); }
  };

  const cardState = () => page.evaluate((p) => {
    const card = [...document.querySelectorAll('.ide-board .ide-card')]
      .find((c) => c.querySelector('.ide-note.ide-mono')?.textContent?.trim() === p);
    if (card === undefined) return null;
    const details = card.querySelector('details.ide-overflow');
    return {
      title: card.querySelector('.ide-title')?.textContent ?? null,
      menuItems: details === null ? null : [...details.querySelectorAll('li')].map((li) => li.textContent.trim()),
      hasRenameInput: card.querySelector('input.ide-field') !== null,
      rows: [...card.querySelectorAll('.ide-cardrow')].map((r) => ({
        name: r.querySelector('.ide-name')?.textContent ?? '',
        buttons: [...r.querySelectorAll('button')].map((b) => b.textContent.trim()),
      })),
    };
  }, PATH);

  /** kind: 'rename' | 'delete' | 'hide'——按语义找，不靠易变的中文文案逐字匹配。 */
  const clickMenu = (kind) => page.evaluate(([p, what]) => {
    const card = [...document.querySelectorAll('.ide-board .ide-card')]
      .find((c) => c.querySelector('.ide-note.ide-mono')?.textContent?.trim() === p);
    const details = card?.querySelector('details.ide-overflow');
    if (details === undefined || details === null) return false;
    details.open = true;
    const items = [...details.querySelectorAll('li')];
    const li = what === 'delete'
      ? items.find((x) => x.hasAttribute('data-danger'))
      : what === 'rename'
        ? items.find((x) => x.textContent.includes('重命名'))
        : items.find((x) => /收起|恢复/.test(x.textContent));
    if (li === undefined) return false;
    li.click();
    return true;
  }, [PATH, kind]);

  const removeCard = async () => {
    for (let i = 0; i < 4; i++) {
      if ((await cardState()) === null) return true;
      await clickMenu('delete');           // 第一下：武装
      await page.waitForTimeout(300);
      await clickMenu('delete');           // 第二下：真删
      await page.waitForTimeout(900);
    }
    return (await cardState()) === null;
  };

  await bootstrap();
  await gotoBoard();
  if ((await page.$('.ide-board')) === null) {
    return 'FAIL 没有总览面板：' + JSON.stringify(await page.evaluate(() => document.body.innerText.slice(0, 120)));
  }
  await removeCard();   // 清掉上次跑剩下的

  // ---- 1. 建一条临时项目配置 ----
  await page.evaluate((p) => {
    const input = document.querySelector('.ide-addcard input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, p);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, PATH);
  await page.waitForTimeout(200);
  await page.click('.ide-addcard button:has-text("添加")');
  await page.waitForTimeout(1000);
  let state = await cardState();
  mark(state !== null, '新卡片出现在总览（' + PATH + '）');

  // ---- 2. 菜单三项 ----
  state = await cardState();
  const items = state?.menuItems ?? [];
  mark(
    items.includes('收起') && items.some((x) => x.includes('重命名')) && items.some((x) => x.includes('删除')),
    '卡片 `…` 菜单有三项：' + JSON.stringify(items),
  );

  // ---- 3. 重命名：内联输入 + Escape 取消 + 保存生效 ----
  await clickMenu('rename');
  await page.waitForTimeout(400);
  state = await cardState();
  mark(state?.hasRenameInput === true, '点「重命名」出现内联输入框');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  state = await cardState();
  mark(state?.hasRenameInput === false && state?.title === '__ui-delete-check', 'Escape 取消改名，标题不变：' + String(state?.title));

  await clickMenu('rename');
  await page.waitForTimeout(400);
  await page.fill('.ide-board .ide-card input.ide-field', RENAMED);
  await page.click('.ide-board .ide-card button:has-text("保存")');
  await page.waitForTimeout(900);
  state = await cardState();
  mark(state?.title === RENAMED, '改名保存生效：' + String(state?.title));

  // ---- 4. 加一条启动配置，验行内 `×` 两步删除 ----
  await page.evaluate((p) => {
    const card = [...document.querySelectorAll('.ide-board .ide-card')]
      .find((c) => c.querySelector('.ide-note.ide-mono')?.textContent?.trim() === p);
    [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '打开')?.click();
  }, PATH);
  await page.waitForTimeout(900);
  await page.click('button.ide-madd');       // ＋ 启动配置（左列，不需要先展开 ⚙ 配置）
  await page.waitForTimeout(900);
  await gotoBoard();
  state = await cardState();
  const rowBefore = state?.rows?.[0];
  mark((state?.rows?.length ?? 0) === 1 && rowBefore?.buttons?.includes('×') === true,
    '行里有 `×` 删除键：' + JSON.stringify(state?.rows));

  await page.evaluate((p) => {
    const card = [...document.querySelectorAll('.ide-board .ide-card')]
      .find((c) => c.querySelector('.ide-note.ide-mono')?.textContent?.trim() === p);
    const row = card.querySelector('.ide-cardrow');
    [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '×')?.click();
  }, PATH);
  await page.waitForTimeout(400);
  const armedRow = (await cardState())?.rows?.[0];
  mark(
    (armedRow?.buttons?.includes('确认') ?? false) && (await cardState())?.rows?.length === 1,
    '行内第一下只是「确认」，那条配置还在：' + JSON.stringify(armedRow?.buttons),
  );
  await page.evaluate((p) => {
    const card = [...document.querySelectorAll('.ide-board .ide-card')]
      .find((c) => c.querySelector('.ide-note.ide-mono')?.textContent?.trim() === p);
    const row = card.querySelector('.ide-cardrow');
    [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '确认')?.click();
  }, PATH);
  await page.waitForTimeout(900);
  mark(((await cardState())?.rows?.length ?? -1) === 0, '行内第二下真删掉了那条启动配置');

  // ---- 5. 卡片两步删除 ----
  await clickMenu('delete');
  await page.waitForTimeout(400);
  state = await cardState();
  mark(
    (state?.menuItems ?? []).some((x) => x.includes('确认删除')) && state !== null,
    '卡片第一下只变成「确认删除」（卡片还在）：' + JSON.stringify(state?.menuItems),
  );
  await clickMenu('delete');
  await page.waitForTimeout(1000);
  mark((await cardState()) === null, '卡片第二下真删掉了，总览干净');

  const failed = log.filter((l) => l.startsWith('FAIL'));
  return (failed.length === 0 ? 'PASS ' : 'FAIL ') + JSON.stringify({ tail: PATH, ok: log.length - failed.length, failed: failed.length, log });
}
