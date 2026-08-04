# 见行修学网站（本仓库）

GitHub：https://github.com/yanyanzhou123/jianxing-web  
本 README 随仓库维护，上传 GitHub 时请一并提交，避免产品线混淆。

## 产品线总览（务必分清）

见行体系目前有 **三条产品线**，域名 / 仓库 / 能力不同，改功能前先确认改的是哪一条：

### 1. 见行修学网页（本仓库 · 主站）

| 项 | 说明 |
|------|------|
| 域名 | https://jianxing.win |
| 仓库 | **本仓库** `jianxing-web`（本地目录常为 `加行网站`） |
| Cloudflare Pages | 项目名 `jianxing` |
| R2 | 桶 `jianxing-files`（公开前缀以环境变量 `PUBLIC_R2_BASE` 为准） |
| 定位 | 公开学修站：课表、听读/音视频、运营后台、见行解惑（检索卡 + DeepSeek）等 |
| 当前代码版本 | 见下方「版本」；`package.json` 以仓库为准 |

### 2. 净土修学（子域名分站 · 另部署）

| 项 | 说明 |
|------|------|
| 域名 | https://jingtu.jianxing.win |
| 品牌 | **净土修学**（首页文案：一心念佛，往生净土） |
| 来源 | 由见行网站**复制/分叉**到子域名，内容与品牌改成净土向 |
| 本仓库 | **不含**净土站源码；勿在本仓库直接改净土站 |
| 线上特征（2026-07-29 核对） | 目录模型 **catalog v4**；前台 `jx-catalog.js?v=20260725d`；有 `/ops/`、`/api/catalog`；**无**见行解惑挂载、**无** `/app/` 学习中心导航；独立 R2 公开域 `pub-67be9c6f4a074660948f624ab1a41a1c.r2.dev` |
| 模块（线上目录） | 念佛修法（open）、净土经典（coming）、净土修行（coming） |
| 版本推断 | 大致对应见行 **v1.2.0 前后**（约 2026-07-25 工具链），**早于**主站 v1.2.1「学修问答 / 见行解惑」与后续自学 App；精确分叉提交未记在本仓库，以线上为准 |

> 若找回净土站本地/Git 路径，应另建说明或独立仓库，并在本 README 补上链接。

### 3. 自学 App（安卓壳 · 挂主站学习中心）

| 项 | 说明 |
|------|------|
| 形态 | Capacitor 安卓工程（本仓库 `android/`）+ 网页学习中心 https://jianxing.win/app/ |
| 包名 | `win.jianxing.app` |
| 能力 | 用户名密码账号、个人学习进度（Cloudflare D1 `jianxing-app`）；内容仍读主站课表 |
| 说明文档 | [安卓App说明.md](./安卓App说明.md) |
| 注意 | App 打开的是**见行主站**学习中心，不是净土子域名 |

```text
jianxing.win          ← 产品线 1：见行修学网页（本仓库）
jingtu.jianxing.win   ← 产品线 2：净土修学（分叉部署，源码不在本仓库）
安卓 App              ← 产品线 3：壳 + /app/（账号进度；内容走主站）
```

---

## 本仓库：见行修学网页

面向学修内容的静态站点 + 运营可配置后台。目录与媒体存放于 Cloudflare R2，运营保存后前台刷新即可，无需为改内容重新部署。

## 版本

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
public/jx-catalog.js    前台目录与学修分区
public/jx-ask.js        见行解惑
public/yantao-*.js      研讨前台
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
        └── lessons[]     # text / audioPath / videoPath

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

读完本 README「版本 → v1.3.1」与 `运营说明.md`、`安卓App说明.md` 即可了解当前状态。  
线上目录与媒体在 R2，不在本仓库二进制里。部署到 Cloudflare 需已登录 Wrangler，并具备 Pages / R2 / D1 / AI / Vectorize 权限。
