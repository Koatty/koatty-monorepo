# Release 列表页解析

此前 `/owner/repo/releases` 被当作不支持的文件地址拒绝。现在 POST `/api/links` 接受此地址（可带结尾 `/`），返回 `kind: "releases"`、`source`、`limit: 20` 和 `releases`。每个版本包含 `name`、`tag`、`prerelease`、`assets`，附件包含 `name`、`size`（字节）、`source`、`path`。

客户端必须识别新的 `kind`，在附件选择后使用其 `path` 下载；不能把列表页当文件流下载。自带网页已适配，并自动切换到文件下载标签。原有 git/file 响应不变。仅支持列表页面；具体 `/releases/tag/...` 页面尚未支持，可使用列表页或附件直链。

API 固定访问公开 GitHub Releases 接口，不接受用户指定 API 主机，不传递用户凭证。展示最近最多 20 个版本，缓存 60 秒，最多缓存 100 个仓库，同时最多 4 次不同仓库的查询；相同查询合并。JSON 上限 4 MiB，总超时 8 秒，不跟随 API 重定向。未找到公开仓库返回 404；GitHub 拒绝/限流返回 429，可改用附件直链。

## 升级已有 Nginx 部署

备份当前部署目录中的 `.env`、Compose 文件和自定义网络配置。将新版部署包中的 `src/`、`static/`、`test/`、`docs/` 和 `CHANGELOG.md` 同步到原应用构建目录。本次没有新增 npm 依赖；保留现有 `vendor/`、锁文件及 Nginx/Compose 网络配置。

在原 Compose 项目目录执行：

```bash
docker compose up -d --build --no-deps mirror
docker compose logs --tail=50 mirror
curl -fsS https://du.koatty.org/healthz
curl -fsS https://du.koatty.org/api/links \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://github.com/richenlin/HuashanAICode-releases/releases"}'
```

最后一个响应应包含 `"kind":"releases"` 及附件列表。浏览器强制刷新以加载新版 JS/CSS。当前服务器的 80/443 由 `mcp-nginx` 占用，升级只重建 `mirror` 服务，不启动默认 Caddy，也不要覆盖已有 Compose 项目名或网络连接。
