# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.3.1-alpha] - 2026-09-22

### Fixed

- 升级到 DSH `v0.1.7-alpha.1` 后插件整个失效（一条 slide 都不渲染，设置页里也没有本插件的两项）：该版本换掉了插件的设置服务，旧写法让插件一直等一个已不存在的服务、加载时被静默搁置。已改用新版设置服务，slide 与设置页都恢复。
- 有工具调用的段落里，原生 Think 行不再被隐藏，推理内容显示两遍：该版本把消息流行套进了分组容器，插件的判定改为按文档顺序读取。

### Notes

- DSH `v0.1.7-alpha.1` 会把「已完成的一轮」的中间过程原生折叠成一行「已完成工作 N 个工具调用」（简洁 / 详细 / 完全展开三种「工作过程展示」模式都折叠）。进行中的一轮 slide 照常常显；已完成的一轮点开这一行，看到的就是本插件的 slide。
