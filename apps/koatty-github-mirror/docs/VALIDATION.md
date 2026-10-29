# 验证记录

## 生成来源

- 本仓库 koatty_cli bundled/offline project 模板创建，无远程模板。
- koatty_ai 安装 Skill；http-action 签名计划生成链接接口并应用。
- Service 的生成占位已替换为真实业务；另补 HTTP / Git 行为回归。
- 使用源码构建版本，不以相同版本号推断这些改动已在 npm 发布。

## 集成发现

1. Loader 要求自定义导出 Error 类也与文件名一致，使用 MirrorError.ts。
2. 生成 DTO 带未使用验证器导入，已精简；生成 export 测试不是业务验收。
3. 路由 DTO 默认有类型转换，补充 URL 格式约束，确保无效输入在 Service 前拒绝。
4. Trace 两处将带 body 的 404 改成 200；补 COR-16 回归并修复 HTTP 路径，保留非 HTTP 状态映射。
5. 为长传输显式设置 Trace 时限，晚于代理总时限。
6. koatty_ai verify 复用的 CLI 解析器误判 ESLint exports 隐藏的 bin 为缺失依赖；新增 API-06 回归并修复已声明可执行入口的解析。

## 验证矩阵

验证日期：2026-10-14（Asia/Shanghai）。

| 层次 | 实际结果 |
| --- | --- |
| 基础包与受影响运行包构建 | 基础 10 包按规定顺序构建；serve/router/trace/koatty/testing 及 CLI/AI 构建通过 |
| 应用 | 4 suites / 52 tests 通过，含一个生成的结构 smoke；其余覆盖策略及真实 HTTP/Git 行为 |
| Trace | 21 suites / 149 tests 全部通过；lint 0 error、25 个已有 warning |
| CLI | 49 suites / 245 tests 全部通过；包含 API-06 新增 4 项回归；lint 0 error、46 个已有 warning |
| koatty_ai | 6 suites / 32 tests 全部通过 |
| koatty_ai check | 0 error / 0 warning |
| koatty_ai verify | types / test / lint / manifest 四项全部通过 |
| stdio MCP | 真实子进程协议连接，发现工具并调用 context/check 成功；可运行 scripts/tool-smoke.mjs 复验 |
| 独立安装 | 本地源码 tarball + npm lock，独立 npm ci 成功；应用 52 tests、lint 通过，无 workspace 包链接 |
| 真实 GitHub | ls-remote HEAD 与直连相同；浅克隆成功；Raw 字节一致；ZIP 归档重定向成功 |
| 真实 Release | jqlang/jq 的 jq-1.7.1 / sha256sum.txt，经代理和直连下载后逐字节比较一致 |
| 浏览器 | 桌面页面、Git 及文件模式生成、复制成功反馈、无效 URL 错误提示通过；390px 宽度无横向溢出 |
| Compose | 使用本机 docker-compose 的 config --quiet 验证通过 |
| Docker 镜像 | **未完成**：拉取 docker.io/library/node:22-bookworm-slim 的 manifest 超时，构建尚未进入 RUN 步骤 |
| VPS / 公网 TLS / 负载测速 | **未执行**，按部署教程在目标环境验收 |

## 测试含义与限制

MIRROR-02 使用真实 Koatty 启动、真实 loopback TCP、Git 官方 http-backend 和系统 Git 客户端，覆盖 clone / fetch / pull、v0/v2、gzip 协商透传、Range/HEAD/304/416、重定向限制、错误状态、拒绝 push、请求体上限、断连清理、超时恢复。其上游 transport 是测试专用注入，不把本地服务器伪装成真实 GitHub。真实 GitHub 另由外网脚本验证。

静态 manifest 的 5 个 unresolved 涉及 Matches 正则与动态环境配置；工具已明确报告，未将其描述为完整静态 schema。动态域名前缀代理路径也不在声明式路由列表中，由运行回归覆盖。

两处缺陷都先获得失败回归，再修复：COR-16 保留 HTTP 状态与响应体，API-06 识别 exports 隐藏但 bin 公开声明的工具入口。CLI 全测一度受本地预览占用 3000 端口影响，停止预览后重新完整执行通过。

上述结果证明本应用覆盖到的框架与工具链路径，不证明 Koatty 所有可选组件、所有协议、多实例限流、所有公网线路或 npm 已发布版本均已验收。没有提交、推送、发布或部署到 VPS。

## 2026-10-14 Release 列表页修复

- 应用 5 个测试套件、71 项测试通过，包含真实 Koatty 注入/API、Git clone/fetch/pull 回归，以及 Release 缓存、并发合并、体积上限、错误和附件来源校验。ESLint 通过。
- 实际浏览器输入用户提供的 HuashanAICode-releases 列表页，显示两个公开版本，各 8 个附件；选择校验和附件，成功生成对应镜像地址及带原文件名的 curl 命令。此数据为验证时的 GitHub 实际响应。
- 未操作 VPS，需上传更新并重新构建 mirror 镜像。

## 2026-10-14 四类特性复核（实际公网）

目标 `https://du.koatty.org`；本地新版独立进程 `http://127.0.0.1:3101`。应用再次构建，5 suites / 71 tests 全部通过，ESLint 和验收脚本语法检查通过。未更改业务实现，扩充了 `scripts/live-smoke.mjs`。

| 功能 | 公网实际证据 | 本地新版证据 |
| --- | --- | --- |
| Git 仓库 | clone / fetch / pull、v0/v2 成功，HEAD 与 GitHub 一致 | 增量提交 fetch/pull 的真实 loopback Git 集成回归通过；外网复查出现 504，不能称本地外网稳定通过 |
| Release 附件直链 | jq-1.7.1 的 sha256sum.txt，2129 字节，直连/代理 SHA256 一致 | 重试后文件字节一致；有上游 504 记录 |
| Release latest 附件 | jq 的 latest/download/sha256sum.txt，2302 字节，直连/代理一致 | 本轮多次 504，保留失败，不计为通过 |
| Release 列表页 | **失败：403 UNSUPPORTED_TARGET，线上尚未生效新增解析功能** | HuashanAICode-releases 显示 2 个版本；选中 .sha256 附件下载 133 字节，与直连一致 |
| ZIP 源码归档 | 351 字节，SHA256 一致，unzip -t 通过 | 相同检查通过 |
| tar.gz 源码归档 | 258 字节，SHA256 一致，tar -tzf 可读出 README | 相同检查通过 |
| Codeload | 351 字节 ZIP，直连/代理一致 | 相同检查通过 |
| Raw / blob / GitHub raw 路径 | 均得到相同的 13 字节 README，SHA256 一致 | 相同检查通过 |
| HEAD / Range | HEAD 无正文，Range bytes=10-29 返回 206、正确 Content-Range 和 20 字节切片 | 受控回归及真实 Release 重试均通过 |
| ETag | If-None-Match 返回 304，无正文 | 相同检查通过 |
| 转换与限制 | Git / Release / ZIP / tar.gz / Raw / blob 转换成功；非允许主机及 push discovery 返回 403 | 相同检查通过 |

外网并非一次全绿：首轮 Node fetch 在本机有连接超时；改用 curl 后完整公网矩阵 12/15，通过单项复查补充了 ZIP 成功证据，Git 另有完整成功记录；GitHub 对照请求及本地上游曾超时，线上 Release 列表持续 403。原始分轮 JSON 见 [feature-verification-2026-10-14.json](feature-verification-2026-10-14.json)，保留失败项，不能把分轮成功合集当作单轮稳定性或压力验收。

待生效项：按 [Release 升级说明](migration/release-listing.md) 更新 VPS 的 mirror 服务，再运行 `MIRROR_BASE_URL=https://du.koatty.org npm run test:live`。本轮没有服务器 shell/部署操作，不声称已经更新线上。没有执行大体积安装包全量下载、持续负载或多线路测速。

## 静态资源缓存复核

2026-10-14 公网 `/api/links` 对用户 Release 列表返回 `kind: releases`；公网最新 JS 与本地版本一致，包含 releases 专用分支。JS 响应却带 `Cache-Control: max-age=14400`，旧客户端脚本仍可能驻留。新增完整 Koatty HTTP 回归，验证首页引用的 hash 等于资源内容摘要、带查询参数资源可读取且正文正确、首页和有/无版本参数的资源均为 no-store。未读取用户浏览器本地缓存。此次构建及 5 suites / 72 tests 通过，ESLint 通过。

## 浏览器直达 Release 列表

2026-10-14：74 项回归测试和 ESLint 通过。新增真实 Koatty HTTP 覆盖 SSR 包列表、附件下载、HEAD/POST 方法、末尾斜杠、HTML 转义、空列表、404 错误 HTML，以及 .git 根路径保持 405。真实浏览器直接打开本地 `/github.com/richenlin/HuashanAICode-releases/releases`，显示 GitHub 当时返回的 1 个版本、8 个附件；桌面布局核验通过。未部署 VPS。

## Git 写入支持（取代旧版“拒绝 push”边界）

- 本地真实 Koatty + TCP + Git 官方 http-backend + Git 客户端验证：401 challenge/credential helper 后推送提交、分支、标签、删除分支及标签、force-with-lease 成功/过期拒绝、非快进拒绝、认证 clone。
- 9 MiB 随机文件 pack 经 chunked HTTP 推送并逐字节读取验证；上游在客户端 EOF 前收到数据，超过 Content-Length/实际 chunked 上限返回 413；上传断连释放并发。
- 上游 pre-receive hook 拒绝受保护测试引用，atomic push 不会留下部分引用。认证/POST 307 不重放，文件仍不转发认证。
- 生产 transport 的流式管道/响应头计时逻辑通过 loopback TCP 验证，仅替换 DNS/TLS 建连，未将此测试当成真实 GitHub TLS 或线上写入验收。
- 6 suites / 86 tests、构建/manifest 和 ESLint 通过。未读取真实用户凭证、未推送真实 GitHub 仓库、未部署 VPS；CDN/Nginx 上传限额和公网写入需部署后验收。

真实 GitHub 只读认证探测：通过本地新版镜像请求用户仓库的 receive-pack 服务发现，返回 401、WWW-Authenticate: Basic realm="GitHub" 及 no-store；未提交任何真实凭证、未执行 GitHub 写入。此项与本地完整 push 回归分开记录。

## 2026-10-15 Git 认证提示

用户确认曾在 Git 密码弹窗填入 GitHub 账号密码。线上无秘密 Authorization 诊断探测返回 400 INVALID_AUTHORIZATION，说明该诊断请求头到达新版应用校验路径；匿名上游对照请求本轮超时，不据此推断仓库可见性或用户权限。新增认证提示回归覆盖 upload-pack/receive-pack 401 的 PAT realm、中文说明和 no-store。Git 客户端是否显示 realm 取决于自身 UI，不宣称已控制用户的实际弹窗。

认证提示更新：构建、静态 manifest、6 suites / 87 tests 以及 ESLint 通过；包含真实 Git 客户端认证/读写回归，确认调整 realm 后没有破坏凭证协商。尚未验证用户具体客户端的弹窗显示。
