# 见行修学网站（本仓库）

GitHub：https://github.com/yanyanzhou123/jianxing-web  
本 README 随仓库维护，上传 GitHub 时请一并提交，避免产品线混淆。

## 产品线总览（务必分清）

见行体系目前有 **三条产品线**，域名 / 仓库 / 能力不同，改功能前先确认改的是哪一条：

### 1. 见行修学网页（本仓库 · 主站）

| 项 | 说明 |
|------|------|
| 域名 | https://jianxing.win（国外）+ https://jianxing.xin（国内备案） |
| 仓库 | **本仓库** `jianxing-web`（本地目录常为 `加行网站`） |
| Cloudflare Pages | 项目名 `jianxing` |
| R2 | 桶 `jianxing-files`（公开前缀以环境变量 `PUBLIC_R2_BASE` 为准） |
| 定位 | 公开学修站：课表、听读/音视频、运营后台、见行解惑（检索卡 + DeepSeek）等 |
| 域名接入 | `jianxing.win` 直接绑 Cloudflare Pages；`jianxing.xin` 经反代访问 Pages 内容（此前为 CNAME，因国内访问问题已改反代） |
| 当前代码版本 | 见下方「版本」；`package.json` 以仓库为准 |

### 2. 慧灯净土（独立站 · 另目录另部署）

| 项 | 说明 |
|------|------|
| 域名 | https://huidengjingtu.win （旧子域名 jingtu.jianxing.win 可过渡） |
| 品牌 | **慧灯净土**（首页：一心念佛，往生净土） |
| 源码 | 本地目录 `d:\cursor\净土网站`（由见行 v1.3.1 完整复制后改身份） |
| Cloudflare Pages | 项目名 `jingtu` |
| R2 / D1 | `jingtu-files` / `jingtu-app`（与见行隔离） |
| 本仓库 | **不含**净土站源码；勿在本仓库直接改净土站 |

### 3. 自学 App（安卓壳 · 挂主站学习中心）

| 项 | 说明 |
|------|------|
| 形态 | Capacitor 安卓工程（本仓库 `android/`）+ 网页学习中心 https://jianxing.win/app/ |
| 包名 | `win.jianxing.app` |
| 能力 | 用户名密码账号、个人学习进度（Cloudflare D1 `jianxing-app`）；内容仍读主站课表 |
| 说明文档 | [安卓App说明.md](./安卓App说明.md) |
| 注意 | App 打开的是**见行主站**学习中心，不是净土子域名 |

```text
jianxing.win            ← 产品线 1：见行修学网页（本仓库）
huidengjingtu.win       ← 产品线 2：慧灯净土（目录 净土网站，Pages 项目 jingtu）
安卓 App                ← 产品线 3：壳 + /app/（账号进度；内容走主站）
```

---

## 本仓库：见行修学网页

面向学修内容的静态站点 + 运营可配置后台。目录与媒体存放于 Cloudflare R2，运营保存后前台刷新即可，无需为改内容重新部署。

## 版本

**v1.3.6**（2026-08-17）

相对 v1.3.5 的主要变化（运营后台与本地视频工作台）：

- 运营后台网页不再做 AAC/720p 转码；改为下载「见行视频工作台」，高清/标清分开上传，替换高清会清空旧标清
- 问题反馈改为与学修/书籍/好文并列的 tab；列表与正文分栏；问答索引只出现在学修页底部
- 运营页顶部说明收成左右栏；登录条登录后会收起
- 运营进后台先拉 lite 课表出列表，课文后台加载，并在本机会话缓存，避免每次卡几秒
- Windows 见行视频工作台：课表检查、备份、出标清、单文件处理、切割；打包脚本 `build.py`；安装包仍在 R2 `media/jianxing-video-helper.zip`
- `package.json` 版本 **1.3.6**

**v1.3.5**（2026-08-17）

相对 v1.3.4 的主要变化（国内打开变慢、视频首播、标清档）：

- 列表页改拉 `/api/catalog?lite=1`（约几十 KB，缓存 120 秒），不再每次拉完整课表（约 2MB、`no-store`）；学习页用 lite + `/api/catalog?mod=&id=` 只取一课正文
- 课字段增加 `videoPathSd`；学习页有标清时默认播标清，可切高清；下载页同时列出两档；运营后台可看/改标清路径
- Windows「见行视频助手」：本机检查编码，按需 faststart / 转 AAC / 转 H.264，默认不压画；安装包在 R2 `media/jianxing-video-helper.zip`
- 既有高清课批量转 480p + AAC 128k + faststart，写回 `videoPathSd`（批处理仍在本机跑，进度见下方专节）
- `package.json` 版本 **1.3.5**

方案、批处理进度与后续计划见下方「视频播放、标清与国内访问」。

**v1.3.4**（2026-08-11）

相对 v1.3.3 的主要变化（问题反馈 + 域名接入调整）：

- 新增 `/feedback/` 页面：分「修行问题」「系统问题」两类，表单含内容（5–2000 字）与提报人邮箱；按 IP 限流 5 次/分钟
- 新增 API `/api/feedback`：POST 公开提交、GET 运营鉴权查看、PATCH 标记状态（new / read / archived）
- 数据落 D1 新表 `feedback`（迁移 `migrations/0002_feedback.sql`，需执行 `npm run db:migrate:feedback`）
- 运营后台 `/ops/` 新增「问题反馈」折叠面板：按类型/状态筛选、查看列表、标记已读/归档
- 顶部导航增加「问题反馈」入口
- 域名接入调整：`jianxing.xin` 由 CNAME 改为反代方式访问 Cloudflare Pages 内容（解决国内访问问题）；`jianxing.win` 不变
- `package.json` 版本 **1.3.4**

**v1.3.3**（2026-08-07）

相对 v1.3.2 的主要变化：

- 公安备案通过后，`jianxing.xin` 恢复完整见行站（移除 `functions/_middleware.ts` 占位拦截）
- 新增 `tools/r2-backup/` 本地 R2 整桶备份工具（脚本与说明；含密钥的 exe/源码不入库）
- `package.json` 版本 **1.3.3**

**v1.3.2**（2026-08-05）

相对 v1.3.1 的主要变化（备案与多域名）：

- 页脚展示 ICP 备案号（`京ICP备2026033921号-2`），链至工信部备案查询
- `jianxing.xin` 公安备案期间整站返回极简占位页（`public/beian/` + `functions/_middleware.ts`）；`.win` 不受影响；可用环境变量 `XIN_PLACEHOLDER=0` 关闭
- README 产品线说明：净土站改为独立域名 **huidengjingtu.win** / 本地目录 `净土网站`
- `package.json` 版本 **1.3.2**

**v1.3.1**（2026-08-04）

相对 v1.3.0 的主要变化（手机体验与缓存稳定性）：

### 手机布局
- 顶栏小屏改为 **汉堡菜单**（断点约 900px）；避免导航折两行
- 首页「次第台阶」在手机改为 **纵向分区列表**（电脑仍保留台阶）
- 学习页手机：**顶部横 Tab**（视/听读/音）+ 细音频条整行可拖 + 目录抽屉；目录与「问」分居左右下角
- 触屏设备额外强制走手机布局（`hover: none` + `pointer: coarse`），缓解荣耀等浏览器「手机版仍按宽屏排」的问题
- 学修模块页 / 学习页增加轻量返回链（← 返回学修 / ← 返回课次列表）
- 下载表可横滑；研讨/参考卡片与按钮加大点按区

### 缓存与 Service Worker
- SW 仅拦截 `/app/`，不再拦截主站 CSS/JS，避免样式被错误回退成 HTML（白底蓝链）
- 注册时强制检查更新；`sw.js` 短缓存头

### 工程
- `package.json` 版本 **1.3.1**

**v1.3.0**（2026-07-31）

相对 v1.2.1 的主要变化（换电脑开发请先读本节）：

### 研讨 `/yantao/`
- **堪布考问**：按课表选题考问（DeepSeek）；占位课不可考
- **佛学圆桌**：多角色研讨对话
- API：`/api/yantao/exam`、`/api/yantao/seminar`；前台脚本 `public/yantao-*.js`

### 参考资料拆分
- 前台分为 **参考书籍**（`/reference/books/`）与 **公众号好文**（`/reference/articles/`）
- 参考书籍仍在课表 `catalog.references`；公众号好文独立存 R2 `config/article-collections.json`，经 `/api/articles` 读写
- 「见行选读」前台文案改为 **见行选修**；书籍材料不再挂在学修楼梯区

### 学修分区（运营可选）
- 模块可设 `section`（基础课 / 公共学修 / 专业课 / 实修篇 / 见行选修 / 未归类）与可选 `sectionGroup`（专业课子组）
- 前台按分区字段渲染；未设置时回退旧 slug 名单
- 运营侧栏按分区分组；未归类模块会出现在「未归类 / 其他」

### 运营后台 `/ops/`
- 顶部工作区：**学修 / 参考书籍 / 公众号好文**（好文单独「保存好文」）
- 粘性保存条、模块搜索与状态筛选、问答索引面板可折叠
- 运营简明说明：[运营说明.md](./运营说明.md)（另有 `运营说明.pdf` 可转发）

### 见行解惑与索引
- 课文段落向量索引（Cloudflare AI + Vectorize `jianxing-passages`）；保存课文后可增量重建
- 检索卡选题、相关度门槛与摘录长度优化（见既有 ask / cards 逻辑）
- `wrangler.toml` 增加 `[ai]`、`[[vectorize]]` 绑定

### 学员与 App
- 学习中心 `/app/` + D1 进度、安卓 Capacitor（此前已上线，本版一并纳入版本说明）
- PC 网页隐藏登录/进度入口（进度能力以 App / Capacitor 为主）

### 工程
- `package.json` 版本 **1.3.0**
- 部署仍：`npm run deploy`（Pages 项目 `jianxing`，生产分支 `main`）

**v1.2.1**（2026-07-28）

- **学修问答**：全站右下角悬浮「问」按钮（运营页除外）；按课本文字检索后调用 DeepSeek 作答，并附出处链接
- 学习页提问时优先检索当前模块；约 8 次/分钟限流
- 需配置 Cloudflare Pages Secret：`DEEPSEEK_API_KEY`
- `package.json` 版本 **1.2.1**

**v1.2.0**（2026-07-25）

相对 v1.1 的主要变化：

### 学员前台 · 学习页
- **目录（TOC）**：听读/文字模式根据文稿标题（如 `甲一、` / `丙一、略说：`）自动生成侧栏目录；移动端有「目录」按钮
- **正文字号**：A+ / A− 调节，偏好写入 `localStorage`
- **更宽版式**：学习区加宽，便于长文阅读；吸顶音频条与目录跳转互不遮挡
- **iOS / 微信播放**：视频加 `playsinline`；上传侧提示优先 **H.264 + AAC**（苹果微信才有声音）

### 运营后台
- 视频上传可选「转 AAC 音轨 / 深度压缩」（浏览器 ffmpeg，**默认不勾选**）；建议用小程序或桌面软件先转好再传
- 上传写入更准确的 `Content-Type` 与长期缓存头，利于媒体播放与 CDN

### 字体与稳定性
- 模块大标题不用站酷小薇（缺字会导致「回」等成黑块），改用系统宋体族
- **Google Fonts 改为异步加载**，并优先系统中文字体，避免国内访问 Google 失败时整站 CSS 被卡住（白板蓝链）
- 页面脚本移入 `</body>` 内，避免落在 `</html>` 之后

### 工程
- `public/_headers`：运营脚本短缓存，便于发版后尽快生效
- `package.json` 版本 **1.2.0**

**v1.1.0**（2026-07-23）

相对 v1.0 的主要变化：

### 运营后台 `/ops/`
- **两级编辑**：一级只管理「章节 → 课」结构（增删改、拖拽排序）；进入课后再编辑文字 / 上传音视频
- **上传体验**：进度显示在对应上传控件旁；上传成功后**自动保存目录**；有未保存的结构/文字修改时显示提示条
- **已上传预览**：课内容页可预览音频 / 视频；结构列表用文/音/视标记状态
- **参考资料**：与大模块**并列**（不再挂在某个模块下），可在左侧「参考资料」中维护并上传 PDF
- **无小节层级**：一课直接含文字、音频、视频（目录版本 **v4**；旧数据会自动把多小节合并到课上）

### 学员前台
- 站点名称改为 **见行修学**
- 学习页支持 **视频 / 听读 / 音频** 切换；无视频时不显示「视」标签
- **听读**模式：吸顶音频条 + 正文，可一边听一边看
- 修复未配置 `PUBLIC_R2_BASE` 时误显示「待上传」的问题（播放依赖 R2 公开域名）

### 工程与部署
- 目录版本 **v4**：顶层 `references` + `modules`；课字段为 `text` / `audioPath` / `videoPath`
- 本地依赖含 `wrangler`；可用 `.npmrc` 国内镜像加速安装
- 部署：`npm run deploy`（Astro 构建 + Cloudflare Pages）

**v1.0.0** — 首个正式版：四大模块结构、运营上传（含分片）、Pages + R2

---

## 视频播放、标清与国内访问（2026-08 方案）

学员约 200 人、多数在国内。页面走 `jianxing.win`（Cloudflare Pages）或 `www.jianxing.xin`（阿里云 Nginx 反代到 Pages）。音视频在 R2 桶 `jianxing-files`，公开域 `https://media.jianxing.win`。

### 结论（先读这段）

1. **国内听课慢，主因是 R2 / Cloudflare 在境外**，不是播放器坏了。给 MP4 加 faststart，现代浏览器用 Range 也能找到 `moov`，对国内吞吐帮助很小。
2. **慧灯**（`zen.renyun.org`）不是 Cloudflare Stream，而是 S3 + CloudFront，多档 MP4，播放器**默认 480p**。见行采用同一思路：保留高清，另存标清，默认标清。
3. **宗教类视频不要长期放在大陆 OSS / 国内 CDN**。国内机只做备案反代和网页，片源仍放 R2。
4. **不要在现有阿里云 2c2g（`jianxing.xin` 反代机）上跑 ffmpeg**：试过会 OOM 宕机。
5. 从国内电脑或上海 ECS 拉 R2 都慢。以后若要「上传高清就不管」，更合适的是 **靠近 R2 的海外 VPS** 常驻转码（约 30–50 元/月，2–4 核 / 4–8G），片不落大陆盘。

### 已落地

| 项 | 做法 |
|------|------|
| 目录体积 | `GET /api/catalog?lite=1` 去掉课文；`GET /api/catalog?mod=&id=` 返回单课。首页 / 学修 / 课列表 / 下载走 lite；学习页再拉正文；运营仍用完整目录 |
| 标清字段 | `lessons[].videoPathSd`，lite 目录会带上；`flattenLesson` 会保留 |
| 学习页 | 有标清则默认标清，工具条「标清 / 高清」；无标清仍播高清 |
| 下载页 | 高清、标清分列 |
| 运营 | 课编辑显示高清路径 + 标清路径；网页只上传，转码走见行视频工作台 |
| 见行视频工作台 | `tools/jx-video-helper/`（`jx_video_helper.py` + `jx_lib.py`）；打包 `build.py`；说明见 `使用说明.txt`。exe / ffmpeg 不入库，运营从 `/api/download?path=media/jianxing-video-helper.zip` 下。SmartScreen 提示消不掉，除非购买代码签名证书 |
| 旧课标清 | 本机脚本 `tools/jx-video-sd/run.ps1`：curl 下高清 → ffmpeg 480p → 上传 `*-sd.mp4` → 改 `config/catalog.json` 的 `videoPathSd` 并 `rev+1` |

标清转码参数：`scale=-2:480`、`libx264` veryfast CRF 26、AAC 128k、`+faststart`。

### 23 课标清批处理进度（2026-08-17 上午）

对象：当时还没有 `videoPathSd` 的既有视频，共 23 个。

| 状态 | 课 |
|------|------|
| 已完成并写进目录 | 12 课：含《佛子行》第 1–12 课，以及 `done.tsv` 里的一轮回课。线上刷新后应能看到标清/高清 |
| 进行中 | 《佛子行》第十三课（`mod-1n1ezwq/lesson-l-js5r8ca.mp4`）。2026-08-16 21:11 开始用 curl 下 374MB，17 日 08:55 第一次失败（curl 56），续传后 08:56 下完约 392MB，已开始转码 |
| 未做 | 《佛子行》第十四课；《信心之音》第 1–8 课；《上师瑜伽·速赐加持》第 1 课（还剩 10 个，加上第 13 课共 11 个） |

脚本会跳过目录里已有 `videoPathSd` 的课，以及 `tools/jx-video-sd/done.tsv` 里的 slug。片源、产物、日志在 `tools/jx-video-sd/` 本地目录，**不入库**。

**续跑（本机 PowerShell）：**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\jx-video-sd\run.ps1"
```

依赖：`tools/jx-video-helper/ffmpeg/ffmpeg.exe`、`node_modules/.bin/wrangler.cmd`、已登录 Wrangler。下载优先 `https://media.jianxing.win/<key>`，失败再 `wrangler r2 object get`。每课大约 15–40 分钟（国内下 R2 经常更久）。**批处理跑的时候不要在运营后台改课表。**

### 试过、明确不采用的

- 只靠 faststart / 重封装解决国内慢：测过信心之音课 1（已 faststart）和课 2（moov 在尾），体积都约 350MB，国内体感差不多。
- Cloudflare Stream：能自动 HLS，但仍是境外，按存储和流量计费，还要换播放器，和慧灯那套也不是一回事。
- 国内 OSS + 国内 CDN：国内最快，但片会长期落在大陆，不做。
- 备案反代机上转码：2c2g 会崩。
- 每次开一台按量 ECS 转完就删：和用自己电脑差不多，除非用 API 自动开/关，才算「自动」。

### 后续计划

1. **先做完这 23 课标清**（续跑 `run.ps1`）。全部完成后抽一课《信心之音》看标清/高清和起播。
2. **新课**：师兄用见行视频工作台在本机处理好再上传；有标清就填 `videoPathSd`，学员默认标清。
3. **海外转码机（未做，需要时再上）**：R2 附近 VPS，上传高清后自动出 480p 并写目录。片不进大陆盘。现有阿里云机继续只做 `.xin` 反代。
4. **HLS / Stream**：标清默认仍不够再评估；不是当前第一步。
5. **视频助手 SmartScreen**：不买证书就无法从根上去掉「已保护你的电脑」，继续让师兄点「仍要运行」。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Astro 7（SSG） |
| 边缘 API | Cloudflare Pages Functions（`functions/`） |
| 存储 | Cloudflare R2（目录 JSON + 媒体）；学员进度为 D1 `jianxing-app` |
| 部署 | Wrangler → Pages 项目 `jianxing` |
| 安卓 | Capacitor（`android/`） |

## 仓库结构（要点）

```text
src/pages/              前台：首页、学修、学习页、研讨、参考资料、/app、下载、ops
src/pages/yantao/       研讨（考问 / 圆桌）
src/pages/reference/    参考资料枢纽 + books / articles
public/ops-app.js       运营后台逻辑
public/jx-catalog.js    前台目录与学修分区（列表走 lite）
public/jx-ask.js        见行解惑
public/yantao-*.js      研讨前台
tools/jx-video-helper/  见行视频工作台源码（exe / ffmpeg 不入库）
tools/jx-video-sd/      旧课转标清脚本（片源不入库）
android/                Capacitor 安卓工程
functions/api/          auth / progress / ask / cards / catalog / articles / passages / yantao / upload*
functions/_lib/         deepseek / passages / yantao / cards / auth 等
运营说明.md / .pdf       给运营同学的简明手册
```

## 内容存储（R2，不在 Git）

| 路径 | 说明 |
|------|------|
| `config/catalog.json` | 学修模块 + 参考书籍 |
| `config/article-collections.json` | 公众号好文集合 |
| 媒体文件 | 课音频/视频、PDF 等 |

模块可选字段：`section`、`sectionGroup`（学修分区）。

## 本地开发

环境要求：Node.js `>= 22.12.0`

```bash
npm install
cp .env.example .env   # 填入 PUBLIC_R2_BASE（R2 公开访问前缀）
npm run dev
```

说明：

- `.env` 不要提交到 Git（已在 `.gitignore`）
- 运营密码在 Cloudflare Pages 的 Secret：`OPS_PASSWORD`
- 本地若无 Functions/R2，目录接口可能不可用；完整联调需 `wrangler pages dev` 或直接对线上环境操作

## 部署

```bash
npx wrangler login    # 首次
npm run deploy
```

构建时会读取 `.env` 中的 `PUBLIC_R2_BASE`，写入页面 `<meta name="r2-base">`，供前台拼接音视频 / PDF 地址。

PowerShell 若拦截 `npm` / `npx` 脚本，可用 `npm.cmd` / `npx.cmd`。

## 内容模型（v4 + 分区字段）

```text
catalog.json
├── references[]          # 参考书籍（PDF 等）
└── modules[]             # 大模块
    ├── section / sectionGroup   # 可选，学修分区
    └── chapters[]
        └── lessons[]     # text / audioPath / videoPath / videoPathSd（可选标清）

article-collections.json  # 公众号好文（独立于课表）
```

## 运营说明

日常操作见 [运营说明.md](./运营说明.md)（PDF：`运营说明.pdf`）。  
后台地址：https://jianxing.win/ops/（勿公开传播）  
净土站运营入口：https://jingtu.jianxing.win/ops/（独立部署，勿与主站 ops 混用）

## 另一台电脑继续开发

```bash
git clone https://github.com/yanyanzhou123/jianxing-web.git
cd jianxing-web
git checkout master
npm install
cp .env.example .env   # 自行填入 PUBLIC_R2_BASE
```

读完本 README「版本 → v1.3.6」、下文「视频播放、标清与国内访问」，以及 `运营说明.md`、`安卓App说明.md` 即可了解当前状态。  
线上目录与媒体在 R2，不在本仓库二进制里。部署到 Cloudflare 需已登录 Wrangler，并具备 Pages / R2 / D1 / AI / Vectorize 权限。
