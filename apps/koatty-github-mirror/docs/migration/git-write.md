# Git HTTPS 读写支持

## 协议变更

新增 `info/refs?service=git-receive-pack` 和 POST `git-receive-pack`。支持 Git Smart HTTP 的 clone/fetch/pull/ls-remote/push，以及 push 携带的分支、标签、删除、force-with-lease、atomic 操作；能否执行由 GitHub 权限及服务端规则决定，不绕过保护。commit/checkout/rebase 等本地命令原本无需代理。SSH、Git LFS 和任意 GitHub API 不在该协议范围，子模块 URL 不自动改写。

`.git` 根路径浏览器行为仍为 405；`/releases` 浏览器包列表不变。文件与列表仍仅公开资源。Git 认证透传意味着有权限的私有仓库也能通过相同 Git URL 访问。

## 认证

- 仅向精确 `https://github.com/OWNER/REPO.git/{info/refs,git-upload-pack,git-receive-pack}` 透传 Basic/Bearer Authorization。
- 返回上游 401 / WWW-Authenticate，让 Git 正常请求凭证。GitHub 用户名加 Personal Access Token 作为密码；令牌需授权目标仓库及相应读写权限（修改工作流时还要满足 GitHub 对工作流权限的要求），组织可能要求额外批准。
- 文件、Raw、Release API 不转发该凭证。Cookie、Set-Cookie 不透传；Git 响应不缓存。
- 认证请求与 Git POST 不跟随重定向，不自动重放；仓库重命名/迁移后更新 remote 为规范地址。超时后先检查远端 refs，再判断是否需要重推。
- 仅使用 HTTPS 和可信镜像服务器。镜像作为 HTTPS 终止点会接触令牌和私有仓库数据；本应用不把认证请求头写入日志，但部署者仍须保证反向代理没有记录它们。不要把令牌写进 URL、.env、脚本或日志。

```bash
git remote set-url origin https://du.koatty.org/github.com/OWNER/REPO.git
git remote set-url --push origin https://du.koatty.org/github.com/OWNER/REPO.git
git config --local credential.useHttpPath true
git push origin HEAD
```

如果以前设置过直连 SSH 的 pushurl，仅修改 origin 的 fetch URL 不会改变 push 目标；所以上述命令也更新 pushurl。认证交互输入用户名，密码位置输入 PAT。凭证按镜像域名及仓库路径管理，不假设 github.com 域名下的已有凭证会自动用于镜像域名。

## 上传限制与前置代理

读取协商仍默认限制 8 MiB（MIRROR_MAX_GIT_BODY_BYTES）；写入采用流式转发和背压，不将 pack 整体加载进内存或落盘，默认上限 512 MiB（MIRROR_MAX_GIT_PUSH_BODY_BYTES）。同时检查 Content-Length 和实际流量；无长度的 chunked 上传同样受限。保留单 IP/全局并发、空闲和总时限。push 首包等待从上传完成后计时，避免持续上传被原 15 秒响应首包时限打断。

已有 Compose 可以不新增变量，直接使用默认上限。自定义时将此键加入 mirror.environment：

```yaml
MIRROR_MAX_GIT_PUSH_BODY_BYTES: ${MIRROR_MAX_GIT_PUSH_BODY_BYTES:-536870912}
```

已有 Nginx 的对应代理 location 中合并以下设置，保留原来正确的 proxy_pass 和网络配置：

```nginx
client_max_body_size 512m;
proxy_http_version 1.1;
proxy_request_buffering off;
proxy_buffering off;
proxy_read_timeout 1800s;
proxy_send_timeout 1800s;
proxy_set_header Authorization $http_authorization;
```

不要把 Authorization 加入 access_log。Caddy 默认透传认证头，随包配置不缓存请求体。CDN（包括 Cloudflare）的请求体/超时上限独立于应用；大 push 被边缘返回 413 时，应调整允许的边缘配置，或使用直连 VPS 且配置正确 TLS 的专用 Git 域名。提高 http.postBuffer 不能解决服务端/CDN 上传限额。

## 部署与验收

更新新版部署包的 src、static、test、scripts、docs；保留原 .env/Compose/代理配置，并按需合并新增环境变量和上述 Nginx 设置。

```bash
docker compose up -d --build --no-deps mirror
```

`npm test` 会在临时本地 Git 仓库上执行真实写入与删除，不修改真实 GitHub 仓库。`npm run test:live` 仍是只读外网验证。实际 GitHub push 需要有写权限的用户在专用测试仓库验收；本次没有使用用户 PAT 或改写线上仓库。验收时可推送专用测试分支，再检查其 SHA、删除该分支；不得将本地测试当成已完成的 VPS/GitHub 写入验收。

参考：[Git HTTP 协议](https://git-scm.com/docs/http-protocol)、[GitHub Personal Access Token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。
