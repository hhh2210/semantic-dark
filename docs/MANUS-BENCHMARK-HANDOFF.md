# Manus 续做：cross-site benchmark 采集与清洗

给后续 Manus / 采集 agent 用。不要改评分公式去“刷成功率”，也不要登录、爬站内链接、提交表单或绕过 401/403。

## 当前结论（先读这个）

第一轮 v3 已经跑完，数字冻在 `fixtures/evaluation/cross-site-v3-run.v1.json`，过程见 [MANUS-BENCHMARK-HANDOFF-RESULT.md](MANUS-BENCHMARK-HANDOFF-RESULT.md)。

| Panel | 结果 | 状态 |
|---|---|---|
| Loading | 150/169 loaded（88.76%）；quality-core 40/42（95.24%）；supplement 15/15 preflight | 通过 |
| Coverage | `measuredLightStable` **64/108（59.26%）**，高于 v2 的 4/114 自动激活 | 描述性提高 |
| Safety | `falseActivations = [lottiefiles]` | **veto，未通过** |
| Reliability | 19 exclusions + 10 restore failures | ID/原因留在 scratch，未删站点 |

四个独立复核标签已 applied：`light-python → light-only`，`aws-documentation → dynamic-mixed`，`threejs → dynamic-mixed`，`looker → light-only`。

**下一步只做 `lottiefiles` 诊断。** 不要放宽 native-dark 阈值，不要删 sentinel，不要为了覆盖率发明加权总分。两次 targeted repeat 不一致（一次 light-stable no-op，一次未 loaded），因此还不能改标。

v2 的 2/38 同时被标签噪声和过严检测压低；覆盖率分母必须继续用测量到的 `light-stable`。

## 你要交付什么

按顺序做。每一步把原始产物写到 `~/scratch-data/semantic-dark-cross-site/`，Git 只提交 manifest / 排除表 / 聚合文档。

### 1. 生成并预检 v3

```bash
pnpm install
pnpm benchmark:merge-supplement
# 写出 fixtures/evaluation/cross-site-sites.v3.json

SEMANTIC_DARK_SITE_MANIFEST=$PWD/fixtures/evaluation/cross-site-sites.v3.json \
  pnpm benchmark:preflight \
  fixtures/evaluation/cross-site-sites.v3.json \
  $HOME/scratch-data/semantic-dark-cross-site/preflight-v3.json
```

记录 `ok_count / excluded_count / by_status`。新站点（`source: v3-supplement`）和 `ikea-sofas` 修复 URL 必须单独列表。

**通过线：** 新 15 站里至少 12 个 `preflight_ok`。失败的写入 exclusions，不要改 URL 硬撞 403。

### 2. 浏览器采集（可分片、可 resume）

先 `pnpm build`。默认会读 v3 manifest（若已生成），Chrome UA，resume 开启，consent 按钮只点文案完全匹配的 Accept / I agree / Allow all / OK。

```bash
pnpm build
SEMANTIC_DARK_SITE_MANIFEST=$PWD/fixtures/evaluation/cross-site-sites.v3.json \
SEMANTIC_DARK_OUTPUT=$HOME/scratch-data/semantic-dark-cross-site/v3/site-observations.jsonl \
SEMANTIC_DARK_START_INDEX=0 \
SEMANTIC_DARK_MAX_SITES=25 \
SEMANTIC_DARK_NAV_WAIT_UNTIL=commit \
SEMANTIC_DARK_SETTLE_MS=800 \
SEMANTIC_DARK_TIMEOUT_MS=10000 \
pnpm benchmark:real-sites
```

中断后原命令重跑即可（`SEMANTIC_DARK_RESUME=0` 才会重写）。不要并行多进程写同一个 JSONL。

**通过线：**

- quality-core（supplement 里的 `quality_core_ids`）浏览器 loaded ≥ 90%
- 全量 loaded ≥ 80%
- native-dark 先验样本 **0 次**自动激活
- extension_error = 0

### 3. 质量面板（这是成功率的定义）

```bash
pnpm benchmark:quality \
  $HOME/scratch-data/semantic-dark-cross-site/v3/site-observations.jsonl \
  $PWD/fixtures/evaluation/cross-site-sites.v3.json \
  $HOME/scratch-data/semantic-dark-cross-site/v3/quality-analysis.json
```

只把下面三个数写进 `docs/CROSS-SITE-BENCHMARK-V2.md` 的 v3 run 表，不要发明第四个加权总分：

| Panel | 指标 | 目标 |
|---|---|---|
| Safety | `nativeDarkSafety.falseActivations` | `[]` |
| Coverage | `measuredLightStable.active / denominator` | 高于 v2 的 4/114 自动激活；**不要**用 prior light-only 当分母 |
| Reliability | browser exclusions + restore failures | exclusions 标明原因；restore 失败保留 ID |

`priorLightOnly` 只作为标签审计列。

### 4. 清洗标签（先测量，后改 JSON）

`cross-site-sites.v3-supplement.json` 里四个优先 review 已经 `applied`。其余先验 light-only（`apple-iphone-store`、`awwwards`、`dribbble` 等）仍按下面规则处理：

- 仅当两次独立采集的 `observed_theme_profile` 一致，才把对应 review 改成 `status: applied` 并填 `to`
- `light-stable` → 保持或改为 `light-only`
- `system-dark-or-mixed` / `author-dark-static` → `dynamic-mixed` 或 `native-dark`
- 不要因为“我们希望它激活”就标 `light-only`
- 改完跑 `pnpm benchmark:merge-supplement`，测试必须仍然 family-disjoint

优先复核这些先验 light-only（v2 文档已暗示它们不可靠）：`light-python`、`aws-documentation`、`threejs`、`looker`、`apple-iphone-store`、`awwwards`、`dribbble`。

### 5. 补位被挡站点（replacement_queue）

队列在 supplement 里。原则：

- **同 page_type、新 `site_family`、公开无登录 URL**
- 先 preflight，200–399 才能进 `new_sites`
- 分片用现有 FNV-1a：`fnv1a32(site_family) % 100 < 20` → `held-out`；若 family 已在 v2，继承原 split
- 禁止：登录墙、验证码绕过、付费墙、地区商店死链、同一 host 再塞一条“换路径”

高价值缺口（当前 exclusions）：

| 缺口 | 不要再试 | 方向 |
|---|---|---|
| 设计工具 | Canva 403 | 开源设计工具文档/营销页 |
| 媒体库 | Unsplash 401 / Pexels 403 | Commons 已补；不要再追图床 CDN |
| 新闻 | Reuters 401 / NPR timeout | Wikinews 已补；可试公益新闻室 |
| 电商 | adidas/expedia 403 | 等 IKEA 主页浏览器跑通再加店 |
| .gov | NIH/Census 403 | loc.gov 已补；403 就停 |
| 社区编辑器 | CodePen 403 | 公开 landing，不要打开用户 pen |

每加一条：稳定 `id`、`reason`、`access_risk`、`features`。然后更新 `quality_core_ids` **仅当**它是低风险 docs/education/sentinel。

### 6. 可选：对照 detector 回归

若 v3 采集显示 measured light-stable 仍大量 no-op，用 `pnpm diagnose:native-dark` 只打 quality-core 的 light 文档，把 `knownSamples` / `lightCanvas` / `negotiatedDark` / `reason` 存 JSON。**不要**为此放宽 native-dark 阈值或把 `implicitLight` 的 `knownSamples` 降到 0。

## 明确不要做

- 不把截图、DOM、JSONL 提交进 Git
- 不改 `ROLE_PROFILES`、不开 M2/M3、不上 ONNX
- 不把 coverage 和 safety 合成一个分数
- 不删除 v2 站点 ID；排除过的 ID 留在 exclusions
- 不为了凑 100+ 站点再扫一批会 403 的品牌站

## 建议提交

1. 更新后的 supplement（applied reviews、真正 preflight 过的 new_sites）
2. 重新生成的 `cross-site-sites.v3.json`（若选择入库）或 exclusions 增量
3. `docs/CROSS-SITE-BENCHMARK-V2.md` 增加 **First v3 run** 表（safety / measured coverage / exclusions）
4. 本文件勾掉已完成的 queue 项

相关代码：`src/content/native-theme-evidence.ts`（判定）、`src/testing/cross-site/`（split / 质量面板）、`scripts/collect-real-sites.mjs`（采集）。
