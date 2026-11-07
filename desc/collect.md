## 任务

收尾 vibe99ctl CLI 系列（VIB-379~384）：按依赖顺序合并全部 6 个 PR，处理冲突与失败项，完成后统一回报。

## PR 清单与顺序

1. #410 (VIB-379 地基修复) → 2. #411 (VIB-381 settings) → 3. #408 (VIB-382 profiles) → 4. #407 (VIB-383 describe) → 5. #409 (VIB-380 安装分发，windows-build 当前红) → 6. #412 (VIB-384 enhance)

## 规则

- 每合一个前重新确认 mergeable；冲突则让对应 coder rebase（或自行 rebase 处理）。
- CI 红的 PR 不直接合入 main：先看失败原因，能明确判定为该 PR 引入的让 coder 修复；判定与修复过程记录在本 issue。
- 全部合完后逐个确认 issue 状态、在父 issue VIB-378 汇总，回报用户。
