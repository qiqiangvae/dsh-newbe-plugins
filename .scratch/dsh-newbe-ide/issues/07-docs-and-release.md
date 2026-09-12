# 07: 发布：文档、术语、npm

**What to build:** 别人能按 README 装上并用起来：术语表登记进仓库的领域文档，`CONTEXT-MAP.md` 有这一行，中文 README 写清能力/安装/配置/限制，npm 上有与仓库一致的版本。

**Blocked by:** 03 (日志能用：过滤 + 落盘历史), 04 (一个项目多条启动配置：两层 tab), 05 (从 .idea 导入启动配置，导入完能直接起 kun-ai), 06 (规模化：tab 滑动与隐藏 + 总览)

**Status:** ready-for-agent

- [ ] `packages/dsh-newbe-ide/CONTEXT.md` 采用规格里的术语（项目 / 启动配置 / 启动命令 / 面板 / 运行态 / 日志），并列出各自 _Avoid_ 的同义词
- [ ] 根 `CONTEXT-MAP.md` 增加 `dsh-newbe-ide` 一行
- [ ] 中文 `packages/dsh-newbe-ide/README.md`：能力、两种安装方式（npm 与 `github:...#path:`）、配置项说明、"已验证 DSH 0.1.5-alpha.2"、明确限制（不含调试器）
- [ ] 根 `README.md` 插件表增加一行
- [ ] `npm publish` 后包版本与仓库一致，安装不需要构建
- [ ] 一次性原型移出主分支，主分支只留选中的形态
