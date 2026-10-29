# 渡 · Koatty GitHub 加速站

仅做两件事：**Git HTTPS 读写代理（clone / fetch / pull / push）**和 **GitHub 文件下载加速**。这是按需转发的代理，不存储整站或仓库副本。

```bash
git clone https://mirror.example.com/github.com/owner/repository.git
curl -fL -C - -o package.zip https://mirror.example.com/github.com/owner/repository/releases/download/v1/package.zip
```

匿名公开仓库读取也支持 `http://xxx.xx/github.com/owner/repository.git`；认证和推送请使用可信镜像站的 HTTPS 地址。

| 支持 | 范围 |
| --- | --- |
| Git | clone / fetch / pull / push / ls-remote；分支、标签、删除和 force-with-lease；GitHub 认证控制仓库权限；Smart HTTP v0 / v1 / v2 |
| 文件 | Release、ZIP / tar.gz 源码归档、Raw；blob 链接转换为 Raw |
| 协议 | GET / HEAD、单段 Range、If-Range、ETag、If-None-Match、Last-Modified |
| 不支持 | Git LFS、SSH、GitHub 通用网页浏览、任意 API 转发和其他站点代理 |

子模块地址不会自动改写；对子模块单独设置加速地址。LFS 可从原地址下载，但不经过本站。

## 开发

要求 Node.js 22+、pnpm 9、Git。以下命令在 monorepo 根目录执行：

```bash
node apps/koatty-github-mirror/scripts/setup-local.mjs
npm --prefix apps/koatty-github-mirror test
npm --prefix apps/koatty-github-mirror run lint
npm --prefix apps/koatty-github-mirror start
```

访问 `http://127.0.0.1:3000`。`setup-local` 显式链接当前 workspace；缺少的普通 npm 依赖安装在工程 `.local-deps`。这不代表发布包独立安装验收。部署时使用实际源码构建 tarball 与独立锁文件，避免 npm 同版本旧产物。

首次从源码构建依次执行：

```bash
pnpm build:base
pnpm --filter koatty_serve build
pnpm --filter koatty_router build
pnpm --filter koatty_trace build
pnpm --filter koatty build
pnpm --filter koatty_testing build
pnpm --filter koatty_cli build
pnpm --filter koatty_ai build
```

## 验证与部署

- 项目由 `koatty_cli new --template project --offline --no-skill` 创建；模板摘要在 `.koatty/template-lock.json`。
- `koatty_ai skill` 安装 Skill；`http-action` 签名 plan/apply 生成链接接口的 Controller / DTO / Service。
- Service 实现业务；Middleware 分发域名前缀请求。使用 Koatty 路由、DI、DTO、配置、启动与 Trace。
- `npm test`：真实 Koatty HTTP + 本地 TCP 上游 + git-http-backend + 真 Git 客户端，不依赖外网。
- `npm run test:live`：启动应用后比较真实 GitHub refs、clone、文件内容与归档重定向。
- `node scripts/tool-smoke.mjs`（工程内执行）：启动真实 koatty_ai stdio MCP 子进程，验证工具发现、上下文与框架检查。
- 静态 manifest 不会枚举中间件的所有动态代理路径，这部分由 HTTP / Git 测试覆盖。

详见 [验证报告](docs/VALIDATION.md) 和 [海外 VPS 部署教程](docs/DEPLOYMENT.md)。

## 运行边界

目标精确白名单、逐跳重定向校验、DNS 公网地址检查及 TLS 连接地址固定；仅在精确 GitHub Git Smart HTTP 端点透传 Authorization，并返回上游 401 认证挑战；认证请求和 POST 不跟随重定向、不自动重试。文件/Release 列表不接收 Git 认证；不转发 Cookie 或 Set-Cookie。文件强制附件下载，不在本站源下运行上游 HTML。

文件与 Git pack 有背压地转发；Git 读取协商请求仅在 8 MiB 默认上限内缓冲，push 请求流式上传，默认上限 512 MiB。并发、单 IP 并发、请求频率、请求体、首包/空闲/总传输时限有限制。限流是单进程内存级别，重启清空；多实例需要共享限流。`/healthz` 只说明本站进程可用。

只有应用端口不对外暴露、前置可信 Caddy 时才启用 `TRUST_PROXY`。认证令牌通过 HTTPS Git 的 Authorization 请求头传递，镜像服务器会接触这些凭证，仅使用自己管理或信任的镜像。不要把令牌放入 URL、查询参数、环境文件或日志。

## Release 列表页

可输入 `https://github.com/richenlin/HuashanAICode-releases/releases`，选择版本附件后生成加速地址；最近最多展示 20 个版本。使用附件直链无需查询版本 API。升级现有服务见 [迁移说明](docs/migration/release-listing.md)。

## 重跑四类功能的真实验收

需要 Node.js 22+、Git、curl、unzip 和 tar。在工程目录执行：

```bash
MIRROR_BASE_URL=https://du.koatty.org npm run test:live
```

脚本逐项输出结果，任一项失败退出码为 1；可通过 `MIRROR_REPORT_PATH=/tmp/mirror-report.json` 保存报告。覆盖 16 项：健康检查、真实 GitHub clone/fetch/pull 和 Git 协议 v0/v2、Raw/blob/raw 路径转换、ZIP/tar.gz/Codeload 归档字节比对及解包检查、Release 指定版本/latest 附件、版本列表选择下载、HEAD/Range、ETag 304、链接生成 API 和不支持请求的拒绝。可设置 `MIRROR_CHECK_FILTER='Source archive zip'` 单独复查对应项。直连 GitHub 的对照请求失败也会计为失败，应区分本地网络、上游与镜像状态；有限网络重试不保证线路稳定性。

## 直接打开包列表

浏览器可直接访问 `https://du.koatty.org/github.com/richenlin/HuashanAICode-releases/releases`，显示服务端渲染的版本及附件列表，点击附件即可下载。同仓库 `.git` 地址继续用于 Git 命令行，浏览器根路径保持 405。详见 [迁移说明](docs/migration/direct-release-page.md)。真实验收脚本现含 16 项检查。

## Git 推送与认证

```bash
git remote set-url origin https://du.koatty.org/github.com/OWNER/REPO.git
git remote set-url --push origin https://du.koatty.org/github.com/OWNER/REPO.git
git config --local credential.useHttpPath true
git push origin HEAD
```

交互认证时填写 GitHub 用户名，密码位置输入有对应仓库写权限的 Personal Access Token。GitHub 仍执行组织授权、分支保护、规则集等限制。`.git` 浏览器根路径继续返回 405；本地 commit/checkout/rebase 等命令不经过服务器。详细部署/认证/大小限制见 [Git 读写迁移说明](docs/migration/git-write.md)。普通 `test:live` 保持只读，不会向真实 GitHub 写入测试提交。

## Git 登录弹窗中的密码

密码栏需要填写 GitHub PAT（个人访问令牌），不能使用 GitHub 账号密码。新版 401 realm 和错误正文均明确提示；具体弹窗是否展示 realm 由 Git/IDE/凭证管理器决定，参见 [认证提示说明](docs/migration/git-auth-prompt.md)。
