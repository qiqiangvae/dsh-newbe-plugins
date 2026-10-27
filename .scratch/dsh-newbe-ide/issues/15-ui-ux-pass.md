# 15: 面板 UI / 交互打磨（一轮）

**What to build:** 在不改数据流与既有版式决策（主从卡片 = 票 08 变体 C、一次只编辑一条 = 票 09）的前提下，
把面板的视觉层级、可访问性与状态反馈收拾一遍：选中态 / 计数 / 危险操作 / 加载 / 空态 / 焦点 / 菜单。

**Status:** ready-for-human（真面板回归通过，见 Comments）

## 范围（只动 `src/client.tsx` 的样式表与 JSX）

**视觉**

- tab：选中态改成「整块浅底 + 下划线」；配置计数从小灰字改成独立胶囊（不再读成名字的一部分）；
  收起键从 0×0 的 `<span>` 改成真按钮，hover / `:focus-within` 才显形。
- 总览：配置行不再铺整块灰底（卡里套灰块太重），hover 才浮出；卡片里的 `启动` 降级为描边按钮
  （一屏 8 个实心主按钮太吵），主按钮只留在右列详情里；配置名从 `<span onClick>` 换成 `<button>`。
- 过滤条：输入框吃掉剩余宽度（原来右边留一大块空白），两侧控件各归一组；有关键字时出现清除键。
- 控件统一 `min-height`（按钮 26 / 胶囊 24）、圆角与 140ms 过渡；补 `prefers-reduced-motion`。
- 加载态换成 spinner + `aria-busy`，不再是一行灰字。

**交互 / 可访问性**

- **⚙ 配置里的两个删除也走两步确认**（原来是一下就没，和票 06 定下的"删除不可逆必须两步"不一致）：
  项目删除键改为「删除项目配置」（CONTEXT 的 `_Avoid_` 里写着"移除"），与配置删除都吃 `armed` 状态；
  首次点击整块变红，Esc 或 4 秒解除。
- **启停按钮有在途反馈**：`busyRun`（键 = runKey）让按钮在宿主回话前显示「启动中… / 停止中… / 重启中…」
  并禁用；`busyRunRef` 挡同一帧内的连点。重启改成一个 `restartRun()`（先停再起，只显示「重启中…」）。
- 菜单：`»` 与 `…` 里的 `<li onClick>` 换成 `<button>`（可 Tab 可达）；点外面或按 Esc 自动收起，
  Esc 同时解除删除武装。
- 状态灯 `aria-hidden`，状态文字进了 tab 的 `title`（颜色不再单独承载"在不在跑"）；`⚙ 配置` 带
  `aria-expanded`，开关类胶囊带 `aria-pressed`，日志跟随键带 `aria-pressed`。
- 表单控件全部补 `aria-label`（名称 / 启动命令 / 工作目录 / 环境变量 / 密钥值）；
  错误条 `role="alert"` 且可关闭，保存反馈 `role="status"`。
- 空项目视图给出「去总览添加」按钮，不再只是一句指路。

## Comments

**实现记录（2026-10-27）**

- 改动只在 `packages/dsh-newbe-ide/src/client.tsx`（样式字符串 + JSX + 三个 handler），
  外加 README 的删除说明一句；`lib/client.js` 已重建。
- **没有动**：`REMOTE_CONTRIBUTION` / 宿主端点 / 存储 schema；主从卡片结构、总览默认不落地、
  一次只编辑一条都保持票 08/09/11 的结论。
- **刻意没做**：票 12 的日志虚拟化 / 跳错误 / 错误计数徽章（是另一档工程）；面板快捷键层（没有需求）；
  `previews/*.webp` 没有重拍（旧图仍是 0.4.x 皮肤，不影响功能）。
- **两处按令牌走**：计数胶囊文字用 `label-secondary`（选中态的品牌色小字对比度不够）；
  选中 tab 的浅底用 `interactive-bg-hover`，因此换皮肤（桌面端的蓝色 brand / 标准主题的近黑 brand）都跟着变。
- 验证：
  - `pnpm -C packages/dsh-newbe-ide run build` / `run check` / `run test`（110 条）全绿。
  - 真面板回归脚本 `repro/panel-ui-check.js`（Playwright）：加项目 → 加配置 → 启动 → 日志收到输出 →
    停止 → 再启动 → 重启 → 停止 → 配置两步删除（第一下只武装）→ 项目删除（第一下确认态、
    Esc 解除、再两下删掉）→ 总览卡片数回到测试前，17 条断言全 PASS。
  - 另外手工验过：菜单 Esc / 点外面收起、`Esc` 解除武装、按钮 `:focus-visible` 有 2px 焦点环
    （`rgb(15,17,21)`，即标准主题的 brand）、tab 收起键在 hover 时显形。
- **验收环境**：桌面端 GUI 装的是 npm `0.4.2`，不吃本 checkout 的 `lib/`。本轮用一个临时
  `dsh --profile web --patch <关闭 ds-bot、插入 link 版 dsh-newbe-ide 的 overlay> --port 0` 起的服务截图；
  改完客户端包需要重启服务才生效（客户端 bundle 在进程启动时装配）。
