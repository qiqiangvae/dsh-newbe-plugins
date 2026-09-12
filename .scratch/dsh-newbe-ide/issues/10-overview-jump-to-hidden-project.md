# 10: 收起（或被「只看运行中」滤掉）的项目，从总览点配置名"点了没反应"

**症状:** 项目 tab 被 `×` 收起后，从总览卡片里点它的配置名：总览关了，但**没有出现该项目的 tab**，人停在另一个项目上（看起来像点击没生效）。当前选中的那条配置也没落到点的那条上（人已经在别的项目，看不出来）。

**Root cause（已用单变量实验定位）:** 总览里那个点击只做了三件事——关总览、`setActiveProjectId(目标)`、记下选中的配置；**没有让路把项目"藏起来"的开关**。而"藏"有两个来源：

1. `hidden`（`×` 收起的标记）——`visibleProjects = registered.filter(p => !p.hidden && …)`；
2. 「只看运行中」（该项目当时没有配置在跑）。

项目不可见 → tab 行里没有它的 tab；紧接着那条"选中项必须可见"的兜底 effect（`client.tsx` 里注释写着"选中的项目被过滤掉时不能还停在它上面"）立刻把 `activeProjectId` 改成 `visibleProjects[0]`，于是人被弹到别的项目。**兜底本身没错，是"带用户去某个项目"这条路径没把项目变可见。**

**Status:** done（真机验证通过）

**修复:** 把"带用户去某个项目"收成一条路径 `revealProject(workspaceId, configId?)`：关总览 → 切 `activeProjectId` →（可选）选中配置 → **两处隐藏开关都让路**（`hidden` 落盘清掉；`onlyRunning` 仅在该项目确实没在跑时关掉，避免无谓地重置用户的过滤）。三个入口全部改走它：项目 tab、`»` 菜单、总览里的配置名。原来的 `selectProject` / `openConfig` 两个各写一半的版本删掉——**bug 的根源就是同一条语义有两个手写副本**。

## Comments

**诊断记录（2026-09-12，用 /diagnosing-bugs 流程）**

反馈回路（一个命令、可用退出码判定，脚本留在 `../repro/`）：

```bash
REPRO_TARGET=kun-ai REPRO_MODE=hidden ./.scratch/dsh-newbe-ide/repro/run-jump-check.sh   # 复现：修复前 FAIL，修复后 PASS
REPRO_TARGET=zagent  REPRO_MODE=visible ./.scratch/dsh-newbe-ide/repro/run-jump-check.sh # 对照组：始终 PASS
REPRO_TARGET=kun-ai  REPRO_MODE=filtered ./.scratch/dsh-newbe-ide/repro/run-jump-check.sh # 第二处隐藏开关：修复前 FAIL
```

它用 playwright-cli 驱动真实面板，断言的就是用户看到的那件事：点完之后**目标的 tab 存在且被选中、总览已关闭**。

四轮证据（每轮只动一个变量）：

| 轮次 | 变量 | 结果 |
| --- | --- | --- |
| 1 | 目标收起（hidden） | **FAIL**：`tabs` 里没有 kun-ai，`masterTitle` 变成 zagent（被兜底弹走） |
| 2 | 目标可见（对照组） | PASS：tab 存在且选中 → 证明这条链路本身是通的、回路能变绿 |
| 3 | 同一个项目，只把 `hidden` 拿掉 | PASS → **hidden 是唯一的载荷变量** |
| 4 | 目标可见 + 打开「只看运行中」（目标没跑） | **FAIL** → 第二处隐藏开关有同样的症状 |

第 3 轮把 H1（没清 `hidden`）与 H2（兜底逻辑本身错）、H5（轮询回读把我改的盖回去）区分开：若是 H2/H5，第 3 轮仍应 FAIL。1–3 轮都是确定性结果，排除偶发。

**回归测试的接缝缺失（记在这里，别下次又找一遍）:** 这条链路没有可进 CI 的干净接缝——判定横跨"点击处理函数 → 可见性过滤 → 兜底 effect"三处，全在 `IdeView` 组件里，而本包的测试是 `node --test`（无 DOM、无渲染器），`IdeView` 也不是纯函数。所以回归锁只能落在上面那个浏览器脚本上（手工跑，依赖本机 `dsh web`，不进 CI）。真要进 CI，得给这个包加 jsdom + @testing-library/react 之类的渲染测试环境——那是独立一笔账，没在这次里做。

**面板状态:** 诊断过程中收起/放开的项目已复原（zagent 可见、kun-ai 收起，与你原来的状态一致）。
