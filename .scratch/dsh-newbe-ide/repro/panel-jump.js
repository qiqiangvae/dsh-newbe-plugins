/**
 * 复现/回归脚本（手工跑，不进 CI）：见同目录 run-jump-check.sh。
 * 前提：本机跑着 `dsh web`（127.0.0.1:3080），装了 playwright-cli。
 *
 * 它验的是一条链路：从「总览」卡片里点配置名，应该把用户带到那个项目——
 * 该项目必须**有 tab 且被选中**，总览关闭。
 *
 * 症状（bug）：项目处于「收起」（hidden）时，点了以后没有它的 tab，人停在别的项目上。
 * 三种模式（跑之前用 eval 设 window.__reproMode / __reproTarget）：
 *   hidden   —— 目标项目先收起（「×」那份隐藏）
 *   filtered —— 目标项目可见但没在跑，再打开「只看运行中」（另一份隐藏）
 *   visible  —— 目标项目保持可见（对照组：证明这条链路本身是通的）
 *
 * 判定：PASS = 点击后存在目标的 tab 且被选中、总览已关闭；其余为 FAIL（附各阶段快照）。
 */
async page => {
  const TARGET = await page.evaluate(() => window.__reproTarget ?? 'kun-ai');
  const MODE = await page.evaluate(() => window.__reproMode ?? 'hidden');

  const read = () => page.evaluate((target) => {
    const root = document.querySelector('.ide-root');
    if (root === null) return { error: 'no .ide-root' };
    const tabs = [...root.querySelectorAll('.ide-tab')];
    const label = (t) => t.textContent.replace('×', '').trim();
    const tab = tabs.find((t) => label(t).includes(target));
    return {
      tabs: tabs.map(label),
      tabExists: tab !== undefined,
      tabSelected: tab !== undefined && tab.getAttribute('data-sel') === 'true',
      boardOpen: root.querySelector('.ide-board') !== null,
      masterTitle: root.querySelector('.ide-mhead .ide-title')?.textContent ?? null,
    };
  }, TARGET);

  // 0. 面板必须在场：没有就开一个会话再点 IDE tab
  if ((await page.$('.ide-root')) === null) {
    if ((await page.$('[role=tab]')) === null) {
      // 会话树里挑一个真会话（带相对时间徽标）；有些条目点了不开视图，就换下一个
      const items = await page.$$('[role=treeitem]');
      for (const item of items) {
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
  }
  if ((await page.$('.ide-root')) === null) {
    return 'FAIL no .ide-root: ' + JSON.stringify(await page.evaluate(() => ({
      tabs: [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim()),
      body: document.body.innerText.slice(0, 120),
    })));
  }

  // 1. 前提：目标项目的可见性符合模式
  const hasTab = async () => (await page.$(`.ide-tab:has-text("${TARGET}")`)) !== null;
  if (MODE === 'hidden') {
    if (await hasTab()) {
      const x = await (await page.$(`.ide-tab:has-text("${TARGET}")`)).$('.ide-x');
      if (x !== null) { await x.click(); await page.waitForTimeout(800); }
    }
  } else if (!(await hasTab())) {
    const details = await page.$('.ide-overflow');
    if (details !== null) {
      await page.evaluate(() => {
        const d = document.querySelector('.ide-overflow');
        if (d !== null && !d.open) d.querySelector('summary').click();
      });
      const li = await page.$(`.ide-overflow li:has-text("${TARGET}")`);
      if (li !== null) { await li.click(); await page.waitForTimeout(800); }
    }
  }

  // 1b. filtered 模式：再叠一个"只看运行中"（目标没在跑时，它是被这个过滤器藏起来的）
  if (MODE === 'filtered') {
    const only = await page.$('.ide-tools .ide-chip:has-text("只看运行中")');
    if (only !== null && (await only.getAttribute('data-sel')) !== 'true') {
      await only.click();
      await page.waitForTimeout(800);
    }
  }

  // 2. 前提：站在总览上（chip 打开 + 总览 tab 选中）
  const chip = await page.$('.ide-tools .ide-chip:has-text("总览")');
  if (chip !== null && (await chip.getAttribute('data-sel')) !== 'true') {
    await chip.click();
    await page.waitForTimeout(600);
  }
  const boardTab = await page.$('.ide-tab:has-text("总览")');
  if (boardTab !== null && (await boardTab.getAttribute('data-sel')) !== 'true') {
    await boardTab.click();
    await page.waitForTimeout(600);
  }

  const before = await read();

  // 3. 触发：在总览里点目标项目的配置名
  const clicked = await page.evaluate((target) => {
    const cards = [...document.querySelectorAll('.ide-board .ide-card')];
    const card = cards.find((c) => c.querySelector('.ide-title')?.textContent?.trim() === target);
    if (card === undefined) return false;
    const name = card.querySelector('.ide-name');
    if (name === null) return false;
    name.click();
    return true;
  }, TARGET);
  await page.waitForTimeout(1200);

  const after = await read();
  const pass = after.tabExists === true && after.tabSelected === true && after.boardOpen === false;
  return (pass ? 'PASS ' : 'FAIL ') + JSON.stringify({ target: TARGET, mode: MODE, clicked, before, after });
}
