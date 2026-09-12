# dsh-newbe-ide

DSH Web 的会话视图 tab「**IDE**」：把"起服务 / 跑命令 / 看输出"从 IntelliJ IDEA 搬到 DSH 里——
按项目组织**启动配置**，一键启停，日志留在浏览器里，**不进模型上下文**。

## 能力

- **会话视图 tab**：紧邻 `对话` / `轨迹` / `上下文` 的第四个 tab
- **按项目组织**：一个项目（= DSH 工作区）下可挂多条启动配置，各自独立进程与日志
- **一屏一张卡**：左列是这个项目的启动配置（状态点 / 端口 / 状态或运行时长），右列是选中那条的
  状态 / 端口 / 运行时长 / 退出码与启停重启键；启动命令与日志过滤都在同一张卡里
- **一键启停 / 重启**：停止按**进程组**回收，不留孤儿进程、端口立即释放
- **日志**：实时滚动、关键字与正则过滤、级别徽章（ERROR/WARN/INFO/DEBUG/OTHER）、
  自动跟随（向上滚动看历史时不会被拽回底部）
- **日志落盘**：跨 DSH 重启仍能读回上一次的输出（只保留一代轮转文件）
- **从 IDEA 导入**：读 `.idea/workspace.xml` 与 `.run/*.xml` 里的 Spring Boot 运行配置，
  连模块、主类与环境变量一起带过来
- **面板内编辑**：加项目、改启动命令/工作目录/环境变量；密钥类变量在界面上掩码。
  配置块一次只编辑左列选中的那一条，保存与删除都在同一条表单里
- **多项目**：tab 可横向滑动、可收起（配置保留）、`»` 列出全部项目、`只看运行中` 一键过滤
- **总览常驻**：首位 tab 按项目分卡，卡内逐条列启动配置的状态、端口、时长与最后一行日志，
  点配置名直接跳到它（项目被收起或被过滤时也会一并放出来）

## 安装

```bash
# npm（推荐）
dsh plugin --profile web add dsh-newbe-ide

# GitHub 子目录
dsh plugin --profile web add github:qiqiangvae/dsh-newbe-plugins#path:packages/dsh-newbe-ide

# 锁定 commit
dsh plugin --profile web add 'github:qiqiangvae/dsh-newbe-plugins#<commit-sha>&path:packages/dsh-newbe-ide'
```

安装后需重启 `dsh web`（宿主侧的服务与接口在启动时装配）。

## 配置与数据

| 内容 | 位置 |
| --- | --- |
| 项目、启动配置 | `$DSH_HOME/storages/dsh-newbe-ide.json`（权限 0600，**不进 settings.yaml**） |
| 进程日志 | `$DSH_HOME/storages/dsh-newbe-ide/logs/<键>.log`（超 8MB 轮转，保留一代 `.1`） |

- 环境变量里名称匹配 `*_KEY` / `*_SECRET` / `*_TOKEN` / `*PASSWORD` 的值，在界面与日志中均掩码。
- 存储文件损坏时不会崩：回退为空配置并给出可见提示，**原文件保持不动**。

## 已验证

DSH **0.1.5-alpha.2**（macOS）。其他平台与版本未验证。

## 限制（有意不做）

- **没有调试器**：断点、单步、远程调试都不在范围内。
- **不显示 PID**：DSH 的 `shell` 服务契约（`ShellProcess`）只暴露
  `status` / `exitCode` / `done` / `readOutput` / `kill` / `sandbox`，取不到 pid。
- **导入只认 IDEA 工程根目录**：多模块 Maven 工程的根，不是某一个模块；
  也**不解析 VM options**（只映射模块、主类与环境变量）。
- **导入生成的命令不带 `-am`**：`-am` 会把上游工程放进 reactor，
  而 `spring-boot:run` 会对 reactor 里每个工程执行，先在没有主类的聚合工程上失败。
  依赖模块缺失时先跑一次 `mvn -o -pl <module> -am install -DskipTests`。
- **不注册设置页**：配置编辑在面板内的「⚙ 配置」块里（单一写者，避免两个面互相覆盖）。

## 开发

```bash
pnpm -C packages/dsh-newbe-ide run build      # esbuild → lib/（产物已提交，安装不需要构建）
pnpm -C packages/dsh-newbe-ide run check      # tsc --noEmit + node --check
pnpm -C packages/dsh-newbe-ide run test       # node --test（78 项）
```

## License

[MIT](./LICENSE)
