# 07: 发布：文档、术语、npm

**What to build:** 别人能按 README 装上并用起来：术语表登记进仓库的领域文档，`CONTEXT-MAP.md` 有这一行，中文 README 写清能力/安装/配置/限制，npm 上有与仓库一致的版本。

**Blocked by:** 03 (日志能用：过滤 + 落盘历史), 04 (一个项目多条启动配置：两层 tab), 05 (从 .idea 导入启动配置，导入完能直接起 kun-ai), 06 (规模化：tab 滑动与隐藏 + 总览)

**Status:** ready-for-agent

- [x] `packages/dsh-newbe-ide/CONTEXT.md` 采用规格里的术语（项目 / 启动配置 / 启动命令 / 面板 / 运行态 / 日志 / 收起 / 总览），并列出各自 _Avoid_ 的同义词
- [x] 根 `CONTEXT-MAP.md` 增加 `dsh-newbe-ide` 一行（并更新"尚未记录"一节）
- [x] 中文 `packages/dsh-newbe-ide/README.md`：能力、两种安装方式、配置与数据位置、已验证 DSH 0.1.5-alpha.2、六条明确限制（含 PID 取不到与导入不认 VM options 的原因）
- [x] 根 `README.md` 插件表与安装示例各增加一条
- [ ] `npm publish` 后包版本与仓库一致，安装不需要构建（**待用户凭据**，命令与核对清单见 Comments）
- [x] 一次性原型移出主分支：存档在 `prototype/dsh-newbe-ide` 分支，主分支只留 `packages/dsh-newbe-ide`；规格里的链接已指向分支

## Comments

**实现记录（2026-09-12）**

- 术语表照 `my-favorites/CONTEXT.md` 的格式写（词条 + 定义 + `_Avoid_`）；`收起` 与 `总览` 也收录了，因为这两个词在实现里各有明确语义且容易被叫错。
- **没有加 `dsh.compatibility.dshReleases`**：在 DSH 0.1.5-alpha.2 的整个安装目录里 grep 不到任何读取方（`dsh-context` 声明了它，但没人读），因此版本兼容只写在 README，不塞一个没人读的字段。
- README 的"限制"一节写的是**原因**而不只是结论（为什么没有 PID、为什么导入不能带 `-am`、为什么不注册设置页），这样遇到问题时能自己判断。

**发布前需要用户执行**（我这边不能代为输入凭据）：

```bash
cd packages/dsh-newbe-ide
npm publish --access public
```

发布前自查（都已满足，可复核）：

```bash
node -e "const p=require('./package.json');console.log(p.name,p.version,p.files)"   # 0.1.0，files 只含 lib/ 与文档
ls lib/                                                                              # index.js / typert.host.js / client.js 已提交
grep -c prepare package.json || echo '无 prepare/postinstall：安装不触发构建'
```
