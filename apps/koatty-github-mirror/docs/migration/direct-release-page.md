# 浏览器直接访问 Release 包列表

## 地址行为

- `https://du.koatty.org/github.com/richenlin/HuashanAICode-releases.git`：用于 Git clone/fetch/pull；浏览器直接 GET 仍返回现有 405 JSON，不提供仓库网页，也不挂起连接。
- `https://du.koatty.org/github.com/richenlin/HuashanAICode-releases/releases`：浏览器直接 GET 返回 200 HTML，展示最近最多 20 个公开版本及附件。点击附件通过当前镜像站下载。允许末尾 `/` 和 HEAD。
- `/releases/download/...`：继续返回附件文件流。

列表由服务端生成，即使禁用 JavaScript 也能显示、下载；页面及样式具有缓存控制和样式内容版本号。GitHub 文本均作 HTML 转义；上游错误显示可读页面并保留 404/429/502 等错误码。沿用 ReleaseService 的公开 GitHub API、并发/体积/时间限制及 60 秒列表缓存。

## 升级

从新版部署包同步 src、static 至原构建目录；可同时更新 scripts、test、docs。保留现有 .env、Compose、Nginx/Caddy 网络配置。在原 Compose 项目目录执行：

```bash
docker compose up -d --build --no-deps mirror
curl -I https://du.koatty.org/github.com/richenlin/HuashanAICode-releases/releases
git ls-remote https://du.koatty.org/github.com/richenlin/HuashanAICode-releases.git HEAD
```

列表应返回 200、Content-Type: text/html 和 Cache-Control: no-store。若 CDN 存在旧页面/错误响应缓存，清除该列表 URL 缓存。
