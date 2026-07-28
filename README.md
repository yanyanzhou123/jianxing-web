# 见行修学网站 v1.2

见行修学平台（https://jianxing.win）

面向学修内容的静态站点 + 运营可配置后台。目录与媒体存放于 Cloudflare R2，运营保存后前台刷新即可，无需为改内容重新部署。

## 版本

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
| 存储 | Cloudflare R2（目录 JSON + 媒体） |
| 部署 | Wrangler → Pages 项目 `jianxing` |

## 仓库结构（要点）

```text
src/pages/          前台页面（首页、学修、学习页、参考资料、下载、ops）
src/data/           站点信息与类型
public/ops-app.js   运营后台逻辑
public/jx-catalog.js 前台目录加载
public/ops-video-compress.js  可选：浏览器端视频转码
public/vendor/      ffmpeg 前端包（按需加载）
functions/api/      login / catalog / upload* 等
```

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

## 内容模型（v4）

```text
catalog.json
├── references[]          # 全站参考资料（与模块并列）
└── modules[]             # 大模块
    └── chapters[]
        └── lessons[]     # text / audioPath / videoPath
```

## 运营说明

日常操作见 [运营说明.md](./运营说明.md)。  
后台地址：https://jianxing.win/ops/（勿公开传播）

## 另一台电脑继续开发

```bash
git clone https://github.com/yanyanzhou123/jianxing-web.git
cd jianxing-web
npm install
cp .env.example .env   # 自行填入 PUBLIC_R2_BASE
```

读完本 README 与 `运营说明.md` 即可了解当前状态。线上目录与媒体在 R2，不在本仓库二进制里。
