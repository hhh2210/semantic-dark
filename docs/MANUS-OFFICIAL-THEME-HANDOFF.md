# Manus 续做：官方暗色开关的现场确认

给后续 Manus / 浏览器 agent。**代码侧已经把能安全自动化的开关推到当前极限**；下面这些站点或挂件，公开资料不够、或必须看 live DOM / cookie / 账户菜单才能确认怎么切。你的任务是**操作浏览器**把开关合同记下来，不要登录、不要提交表单、不要绕过 401/403、不要把 cookie/localStorage 写进用户账号当长期偏好，除非只是在当前 profile 里做可还原的探测并在离开前还原。

代码仓库里已有的实现见 [OFFICIAL-THEME.md](OFFICIAL-THEME.md)。不要在 Git 里堆站点 CSS 补丁。交付物是 JSON 配方 + 这份文档的更新，原始截图放到 `~/scratch-data/semantic-dark-official-theme/`。

## 代码已经覆盖（不要重复发明）

自动模式在系统暗色下：

1. 页面已经是 native-dark → no-op
2. 浅色页若能**可逆**地打开官方暗色，且**视觉上真的变暗** → `official-dark`，Semantic Dark 引擎保持关闭
3. 打不开或不真变暗 → 还原快照，走变换车道

已经实现、**不需要你再点浏览器验证也能用**的：

| 类型 | 合同 |
| --- | --- |
| 通用属性 | 根节点 `data-theme` / `data-color-mode` / `data-bs-theme` / `theme` / `lab-style` / `data-theme-mode` 的 `light` `day` `auto` `system` → `dark`/`night` |
| 布尔属性 | 已存在的 `dark="false"` / `data-dark-mode="false"` → `true`（**不会**凭空给 html 加 `dark=""`） |
| 通用 class | `light-theme` / `theme-light` / `light-mode` / `day` 等精确 token 换成暗色对应项 |
| 备用样式表 | `rel=alternate stylesheet` 且 title 含 Dark/Night，或 `prefers-color-scheme: dark` 被 `disabled`/`media=none` |
| 种子 | 知乎 `html[data-theme=dark]`；B 站 `html.dark`+`body.dark`+`lab-style=dark`；掘金 `data-theme`+`.dark-theme` |
| 确认门 | 只认视觉变暗。我们自己写下的 dark marker **不够** |

不要点按钮。不要改 URL `?theme=dark`。不要为了“看起来暗了”去点 Darkmode.js / Dark Reader 挂件。

## 你要交付什么

对每个下列站点（能打开的公开首页即可）产出一份 JSON，放到 scratch，不要把整页 HTML 提交进 Git：

```json
{
  "id": "youtube",
  "url": "https://www.youtube.com/",
  "loaded": true,
  "already_dark": false,
  "official_capable": true,
  "confidence": "high",
  "html_attrs_before": {},
  "html_class_before": "",
  "body_attrs_before": {},
  "body_class_before": "",
  "cookies_theme_keys": ["PREF"],
  "localStorage_theme_keys": [],
  "recipe": {
    "safe_for_extension": true,
    "mutations": [
      {"type": "attribute", "target": "html", "name": "dark", "value": ""}
    ],
    "notes": "setting html[dark] actually restyles ytd-app; cookie PREF is persistence only"
  },
  "rejected_approaches": [
    "do not click the Darkmode.js widget",
    "do not write PREF cookie from the extension without restore proof"
  ],
  "visual_after_recipe": "native-dark",
  "spa_overwrite": false
}
```

`safe_for_extension` 为 true 的条件：只改 html/body 属性或 class、或启用已有 stylesheet；改完页面**肉眼/采样变暗**；关掉扩展或还原属性后能回到浅色；SPA 5 秒内没有把标记抢回浅色。需要写 cookie / localStorage / 点击菜单才能稳住的，`safe_for_extension=false`，把键名记下来即可，**不要**让编码 agent 猜着写进 catalog。

两次独立 loaded 结果一致才能把配方升级进 `src/content/official-theme-catalog.ts`。一次成功一次失败 → 留在 handoff，不要改代码。

## 现场怎么探（按这个顺序）

系统外观先切到 **dark**。打开站点，等主内容出来（不要登录）。

1. 记录 `html`/`body` 的 attributes + classList。
2. DevTools Application：名字里带 `theme` / `dark` / `night` / `mode` / `skin` / `PREF` 的 cookie 和 localStorage **只读列出键和值**，不要先改。
3. 在控制台只做可还原探测，每次改完看 `getComputedStyle(document.body).backgroundColor` 和一张主卡片：
   - `document.documentElement.setAttribute('data-theme','dark')`
   - 同样试 `data-color-mode`、`theme`、`classList.add('dark')`、`setAttribute('dark','')`
   - 失败就立刻还原该次改动
4. 如果页面上有「外观 / 夜间模式 / Dark theme / 深色模式」菜单：**可以点一次看它改了什么 DOM/存储**，然后把菜单改回浅色。不要点第三方 Dark Mode 悬浮球。
5. 截图：浅色基线、成功官方暗色、失败的一次尝试。文件名用站点 id。

## 不确定、必须你来看的问题

### 1. YouTube

公开资料说账户菜单里的 Appearance，以及有人靠 cookie `PREF` 和 `html[dark]`。代码**没有**给每个站点瞎加空的 `dark` 属性。

请确认：未登录首页，只设 `html[dark]` 或 `html[dark=true]` 会不会让 Polymer/`ytd-app` 真的换成官方暗色变量。如果必须写 `PREF` 才能稳住，记 cookie 形态和还原方法，`safe_for_extension=false`。

### 2. 「Dark Mode」挂件 / Darkmode.js / 说不清的 bdbd darkmode

用户日常里会碰到页面上一个叫 Dark Mode 的按钮，或 mix-blend 反色层（Darkmode.js：`.darkmode-toggle`、`.darkmode-layer`、`darkmode--activated`）。**这不是站点官方主题。**

请在遇到时：

- 截图挂件 DOM
- 确认它是不是 `sandoche/Darkmode.js`、Dark Reader、Stylus、还是站点自己的夜间模式
- 不要当官方开关交给 catalog
- 若你能定位用户说的 **bdbd darkmode** 具体是哪个产品/站点（可能是百度系、某个油猴、或口误），把 URL 和根节点合同写进 scratch JSON 的 `id`

### 3. B 站 cookie `theme_style`

代码现在只加 `.dark` / `lab-style`。请在 www / t / live / space 各开一次（能 loaded 的）：

- 只加 class，不写 cookie，刷新或点进视频后官方暗色是否还在
- `theme_style=dark` 会不会同步账号偏好
- live 是否必须 `html[lab-style=dark]` 而 www 加了会不会有副作用

若 class 在 SPA 里被抢回浅色，记发生时间和调用栈线索（哪个脚本），不要为了稳住去写 cookie，除非还原实验完整。

### 4. 知乎 SPA 回写

代码设 `data-theme=dark`。请确认 React 水合后会不会写回 light。若会，记录是否还有 `?theme=dark` / cookie，**不要**让扩展改 URL。

### 5. 微博 weibo.com

网上有 `data-theme` 的二手描述，真伪不明。请看 www.weibo.com 公开页根节点和外观入口。登录墙就标 `loaded:false` 停。

### 6. 小红书 xiaohongshu.com / 豆瓣 douban.com / 百度 baidu.com

这三家是否有第一方网页暗色，开关是 class、属性、还是只有 App。百度尤其可能和「bdbd darkmode」有关，重点看。

### 7. Twitter / X

Lights out / Dim 很像官方暗色，但多半是账户设置。未登录时根节点有没有 `data-theme` 之类可逆标记？没有就 `official_capable:false`。

### 8. V2EX / linux.do / Discourse 站点 / 少数派 sspai.com / CSDN

常见是账号偏好或 `localStorage`。只记录键名和 DOM 效果；`localStorage` 默认 `safe_for_extension=false`（扩展关掉后会留在用户浏览器里，除非你证明 restore 能删干净且站点不会再写回）。

### 9. Notion / Discord

Discord 网页几乎总是暗的，应被 native-dark no-op。Notion 主题是否只在 localStorage。能打开的公开页测一次即可。

### 10. 淘宝 / 京东 / 抖音 / 今日头条网页

很可能没有完整官方网页暗色。确认后标 `official_capable:false`，交给变换车道，不要编配方。

## 明确不要做的事

- 不要放宽 native-dark 阈值
- 不要为失败站点写自定义 CSS
- 不要点 cookie 横幅以外的同意按钮（consent 规则与 benchmark handoff 相同：文案完全匹配才点）
- 不要把 Darkmode.js 的 `mix-blend-mode: difference` 当成官方暗色
- 不要在 Git 提交 raw HTML/截图；只提交：你确认过、两次 loaded 一致、且 `safe_for_extension=true` 的 catalog 种子，或更新本 handoff 的结论表

## 做完后怎么把结论交回

1. scratch 目录写下 `sites.json`（数组，每站一条上面的 schema）
2. 更新本文件末尾「现场结论」表：id / official_capable / safe_for_extension / 一句话合同
3. 只有 `safe_for_extension=true` 且两次一致的项，才值得改 `official-theme-catalog.ts`

## 现场结论

（Manus 填。编码 agent 未跑 live 站点。）

| id | official_capable | safe_for_extension | contract |
| --- | --- | --- | --- |
| youtube | ? | ? | html[dark] vs PREF cookie |
| weibo | ? | ? | |
| xiaohongshu | ? | ? | |
| douban | ? | ? | |
| baidu | ? | ? | 是否即 bdbd darkmode |
| twitter | ? | ? | |
| v2ex | ? | ? | |
| linux.do | ? | ? | |
| sspai | ? | ? | |
| csdn | ? | ? | |
| notion | ? | ? | |
| taobao | ? | ? | 预期无官方网页暗色 |
| darkmode-js-widgets | false | false | 第三方反色层，不是官方主题 |
| zhihu-spa-overwrite | ? | ? | data-theme 是否被水合写回 |
| bilibili-theme_style | ? | ? | class 是否够，cookie 是否必要 |
