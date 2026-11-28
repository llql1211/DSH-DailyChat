<!--
本文件只记录 fork 相对上游基线的用户可见改动，遵循 Keep a Changelog 1.1.0 与 Semantic Versioning 2.0.0。
版本号用 A.B.C+upstream.X.Y.Z；git tag 带 v 前缀；compare 链接与实际 tag 名逐字一致。
[未发布] 在最上面，已发布版本按新到旧排列；只显示非空分组。
改动被上游收录后，给原条目加删除线并注明收录版本、日期、PR 号。
-->

# Fork Changelog

本 fork 相对上游基线的用户可见改动。上游自身的变更见上游仓库，不在这里重复。

## [未发布]

## [0.4.0+upstream.0.3.1] - 2026-11-28

以 `corlinniu/dsh-daily-chat` 的 `v0.3.1` 为基线建立 fork 独立版本线；版本号从 `0.3.1` 切换为 `0.4.0+upstream.0.3.1`，上半段是 fork 自己的版本，下半段是上游基线。

### Added

- 插件显示元数据与打包清单：补充插件图标、中英文标题与描述，以及发布时需要包含的文件清单。
- 快捷键 `Ctrl+Alt+D` 在日常聊天与工作模式之间切换，可在「设置 → 快捷键」里改绑。
- 日常会话行右端加入原生「更多」菜单与运行状态点。

### Changed

- 侧边栏两个模式入口合并成一个横向胶囊，左半「聊天」、右半「工作」；侧边栏面板列表交回 DSH 原生实现。
- 调低模式胶囊选中态的亮度，浅色轨道上选中那半仍是深色小胶囊。
- 日常聊天的系统提示词补充 LaTeX 公式写法：行内用 `$...$`，独立成行用 `$$...$$`，回答中的公式由界面渲染。

### Fixed

- 修正「更多」展开区关闭方式的文档描述：只有点「收起」才关闭，点别处或按 `Esc` 不会。

[未发布]: <https://github.com/llql1211/DSH-DailyChat/compare/v0.4.0+upstream.0.3.1...HEAD>
[0.4.0+upstream.0.3.1]: <https://github.com/llql1211/DSH-DailyChat/compare/corlinniu:dsh-daily-chat:v0.3.1...v0.4.0+upstream.0.3.1>
