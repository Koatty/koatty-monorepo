# Changelog

## Unreleased — Release 最新版标记

- 通过 GitHub releases/latest 查询官方指定版本，直接 Release 页面及首页版本列表显示 Latest · 最新版。
- 不按列表顺序或版本号猜测；指定版本不在前 20 项时纳入列表，保持最多 20 项。标记查询失败时保留列表和下载，不误标。

## Unreleased — Git 加速链接使用独立域名

- 新增 MIRROR_GIT_BASE_URL 配置，仅 Git 链接返回独立 baseUrl；页面展示和复制的 URL、clone 命令均使用该入口，文件及 Release 下载仍使用 Web 域名。
- 配置为空兼容单域名部署；非法或带凭证的非 HTTPS origin 启动时拒绝。见 docs/migration/git-link-origin.md。

## Unreleased — Git 吞吐分段诊断

- 增加无凭证、有时限的 Git Smart HTTP 对照脚本，比较 GitHub 直连、本地应用和公网入口。
- 分离进度消息与 pack 字节、首响应与首 pack 延迟；不修改代理行为。使用方式见 docs/migration/git-throughput.md。

## Unreleased — Git 认证令牌提示

- Git 401 的 Basic realm 明确提示密码栏填写 GitHub PAT 而非账号密码。
- 401 返回 GITHUB_AUTH_REQUIRED 和中文认证/令牌权限提示，首页同步说明。
- 客户端可能不展示 realm，无法由服务端强制修改所有 Git GUI 的密码字段；见 docs/migration/git-auth-prompt.md。

## Unreleased — Git HTTPS 写入

- 支持 receive-pack 服务发现与流式 push，包括分支、标签、删除、force-with-lease 和 atomic 操作。
- Git 认证头仅向 GitHub Git 端点透传，保留 401 挑战；私有仓库权限由 GitHub 判断。
- push 默认 512 MiB 流式上限；认证及 POST 重定向不重放；修正长上传的响应头超时起算时机。
- 更新页面、Compose 配置及部署/认证说明；迁移见 docs/migration/git-write.md。


## Unreleased — 浏览器直接访问 Release 列表

- `/github.com/owner/repo/releases` 返回服务端生成的版本及附件 HTML 列表，点击附件直接下载，不依赖首页表单或 JavaScript。
- 保持 .git 根路径的浏览器 405 行为，以及 Git Smart HTTP clone/fetch/pull 路径。
- 增加空列表、错误页面、HTML 转义、HEAD/方法限制回归，见 docs/migration/direct-release-page.md。

## Unreleased — 静态资源缓存修复

- HTML 引用 CSS/JS 时加入实际内容 SHA256 版本标识。首页及静态资源显式设置 Cache-Control: no-store，避免 CDN 默认缓存旧脚本造成 Release 类型误判。
- 未知链接类型不再误报为 Git 仓库。详见 docs/migration/static-asset-cache.md。

## Unreleased — 功能验收

- 扩充真实网络验收脚本至 15 项，支持指定公网地址、失败退出码、JSON 报告及单项复查。
- 分别记录本地回归、真实 GitHub 和公网部署结果；保留网络失败记录。

## Unreleased — Release 列表页解析

- 支持 `/owner/repo/releases` 输入，显示最近 20 个公开版本及已上传附件，选择后生成加速下载地址。
- 固定 GitHub API 目标、响应体上限、超时、并发上限、60 秒缓存及重复请求合并。
- 增加空列表、无附件和 GitHub 限流提示；原有附件直链保持兼容。
- 迁移说明见 `docs/migration/release-listing.md`。

## 1.0.0 — initial application (unreleased)

- koatty_cli project generation and koatty_ai signed plan/apply for the link endpoint.
- Public Git clone/fetch/pull via domain-prefixed Smart HTTP read endpoints.
- Release/archive/raw downloads; redirects, Range/HEAD/conditional requests, streaming and cancellation.
- Target/DNS policy, bounded Git bodies, concurrency/rate/time limits and safe response headers.
- Responsive two-mode page, portable framework tarballs and Docker Compose/Caddy deployment guide.
- Framework COR-16 explicit HTTP status/body correction; see monorepo migration guide.
