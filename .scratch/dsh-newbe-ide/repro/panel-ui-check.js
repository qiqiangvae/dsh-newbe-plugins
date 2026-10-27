/**
 * 一次性 UI 验收脚本：驱动真实面板走完「加项目 → 加配置 → 启停/重启 → 两步删除」。
 * 只碰自建的临时项目配置 /tmp/__ui-ux-check，末尾删干净。
 */
async page => {
  const PATH = '/tmp/__ui-ux-check';
  const log = [];
  const mark = (ok, msg) => { log.push((ok ? 'PASS ' : 'FAIL ') + msg); return ok; };
  const hold = (ms) => page.waitForTimeout(ms);

  const clickText = (selector, text) => page.evaluate(({ selector, text }) => {
    const el = [...document.querySelectorAll(selector)].find((e) => (e.textContent || '').trim().includes(text));
    if (!el) return false;
    el.click();
    return true;
  }, { selector, text });

  const board = async () => {
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll('.ide-tab')].find((e) => e.textContent.trim().startsWith('总览'));
      if (tab && tab.getAttribute('data-sel') !== 'true') tab.click();
    });
    await hold(500);
  };

  const cardIndex = () => page.evaluate((p) => [...document.querySelectorAll('.ide-board .ide-card')]
    .findIndex((c) => (c.querySelector('.ide-note.ide-mono')?.textContent || '').trim() === p), PATH);

  const boardCardCount = () => page.evaluate(() => document.querySelectorAll('.ide-board .ide-card').length);

  /** 删掉同名临时项目（如果有残留）：卡片 `…` 菜单里点两次删除。 */
  const cleanTempProject = async () => {
    await board();
    for (let i = 0; i < 5 && (await cardIndex()) >= 0; i += 1) {
      const cards = await page.$$('.ide-board .ide-card');
      const card = cards[await cardIndex()];
      const summary = await card.$('details.ide-overflow summary');
      if (summary) await summary.click();
      await hold(200);
      const clicked = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.ide-board details.ide-overflow[open] .ide-menu-item')];
        const del = items.find((e) => /删除/.test(e.textContent));
        if (!del) return false;
        del.click();
        return true;
      });
      await hold(300);
      const confirm = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('.ide-board .ide-menu-item[data-armed="true"]')].find((e) => /确认删除/.test(e.textContent));
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (!clicked || !confirm) break;
      await hold(800);
    }
  };

  const detailState = () => page.evaluate(() => document.querySelector('.ide-dmeter .ide-metric b')?.textContent || '');

  const waitState = async (want, timeout = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if ((await detailState()).includes(want)) return true;
      await hold(200);
    }
    return false;
  };

  try {
    if ((await page.$('.ide-root')) === null) {
      const tab = await page.$('[role=tab]:has-text("IDE")');
      if (tab) await tab.click();
      await page.waitForSelector('.ide-root', { timeout: 15000 });
      await hold(1000);
    }

    await cleanTempProject();

    // 1. 加项目
    await board();
    const before = await boardCardCount();
    await page.fill('.ide-addcard input', PATH);
    await (await page.$('.ide-addcard .ide-btn')).click();
    await hold(1200);
    mark((await cardIndex()) >= 0, '添加项目配置出现在总览');

    // 2. 打开项目
    await page.evaluate((p) => {
      const card = [...document.querySelectorAll('.ide-board .ide-card')]
        .find((c) => (c.querySelector('.ide-note.ide-mono')?.textContent || '').trim() === p);
      [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '打开').click();
    }, PATH);
    await hold(600);
    mark((await page.$('.ide-mitem')) !== null, '进入项目后左列出现启动配置列表');

    // 3. 加配置（＋ 启动配置 → ⚙ 配置里填表）
    await clickText('.ide-mitem', '＋ 启动配置');
    await hold(800);
    await clickText('.ide-mheadtop .ide-btn', '配置');
    const opened = await page.waitForSelector('input[aria-label="配置名称"]', { timeout: 5000 }).then(() => true).catch(() => false);
    if (!opened) {
      await clickText('.ide-mheadtop .ide-btn', '配置');
      await page.waitForSelector('input[aria-label="配置名称"]', { timeout: 5000 });
    }
    mark(opened || (await page.$('input[aria-label="配置名称"]')) !== null, '⚙ 配置打开后有名称输入框');
    await page.fill('input[aria-label="配置名称"]', 'ui-check');
    await page.fill('input[aria-label="启动命令"]', "sh -c 'echo READY-UI-CHECK; sleep 120'");
    await page.fill('input[aria-label="工作目录（留空 = 项目路径）"]', '/tmp');
    await clickText('.ide-cfg .ide-btn', '保存');
    await hold(1200);
    mark(((await page.textContent('.ide-cmd')) || '').includes('READY-UI-CHECK'), '保存后详情显示启动命令');

    // 4. 启动 → 运行中 → 日志出现
    await clickText('.ide-dactions .ide-btn', '启动');
    mark(await waitState('运行中'), '启动后状态变为运行中');
    await hold(1500);
    mark(((await page.textContent('.ide-log')) || '').includes('READY-UI-CHECK'), '日志区收到进程输出');

    // 5. 停止 → 已停止
    await clickText('.ide-dactions .ide-btn', '停止');
    mark(await waitState('已停止'), '停止后状态变为已停止');

    // 6. 再启动 → 重启 → 运行中 → 停止
    await clickText('.ide-dactions .ide-btn', '启动');
    await waitState('运行中');
    await clickText('.ide-dactions .ide-btn', '重启');
    mark(await waitState('运行中'), '重启后仍在运行中');
    await clickText('.ide-dactions .ide-btn', '停止');
    mark(await waitState('已停止'), '重启后能正常停止');

    // 7. 配置删除：两步确认
    mark(await clickText('.ide-cfg .ide-form .ide-btn', '删除'), '点第一下配置删除');
    await hold(300);
    const armedConfig = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.ide-cfg .ide-form .ide-btn')].find((e) => /确认删除/.test(e.textContent));
      return b ? b.getAttribute('data-armed') : null;
    });
    mark(armedConfig === 'true', '第一下只武装，不删');
    mark((await page.$$('.ide-mitem')).length >= 2, '武装后配置仍在');
    await clickText('.ide-cfg .ide-form .ide-btn', '确认删除');
    await hold(1500);
    const configsLeft = await page.evaluate(() => [...document.querySelectorAll('.ide-mitem')]
      .filter((e) => !e.textContent.includes('＋ 启动配置')).length);
    mark(configsLeft === 0, '第二下真删掉配置');

    // 8. 项目删除：Escape 解除武装 + 两步删除
    await clickText('.ide-cfg .ide-toolbar .ide-btn', '删除项目配置');
    await hold(300);
    mark(((await page.textContent('.ide-cfg .ide-toolbar')) || '').includes('确认删除项目配置'), '项目删除第一下进入确认态');
    await page.keyboard.press('Escape');
    await hold(300);
    mark(((await page.textContent('.ide-cfg .ide-toolbar')) || '').includes('删除项目配置')
      && !((await page.textContent('.ide-cfg .ide-toolbar')) || '').includes('确认删除'), 'Escape 解除项目删除武装');
    await clickText('.ide-cfg .ide-toolbar .ide-btn', '删除项目配置');
    await hold(300);
    await clickText('.ide-cfg .ide-toolbar .ide-btn', '确认删除项目配置');
    await hold(1500);
    await board();
    mark((await cardIndex()) < 0, '项目配置已从总览消失');
    mark((await boardCardCount()) === before, `卡片数量回到测试前（${before}）`);


  } catch (e) {
    log.push('ERROR ' + (e && e.message ? e.message : String(e)));
  } finally {
    try { await cleanTempProject(); } catch { /* 清理失败留给人工 */ }
  }
  return log.join('\n');
}
