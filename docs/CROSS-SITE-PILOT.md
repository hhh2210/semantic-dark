# Cross-Site Dark-Mode Pilot

本 pilot 用于验证 Semantic Dark 在公开网站上的主题识别与可逆性，不把任意网页截图当作像素级 ground truth，也不把网页正文或用户数据纳入训练。原始截图、DOM 快照和逐节点诊断保存在本地 `~/scratch-data/semantic-dark-cross-site`，仓库只保留站点 manifest、采集器和聚合协议。

## Scope and protocol

采集器 `scripts/collect-real-sites.mjs` 使用本地 Chromium + Playwright，以 `1440×900`、device scale factor 1、无认证、低速顺序访问 32 个固定公开 URL。每个 URL 会记录浅色系统基线、深色系统基线、扩展开启后的自动决策、主题切换后的恢复状态、截图 SHA-256 和聚合计算样式；它不会递归跟随站内链接、提交表单或执行页面提供的下载操作。HTTP 4xx、导航超时和没有稳定响应的页面会被排除出主指标。

```bash
pnpm build
SEMANTIC_DARK_SITE_MANIFEST=$HOME/semantic-dark/fixtures/evaluation/cross-site-sites.v1.json \
SEMANTIC_DARK_OUTPUT=$HOME/scratch-data/semantic-dark-cross-site/metrics/site-observations.final.v1.jsonl \
SEMANTIC_DARK_SETTLE_MS=1000 \
SEMANTIC_DARK_TIMEOUT_MS=12000 \
node scripts/collect-real-sites.mjs
```

manifest 中的 `expected_layer` 是采集前的工作假设，不是算法答案。复核时还要看 `light_baseline`、`dark_baseline` 和 `activation_match`。例如 Python.org 同时含有深色 banner、白色 body、代码块和图片，因而应视为 `dynamic-mixed` 诊断样本，而不应被强行当作纯 `light-only`。

## Dataset strata

| Stratum | Candidate count | Eligible in final run | Intended safety question |
|---|---:|---:|---|
| `native-dark` | 10 | 10 | 自动模式是否保持 no-op，不修改作者已有的深色页面 |
| `light-only` | 10 | 8 | 浅色正文、表格、链接和控件是否能激活并保持可读性 |
| `dynamic-mixed` | 12 | 11 | 混合 canvas、主题开关、媒体、图表和代码区域如何分别处理 |

最终第二轮运行共有 32 个候选、29 个可纳入页面和 3 个排除页面。排除的是 `https://www.npmjs.com/`、`https://stackoverflow.com/` 与 `https://openai.com/` 的 HTTP 403 响应；没有为了获得内容而绕过访问限制。

## Baseline and candidate result

优化前与最终候选均使用同一 manifest、同一视口和同一顺序访问。两轮结果只用于工程性比较，不代表全 Web 的统计泛化。

| Metric | Baseline | Final candidate | Interpretation |
|---|---:|---:|---|
| Eligible pages | 29 | 29 | 站点可访问性基本一致 |
| `native-dark` no-op | 10/10 | 10/10 | 未观察到 native-dark 哨兵误激活 |
| `light-only` activated | 2/8 | 4/8 | Hacker News 与 W3C 从 ambiguous/no-op 变为 light activation |
| `light-only` restore equal | 8/8 | 8/8 | 浅色候选均恢复到无扩展状态 |
| `dynamic-mixed` restore equal | 9/11 | 10/11 | Svelte 的一次恢复差异不再复现；Observable 仍为 open-existing |
| extension errors | 0 | 0 | 采集期间未出现扩展异常 |

“activated”只表示主题控制器进入 `applied-light` 路径，不等于页面视觉质量已被证明。当前采集器的逐节点 contrast 汇总仍会受到透明元素、局部背景图和混合页面结构影响；正式安全结论必须回到现有机制 fixtures、专门的对比度断言和人工复核，不能把该汇总字段直接当成 WCAG 结论。

## Algorithm change

`src/content/native-dark.ts` 现在额外区分 `declaredLight` 与 `lightCanvas`。当页面明确声明 `color-scheme: light` 或等价 meta、body/html 存在不透明浅色 canvas、没有 dark root marker、且系统没有 negotiated dark 时，即使九点采样被背景图遮挡或样本稀疏，也可以安全地判定为 `light`。同时，强浅色判定的最小样本数从 5 调整为 4；强深色、dark marker、forced-colors 和未知背景的 fail-closed 优先级保持不变。

这个边界避免了候选优化中观察到的 Carbon 回归：仅凭显式 light 线索会误激活一个原生深色主题示例页；加入 `lightCanvas` 后，Carbon 在关键回归和最终 32 站点运行中均恢复为 no-op。采样器仍拒绝无法解释的 `background-image` 合成色，因此不会因为本 pilot 而放宽对远程图片、视频、canvas 或未知图层的保护。

## Verification

提交前运行结果如下：

```text
pnpm verify  -> passed
  44 test files passed
  262 tests passed
  typecheck passed
  build passed
pnpm e2e      -> passed
  console messages: 0
  page errors: 0
  native-dark inactive: true
  forced restore removed owned state: true
  table gradient and pseudo rails: true
```

这些结果证明候选版本通过了仓库已有的机制和 E2E 回归；它们不等于对 32 个真实网站的统计显著性证明。`mixed-observable` 的恢复差异仍作为 open-existing 问题保留，不能用其他页面的平均结果抵消。

## Reproducibility and privacy

重跑时应记录仓库 commit、Chromium version、采集时间、manifest hash、viewport、HTTP status、截图 hash 和排除原因。原始网页内容和截图不应提交到 Git。该 pilot 遵循仓库既有隐私边界：扩展本身不向外发送 DOM、文本、图片像素、浏览历史、Cookie 或 telemetry。
