# 专用 Git 域名 Caddy 加固（2026-11-01）

可选配置 `deploy/Caddyfile.git` 已在当前 VPS 的 Caddy 2.11.7 上验证并热加载。配置适用于现有 du Web 入口及 git.koatty.org 直连入口；其他部署须调整域名并先验证配置，不要在 SITE_ADDRESS 中再同时包含 Git 域名。

## 行为变化

- Git 域名仅允许 GET/HEAD `/healthz`、GET 仓库 `info/refs` 的两种精确 service 查询、POST `git-upload-pack` / `git-receive-pack`。POST 禁止附加查询，并检查相应 Content-Type。
- Git 域名的首页、API、Release 页面、文件下载、扫描路径和其他方法默认 404。Git 仓库根路径保持 405。Web/下载仍访问 du 域名。
- Git 请求体由 Caddy 和应用双重限制：读协商 8 MiB、push 512 MiB；Caddy 限制同时覆盖已知长度和 chunked 上传，实际收到超限字节时终止，并不保证读取任何字节前就拒绝大 Content-Length。
- 不缓存、不缓冲完整上传、不重试 Git POST、不改写 Authorization/Git-Protocol。Cookie 和 Forwarded 不传入应用，X-Real-IP/X-Forwarded-For 取实际连接来源。此配置适用于直连 Git 入口；以后再套 CDN 必须重新设计可信来源解析。
- 移除 Git 入口 `flush_interval -1`，使客户端取消能传到应用并释放上游。未知长度响应仍按 Caddy 的默认流式行为及时转发。
- 代理建连超时 5 秒、上游响应头等待 30 秒；未设置短的整包响应写入期限。应用仍限制空闲和总传输时间。
- HTTPS 443 监听开启 strict_sni_host、16 KiB 请求头上限、10 秒读请求头超时和 1 分钟连接空闲超时。这些监听级设置同时作用于 du 域名；不会将活跃 Git 数据传输限制为 1 分钟。

不启用访问日志，不额外安装限流插件。应用已有每 IP 并发/请求频率及进程总并发限制；这次未调整这些限额，也不能把它们当作网络层 DDoS 防护。

## 线上更新及回滚

本次已备份并热加载，无需构建镜像或重启 mirror。线上备份：`/root/web/Caddyfile.before-hardening-20261101-052227`。

未来更新先将候选文件复制到 Caddy 容器中进行 `caddy validate`，成功后写入现有 Caddyfile 并 reload。单文件 bind mount 应原地写入内容，避免用 rename 替换 inode 后容器继续读旧文件。通过 SSH heredoc 执行 `docker compose exec -T` 时加 `< /dev/null`，避免 Docker 消耗后续脚本输入。

回滚：

```bash
cd /root/web
cat Caddyfile.before-hardening-20261101-052227 > Caddyfile
docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile < /dev/null
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile < /dev/null
```

## 验证结果及范围

独立回归文件 `test/regression/MIRROR-06.caddy.test.mjs` 使用真实 Caddy 2.11.7 和本地 HTTP fixture，4 项测试通过：

1. 非法路径、方法、查询不抵达上游。
2. Git 认证/协议头和 401 挑战保留，伪造来源头被覆盖，Cookie/Forwarded 被移除。
3. 读写 POST、Content-Type 和已知长度/chunked 体积限制；push 的 512 MiB 配置在测试中缩为 1 KiB 验证相同限制逻辑，未发送 512 MiB 数据。
4. 客户端断开时上游被取消。

Linux 上通过 `CADDY_BINARY=/path/to/caddy node --test test/regression/MIRROR-06.caddy.test.mjs` 单独运行；该文件不属于 Jest 默认收集范围。不要在已有服务占用 18080/19090/2019 的环境直接运行，推荐本地隔离容器。

公网验证：12 项路径/方法/协议状态检查通过，超大请求头 431，SNI/Host 不一致 421，匿名 receive-pack 服务发现 401 且保留认证挑战。du Release 页面 200。开发机通过 Git 域名真实完整 clone pipewright 约 4.20 秒、fetch 1.32 秒、pull 1.33 秒，`git fsck --full` 成功。未提供 PAT、未执行真实 GitHub push；本地 fixture 验证不是线上写入验收。

## 安全边界

此配置缩小 Git 域名暴露面，不能保证不被入侵，不能抵挡带宽耗尽攻击。两个入口仍共用同一 IP/应用；du 站点保留原有路由，包括兼容 Git 请求，因此 Git 域名的路径白名单不等于整个源站的白名单。应用自身的目标校验和资源限制仍是公共防线。需要彻底隔离时，应分离入口、限制 Web 源站访问来源，并使用有网络层防护的 Git 服务器。

参考：[Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)、[服务器参数](https://caddyserver.com/docs/caddyfile/options)、[请求匹配器](https://caddyserver.com/docs/caddyfile/matchers)。
