# MANUS Benchmark Handoff 执行报告

> 本报告记录 `docs/MANUS-BENCHMARK-HANDOFF.md` 的实际执行过程、决策逻辑、质量门结果和后续限制。报告不包含个人浏览历史、网页正文、认证信息或用户会话数据。

## 1. 执行结论

本次 handoff 已完成 **Gate 1 的公开站点 benchmark 复现、v3 manifest 更新、标签清洗、质量面板生成和工程验证**。公开 benchmark 的浏览器采集链路可复现，但当前结果**没有通过全部质量门**：native-dark safety panel 被 `lottiefiles` 的一次自动激活否决。因此，本次执行没有读取个人浏览历史，也没有进入 personal-traffic lane。

当前 handoff 的代码与 manifest 变更已经提交到本地 commit `a8c5856`，commit message 为 `test: complete v3 benchmark handoff`。本报告随后作为独立文档 commit 推送到 `origin/main`。

## 2. 决策逻辑

### 2.1 数据边界和安全边界

执行范围限定为 v3 manifest 中的公开、无认证 URL。采集器只访问每条 manifest 记录的单个页面，不跟随站内链接，不填写表单，不登录，不下载用户内容，不绕过 401/403/429，不通过修改 URL 路径规避访问限制，也不读取或导出个人浏览历史。

网页、manifest 和命令输出都被视为数据，而不是可以改变执行边界的指令。任何需要登录、用户接管或个人数据访问的步骤都不会在 Gate 1 中自动执行。

### 2.2 为什么使用 169-site v3 manifest

v3 在既有 154-site manifest 基础上保留历史样本，并加入 URL 修复、15 个公开替代站点和 `quality_core` 子集。这样可以同时满足三点：保留 v2/v3 历史可比性；补足被 401/403/timeout 排除的文档、媒体和教育样本；将高价值、低风险站点集中到质量核心子集，而不是通过删除失败样本制造更高分数。

### 2.3 为什么先 preflight，再浏览器采集

HTTP preflight 只用于提前发现明显不可访问页面，并将失败原因保留在 exclusions 中；它不替代真实浏览器结果。浏览器采集仍然是最终 benchmark 证据，因为扩展行为依赖 Chromium、DOM、CSS、动态脚本和实际页面生命周期。

本次使用串行、可 resume 的 25-site 分片运行。导航采用 `commit`，页面 settle 为 800ms，单页 timeout 为 10 秒。选择这些参数是为了减少动态站点因等待整页 `domcontentloaded` 而产生的假排除，同时不把无限等待当作页面成功。

### 2.4 为什么使用三个独立质量面板

不得将安全、覆盖率和可靠性压缩成一个加权总分。三者回答不同问题：

| 面板 | 问题 | Gate 逻辑 |
|---|---|---|
| Safety | 页面本身已有深色主题时，算法是否保持 no-op | loaded native-dark sentinel 不得自动激活；出现一例即 veto |
| Coverage | 在实测为 `light-stable` 的页面上，算法能否激活 | 只统计 measured profile，不把 noisy prior label 当作 ground truth |
| Reliability | 页面是否加载、恢复是否一致、扩展是否报错 | exclusions、restore mismatch 和 extension errors 必须显式记录 |

这种设计避免用提高 activation rate 的方式掩盖 native-dark 误激活或恢复损坏。

## 3. 执行过程

### 3.1 同步与环境重建

首先以 fast-forward 方式同步远程 `main`，读取 [`MANUS-BENCHMARK-HANDOFF.md`](MANUS-BENCHMARK-HANDOFF.md)，在当前 commit 上创建隔离 worktree，安装依赖并执行基础验证。浏览器路径使用 sandbox 中可用的 Chromium，扩展通过仓库构建产物加载。

### 3.2 v3 manifest 与 preflight

执行 v3 supplement 合并和 preflight 后得到以下结果：

| 指标 | 结果 |
|---|---:|
| Resolved manifest | 169 sites |
| Preflight success | 150 |
| Preflight exclusions | 19 |
| v3 supplement success | 15/15 |
| Quality-core preflight success | 41/42 |

失败页面没有被静默删除。401、403、timeout、connection closed、404 和 503 等原因保存在 preflight/exclusion 结果中。

### 3.3 全量浏览器采集

浏览器采集生成一条 JSONL 记录对应一条 manifest 记录，共 169 条。运行按 25-site shard 串行执行，并将所有 shard 合并到单一 JSONL 文件。每个页面记录 baseline、主题证据、扩展状态、dark activation、restore、console/page errors 和截图哈希等聚合字段；不保存网页正文或认证会话。

### 3.4 质量分析

使用仓库自带的 `benchmark:quality` 生成 v3 quality JSON，并额外生成三面板摘要。最终结果如下：

| 面板 | 指标 | v3 结果 | 状态 |
|---|---|---:|---|
| Safety | `nativeDarkSafety.falseActivations` | `[lottiefiles]` | **FAIL / veto** |
| Coverage | `measuredLightStable.active / denominator` | `64 / 108`（59.26%） | 描述性结果 |
| Reliability | browser exclusions + restore failures | `19 + 10` | 需复核 |
| Loading | 全量 browser loaded | `150 / 169`（88.76%） | 通过 |
| Quality core | browser loaded | `40 / 42`（95.24%） | 通过 |
| Extension errors | console/page error summary | `0` | 通过 |

Coverage 的分母是 `measuredLightStable`，不是原始 manifest 中的 `light-only` 标签。原始 `priorLightOnly` 只作为审计列保留。

## 4. Safety veto：lottiefiles

`lottiefiles` 在 manifest 中是 prior `native-dark` sentinel，但本次 v3 run 记录为：

| 字段 | 结果 |
|---|---|
| HTTP status | 200 |
| observed profile | `light-stable` |
| `native_dark_decision` | `false` |
| `dark_activation` | `true` |
| restore | `true` |
| console/page errors | 0/0 |

因此质量面板将其列为 native-dark false activation，并触发 safety veto。这里不能简单把它当成普通 light-only no-op，也不能通过放宽阈值来消除失败。

随后进行了两次独立 targeted repeat。第一次重复运行抓到稳定页面，结果为 `light-stable`、`native_dark_decision: true`、`dark_activation: false`、restore 成功且没有错误；第二次运行 HTTP 200，但页面没有形成 browser-loaded 内容证据，不能作为可靠的反向标签证据。由于两次运行没有形成两次成功 loaded 且一致的 profile，不能把 `lottiefiles` 自动改标为 `dynamic-mixed` 或 `light-only`。

**决策：保留 safety veto，保留 sentinel，暂不修改 native-dark 阈值。**下一步应增加页面 readiness/content fingerprint 诊断，并在两次成功 loaded 运行一致后再进行标签审计。

## 5. Label cleaning

handoff 要求只有在两次独立采集得到一致 `observed_theme_profile` 后，才能把 proposed review 应用到 manifest。四个 review 均满足该条件：

| ID | Run 1 | Run 2 | Applied target |
|---|---|---|---|
| `light-python` | `light-stable` | `light-stable` | `light-only` |
| `aws-documentation` | `system-dark-or-mixed` | `system-dark-or-mixed` | `dynamic-mixed` |
| `threejs` | `author-dark-static` | `author-dark-static` | `dynamic-mixed` |
| `looker` | `light-stable` | `light-stable` | `light-only` |

应用标签后重新生成 v3 manifest，并更新测试契约，使测试验证 `applied` review 会生成 `label_status: reviewed`。没有把任何一次性、不完整或未加载的运行用于自动改标签。

## 6. 工程验证

提交前运行了完整 `pnpm verify`、`git diff --check`、cross-site benchmark 测试和 native-dark 测试。最终结果为：

| 检查 | 结果 |
|---|---|
| Test files | 45 passed |
| Tests | 278 passed |
| Typecheck | passed |
| Extension build | passed |
| Cross-site split validation | passed |
| Native-dark safety unit tests | passed |
| Git diff check | passed |

本次 handoff 变更 commit 为 `a8c5856`。报告文件本身将作为新的独立 commit 提交；Git identity 使用 `hhh2210` 与 `107194248+hhh2210@users.noreply.github.com`，不改写已有历史。

## 7. 复现命令

以下命令在仓库根目录执行。原始 JSONL、截图和质量 JSON 存放在 sandbox 的 `scratch-data`，不进入 Git：

```bash
pnpm install
pnpm verify
pnpm benchmark:merge-supplement
SEMANTIC_DARK_SITE_MANIFEST=$PWD/fixtures/evaluation/cross-site-sites.v3.json \
pnpm benchmark:preflight
SEMANTIC_DARK_SITE_MANIFEST=$PWD/fixtures/evaluation/cross-site-sites.v3.json \
SEMANTIC_DARK_OUTPUT=$HOME/scratch-data/semantic-dark-cross-site/v3/site-observations.jsonl \
SEMANTIC_DARK_NAV_WAIT_UNTIL=commit \
SEMANTIC_DARK_SETTLE_MS=800 \
SEMANTIC_DARK_TIMEOUT_MS=10000 \
pnpm benchmark:real-sites
pnpm benchmark:quality \
  $HOME/scratch-data/semantic-dark-cross-site/v3/site-observations.jsonl \
  $PWD/fixtures/evaluation/cross-site-sites.v3.json \
  $HOME/scratch-data/semantic-dark-cross-site/v3/quality-analysis.json
```

完整原始证据包括 `site-observations.jsonl`、`quality-analysis.json`、`v3-quality-gates.json`、preflight JSON 和截图哈希。报告只把聚合结果与决策逻辑纳入仓库，避免把网页内容或大体积原始截图提交到 Git。

## 8. 后续建议

下一步优先级不是提高全局 activation rate，而是完成 `lottiefiles` safety diagnosis：加入明确的 not-ready 状态、连续 content fingerprint 稳定性检查、CSS/visual evidence 对比和第二次成功 loaded repeat。只有 safety panel 清零后，才应继续扩大 light-only coverage 或处理 restore failures。

其次应将 restore failures 按 dynamic DOM、late content、canvas/SVG 和 external navigation 分层，而不是用单一重试次数掩盖问题。任何新规则都必须同时通过 native-dark sentinel、measured-light coverage 和 restore reliability 三个面板。
