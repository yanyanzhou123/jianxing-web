# 见行修学网站 v1.1

见行修学平台（https://jianxing.win）

面向学修内容的静态站点 + 运营可配置后台。目录与媒体存放于 Cloudflare R2，运营保存后前台刷新即可，无需为改内容重新部署。

## 版本

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
