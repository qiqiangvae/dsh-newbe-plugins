# 05: 从 .idea 导入启动配置，导入完能直接起 kun-ai

**What to build:** 面板发现项目里的 IDEA Spring Boot 运行配置，一键变成启动配置——模块名、主类、环境变量全部带过来；导入后点启动，`kun-ai-web` 真的跑起来。这是"不再开 IDEA"的兑现点。

**Blocked by:** 01 (面板装得上，一条启动配置能存住), 02 (一条启动配置能一键启停，日志实时滚出来)

**Status:** ready-for-agent

- [ ] 发现项目根的 `.idea/workspace.xml` 与 `.run/*.xml` 里的 Spring Boot 运行配置，并列出可导入项
- [ ] 字段映射正确：模块名 → `-pl <module> -am`；`SPRING_BOOT_MAIN_CLASS` → `-Dspring-boot.run.main-class=...`；`<envs>` → 环境变量；配置名 → 启动配置名称
- [ ] 导入 `kun-ai` 后生成的启动配置可直接启动成功（含 5 个环境变量），实测通过
- [ ] 已存在同名启动配置时不静默覆盖，改为提示并让用户选择
- [ ] 环境变量里的密钥值在界面上掩码
- [ ] XML 缺失/字段不全/解析失败时给出可读原因，不抛栈、不产生半截配置
