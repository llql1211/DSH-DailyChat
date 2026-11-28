# 关于这个 fork

`llql1211/DSH-DailyChat` 是 [corlinniu/dsh-daily-chat](https://github.com/corlinniu/dsh-daily-chat) 的 fork。上游负责插件本体；这个 fork 只收纳本地定制：侧边栏的「聊天 / 工作」模式胶囊、`Ctrl+Alt+D` 切换快捷键、日常会话行的原生「更多」与状态点，以及日常人格里的 LaTeX 公式提示词。

插件做什么、怎么装、怎么用，仍以 [README](../README.md) 为准；本文只讲 fork 的定位、基线和维护方式。

## 基线与分支

- 上游基线是 `v0.3.1`，对应 `upstream/main` 的 `0.3.1` 提交。
- `upstream-main` 是跟随上游 `main` 的本地分支，只用来拉取和对照，不在上面开发。
- `main` 是本 fork 的主线，也是 GitHub 上的默认分支；所有 fork 改动从这里发布。
- 切换上游基线时：在 `upstream-main` 上拉取上游，再合并或变基回 `main`，并在变更日志里记一条基线切换。

## 版本与发布

- 版本格式是 `A.B.C+upstream.X.Y.Z`：前半是 fork 自己的版本，后半是所基于的上游版本。当前为 `0.4.0+upstream.0.3.1`。
- git tag 带 `v` 前缀，例如 `v0.4.0+upstream.0.3.1`。
- 用户可见的改动写进 [FORK_CHANGELOG.md](./FORK_CHANGELOG.md)：平时先记在「未发布」节，发布前整理成版本节并补 compare 链接。
- 推送 tag 后，`.github/workflows/release.yml` 会从变更日志里取出对应版本的正文，自动创建 GitHub Release；tag 在日志里没有对应条目时会报错，不会静默发版。
- 上游的 `CHANGELOG.md`、`CONTRIBUTING.md` 和发布资产不改写；`README.md` 除开头一行 fork 导航外保持上游内容。
- 改动被上游收录后，给变更日志里的原条目加删除线，注明收录版本、日期与 PR 号；必要时补「上游收录情况」小节。

## 维护约定

- 提交保持原子性，一个提交只做一件事，信息遵循 Conventional Commits：类型与标识符用英文，标题用中文。
- 提交前做自检并跑相关检查。仓库没有构建步骤；改完刷新页面即可，不生效就重启 `dsh web`。
- 不主动提升版本号，除非要发一个 fork 版本；已发布的 tag 和版本号不改写、不重命名。
- `FORK.md` 只在基线切换、fork 定位或整体差异变化时修订；逐条流水账放在 `FORK_CHANGELOG.md`。
