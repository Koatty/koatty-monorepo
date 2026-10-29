# 海外 VPS 部署教程

方案：单机单进程应用 + Caddy 自动 HTTPS，无数据库、Redis 或文件缓存；应用端口只在 Compose 网络内可见。没有执行你的 VPS 部署。

## 1. 开发机生成独立部署目录

按 README 构建框架和应用并跑通测试后，在 monorepo 根执行：

```bash
npm --prefix apps/koatty-github-mirror run package:deploy
```

输出 `.deployment/koatty-github-mirror-<时间戳>`：包含源码、页面、Dockerfile、Compose、实际框架包 `vendor/*.tgz`、摘要 `vendor/snapshot.json` 和 npm 锁文件。包含这次修复的 Trace 代码，无需先发布 npm 包。

同时生成同名 `.tar.gz` 上传包。优先上传此压缩包，在 VPS 工程目录用 `tar -xzf /path/to/archive.tar.gz` 解压；包内没有 node_modules。后续本地验收安装依赖也不会污染已经生成的上传包。

上传输出目录的**全部内容**，不是仅源码，也不需要整个 monorepo。替换下面的目录和主机：

```bash
scp -r /path/to/koatty-github-mirror-TIMESTAMP user@VPS:/home/user/koatty-github-mirror
```

不要上传开发机的 node_modules、.env、日志或计划签名密钥。生成目录不含这些内容。

## 2. 准备 VPS

- 起步建议 2 vCPU / 2 GB 内存，预留构建与安装空间；容量应以实际测试为准。
- 按 [Docker 官方教程](https://docs.docker.com/engine/install/ubuntu/) 安装 Engine 和 Compose 插件。
- 域名 A 指向 VPS；仅在服务器支持 IPv6 时配置 AAAA。
- 开放 SSH 管理端口、TCP 80/443；可选 UDP 443。不要开放 3000。
- 允许访问 npm registry、镜像仓库，以及 api.github.com、github.com、raw.githubusercontent.com、codeload.github.com、release-assets.githubusercontent.com、objects.githubusercontent.com 的 HTTPS。

```bash
docker version
docker compose version
git --version
```

## 3. 启动

```bash
cd /home/user/koatty-github-mirror
cp .env.example .env
```

编辑 `.env` 的 `SITE_ADDRESS` 为你的域名（无路径），Caddy 自动申请和续期证书。只用 IP + HTTP 测试时改为 `http://:80`，访问 `http://VPS_IP`。HTTP 下浏览器剪贴板受限时，页面提供选中文本手动复制。

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 mirror caddy
```

Caddy 不重写域名前缀路径或查询，关闭缓冲等待以及时转发响应。没有启用响应压缩或文件缓存。参见 [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。

## 4. 验收

替换域名及最后两条的 OWNER / REPO / TAG / FILE：

```bash
curl -fsS https://mirror.example.com/healthz
git ls-remote https://mirror.example.com/github.com/octocat/Hello-World.git HEAD
git clone https://mirror.example.com/github.com/octocat/Hello-World.git
git -C Hello-World fetch origin
git -C Hello-World pull --ff-only
curl -fL -o README https://mirror.example.com/raw.githubusercontent.com/octocat/Hello-World/master/README
curl -fL -o source.zip https://mirror.example.com/github.com/octocat/Hello-World/archive/refs/heads/master.zip
curl -I https://mirror.example.com/github.com/OWNER/REPO/releases/download/TAG/FILE
curl -fL -C - -o FILE https://mirror.example.com/github.com/OWNER/REPO/releases/download/TAG/FILE
```

大文件中断后重跑下载，确认 206 和最终 SHA-256，与 GitHub 直下比较。不存在文件应返回 404；未认证的 push 服务发现应返回 GitHub 的 401 认证挑战，或上游实际权限错误；非 GitHub 目标拒绝。

从安装 Node.js 22 的机器也可运行：

```bash
MIRROR_BASE_URL=https://mirror.example.com node scripts/live-smoke.mjs
```

脚本实际访问 GitHub，临时克隆小型公共仓库并比较文件字节，结束自动清理。

## 5. 已有仓库接入

```bash
git remote set-url origin https://mirror.example.com/github.com/OWNER/REPO.git
git remote set-url --push origin https://mirror.example.com/github.com/OWNER/REPO.git
git config --local credential.useHttpPath true
git fetch origin
```

读写均走镜像。Git 认证时使用 GitHub 用户名和 Personal Access Token；仅使用可信镜像站及 HTTPS，不把 token 放进 URL。若以前单独设置了 SSH pushurl，必须更新这一项才能让 push 走镜像。恢复直连：

```bash
git remote set-url origin https://github.com/OWNER/REPO.git
git remote set-url --push origin https://github.com/OWNER/REPO.git
```

## 6. 运维与配置

`.env.example` 中的键由 Compose 使用。以下额外选项要显式加入 `mirror.environment` 才传入容器：

| 环境变量 | 用途 |
| --- | --- |
| MIRROR_MAX_CONCURRENT | 进程总代理并发 |
| MIRROR_MAX_PER_CLIENT | 单 IP 同时请求数 |
| MIRROR_REQUESTS_PER_MINUTE | 单 IP 每分钟请求数 |
| MIRROR_MAX_GIT_BODY_BYTES | Git 协商请求体上限，不是 pack 响应大小 |
| MIRROR_MAX_GIT_PUSH_BODY_BYTES | push 流式请求体上限，默认 512 MiB；无磁盘缓存 |
| MIRROR_HEADER_TIMEOUT_MS | 建连/上游首包时限；push 上传完成后开始等待响应首包 |
| MIRROR_IDLE_TIMEOUT_MS | 上游空闲传输与 Git 请求体读取时限 |
| MIRROR_TRANSFER_TIMEOUT_MS | 单次代理总时限 |

修改后 `docker compose up -d`。应用将 Trace 时限设在代理总时限之后，避免默认短时限截断 Git clone。

来源 IP 使用 Caddy 覆盖写入的 X-Real-IP；不要对外发布启用 TRUST_PROXY 的应用端口。如额外增加 CDN，须重新设计可信代理链。限流仅单进程生效。

Docker 日志轮转，应用日志目录使用 tmpfs；未开启 Caddy 访问日志，避免持久化完整 URL 查询。无需备份仓库数据；保留部署源、配置和 Caddy 证书卷。流量费用、连通性和上游限制取决于实际环境。

升级时生成并验收新部署目录，保留旧目录与镜像供回滚，再执行 `docker compose up -d --build` 并重复验收。停止用 `docker compose down`；不要随意加 `-v` 删除证书卷。

## 7. 排障

- 502/504：检查 VPS 的 DNS、出站 HTTPS 与 GitHub 可达性；不关闭 TLS 校验。
- 401/403/404：Git 请求检查凭证、仓库权限、组织授权与分支规则；文件和 Release 列表仍仅支持公开资源。
- 413：检查应用 push 大小上限，以及 Nginx/CDN 的请求体限制；提高应用限额不会提高 CDN 限额。
- 429：减小并发或等待窗口恢复，评估容量后再调限额。
- 证书失败：检查 A/AAAA、80/443 和端口占用。
- 长下载中断：检查内存、带宽、超时及额外 CDN 限制；Range 恢复后校验文件。

VPS 部署、公网证书、持续负载、下载吞吐与真实用户线路测速需要在目标服务器进行。

## 已有 Nginx 服务的本次升级

已有 `mcp-nginx` 占用 80/443 的实例，请保留现有反向代理和 Compose 网络配置，仅更新并重新构建 `mirror`。具体步骤见 [Release 列表页迁移说明](migration/release-listing.md)。

## Git push 升级补充

本次支持 Git 写入。更新源码后重建 mirror；保留原代理与网络配置。新增 `.env` / Compose 可选键 `MIRROR_MAX_GIT_PUSH_BODY_BYTES`，未设置时应用使用 512 MiB。已有 Nginx 还需调整请求体大小、关闭请求缓冲，并确保没有清除 Authorization。完整示例和真实写入验收边界见 [Git 读写迁移说明](migration/git-write.md)。
