# Release Latest 标记

ReleaseService 在公开列表查询后请求同仓库的 GitHub `/releases/latest`，按 Release ID 标记官方指定的 Latest。直接 HTML 列表及首页交互列表均显示 `Latest · 最新版`，预发布不会标成最新版。不按数组第一项、tag 排序或发布日期自行推断。

官方指定版本不在前 20 项时，将其纳入列表并保持最多 20 项。列表与标记共享原有 60 秒缓存和请求合并；一次冷查询最多新增一次 GitHub API 请求。新增请求受原有总时限和 4 MiB 响应上限约束，不携带用户凭证、不跟随重定向。

仅有预发布、没有 Latest，或 Latest API 限流/超时/异常时，列表和下载仍可用，但不显示未经确认的标记。不是将第一个版本当作兜底 Latest。

需要更新应用镜像及静态资源，沿用本地 amd64 构建、上传镜像、VPS `--no-build --pull never` 的流程。保留 compose.image.yaml 中的 Git 专用域名配置和当前 Caddy 加固配置。

2026-11-01 已部署镜像 `koatty-github-mirror:release-latest-20261101`，公网 HTML 与 API 均验证标记对应 GitHub 官方指定的 HuashanAICode 3.14.8；Git 链接仍使用 git.koatty.org，Caddy 配置校验和未变，容器 healthy。全量 101 项测试、lint 及随后新增的交互列表 Latest 渲染回归均通过。

上一版镜像 `koatty-github-mirror:git-links-20261101` 保留；Compose 备份为 `/root/web/compose.image.before-release-latest-20261101.yaml`。回滚时恢复备份的镜像覆盖配置，再以 `--no-build --pull never --no-deps mirror` 启动，无需服务器构建。
