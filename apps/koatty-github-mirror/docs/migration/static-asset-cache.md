# 静态资源缓存与 Release 类型误判

现象：接口已返回 `kind: releases`，旧浏览器页面却提示“这是 Git 仓库链接，请切换到 Git 版本控制”。2026-10-14 实测公网最新脚本已包含 releases 分支，但 `/assets/site.js` 响应为 `Cache-Control: max-age=14400`，允许客户端保留旧版本 4 小时。该证据支持旧脚本缓存导致前后端版本不一致；未直接读取用户浏览器缓存。

修复：主页中的 JS/CSS 地址追加基于实际文件内容的 SHA256 查询参数；HTML 和资源响应均显式设置 `Cache-Control: no-store`。未知 API 类型显示刷新提示，只有明确识别为 git 的响应才按 git 类型处理。此变更不影响 Git/文件转发接口。

## 升级

先强制刷新（Windows/Linux Ctrl+Shift+R；Mac Cmd+Shift+R）或关闭旧标签后重新打开。若边缘缓存仍提供旧脚本，在 Cloudflare 对首页、`/assets/site.js` 和 `/assets/site.css` 执行精确 URL 缓存清理。缓存规则若强制覆盖源站 Cache-Control，应调整这些路径的规则。已缓存对象不会因为后端增加 no-store 就被追溯删除。

将新版包中的 src、static 同步到原构建目录，保留服务器的 .env、Compose 与代理配置，在原 Compose 项目目录执行：

```bash
docker compose up -d --build --no-deps mirror
curl -I https://du.koatty.org/
curl -I https://du.koatty.org/assets/site.js
```

响应应包含 `Cache-Control: no-store`；网页源码中的 JS/CSS URL 应出现 `?v=`。已有页面不会自动替换内存中的 JavaScript，更新后仍需刷新一次。源码内容在进程内缓存，修改静态文件后须重启应用/重建镜像。
