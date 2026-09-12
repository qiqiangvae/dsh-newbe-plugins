# 11: 总览改成常驻 tab（取消开关）

**What to build:** 总览原来是**配置项**（持久化的 `showOverview`，默认关，tab 行里用「总览」chip 开关）。改成**常驻**：tab 行首位永远是「总览」，工具区那个 chip 去掉。

**Blocked by:** 06（总览本体）、10（从总览跳配置名）

**Status:** done（真机验证通过）

- [x] tab 行首位常驻「总览」，不再看任何配置
- [x] 工具区的「总览」开关 chip 删掉（连同 `toggleOverviewTab`）
- [x] 客户端不再读 `showOverview`（`grep` 只剩 schema 定义；面板行为与这个字段彻底解耦）
- [x] 落盘字段**保留**并补 `.default(false)`：删字段会让还在按老 schema 校验的版本（回滚、另装旧包）读到新文件时因"缺字段"把整份状态判为损坏——那等于把用户的启动配置全丢
- [x] 新增一条存储测试：老文件缺 `showOverview` 时仍能读回、配置不丢

## Comments

**实现记录（2026-09-12）**

- `src/client.tsx`：tab 行去掉 `cfg.showOverview ? … : null` 条件；删掉工具区的 chip、`toggleOverviewTab`、以及"tab 滚进视野"那个 effect 里的 `cfg.showOverview` 依赖。`overview` 仍是**视图本地**状态（默认落在第一个项目上，点总览才切过去）——"常驻"改的是"tab 永在"，不是"默认落地页"，这一条没动。
- `src/schema.ts`：`showOverview` 留在 schema 里 + `.default(false)`，注释写明它已无 UI、为什么不能删。
- 顺手修掉常驻后必然看得见的一个旧毛病：总览卡片一行里塞了状态点 / 名称 / 端口 / 状态 / 最后一行 / 启停键，280px 的卡宽下会折成"停 / 止"那种竖排。改成卡片最小 340px，行内名称与状态各自单行省略、按钮 `flex:none` 不换行（`.ide-cardrow` 那四条）。实测 4 行高度都是 33px，无折行。
- 验证：真机面板 —— tab 行 `["总览","zagent 3"]`、工具区只剩 `只看运行中`；点总览出 3 张项目卡（含已收起的），点配置名/项目 tab 正常切回；`tsc --noEmit`、`node --check` ×3、78 条测试全绿（原 77 + 新增 1）。
