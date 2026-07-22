# 见行学会网站 v1.0

见行学会学修平台（https://jianxing.win）

## 版本

**v1.0.0** — 首个正式版

- 四大模块学修结构（模块 → 章节 → 课 → 小节）
- 运营后台可配置架构并上传音视频（支持大文件分片）
- Cloudflare Pages + R2 部署

## 本地开发

```bash
npm install
cp .env.example .env   # 填入 PUBLIC_R2_BASE
npm run dev
```

## 部署

```bash
npm run deploy
```

需已登录 Cloudflare：`npx wrangler login`

## 运营说明

见仓库内 [运营说明.md](./运营说明.md)
