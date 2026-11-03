# Git 链接使用独立入口

设置 `MIRROR_GIT_BASE_URL=https://git.koatty.org` 后，POST /api/links 的 Git 结果额外返回 baseUrl。前端的加速地址、clone 命令和复制内容使用该 origin；文件及 Release 附件继续使用页面所在的域名。

为空时保持原来的单域名行为。配置只允许无凭证、无路径、无查询/fragment 的 HTTPS origin；错误配置在启动时拒绝，不输出配置内容。

当前低配置 VPS 使用本地构建并上传的 amd64 镜像。在 `/root/web/compose.image.yaml` 的 mirror.environment 中加入该变量，保留镜像标签及其他配置，然后使用两个 Compose 文件执行 `up -d --no-build --pull never --no-deps mirror`。仅写入 .env 而未映射到容器 environment 不会生效。

本次不改 Caddy 加固配置。新 static/site.js 内容会产生新的资源摘要 URL，页面及静态文件沿用 no-store。若浏览器仍显示旧结果，应刷新页面重新生成链接。
