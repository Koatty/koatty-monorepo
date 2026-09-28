# Phase E 审计修复记录（2026-09-29）

原审计：`phase-e-audit-2026-09-29.md`。**E-A01～E-A10 已完成代码修复及自动回归；本次没有提交、应用版本或发布。** 发布所需的外部验收仍单列，不以本地测试代替。

## 修复对应关系

| 审计项 | 修复 | 验证 |
|---|---|---|
| E-A01 计划签发 | 服务端按连接保存计划，绑定根目录、哈希和文件前像；10 分钟有效，最多 32 个，实际应用即消费；拒绝自算哈希、跨会话、过期、重放及文件冲突 | E-05、E-08 实际 stdio |
| E-A02 递归读取 | docs 的每层目录和文件均执行根边界检查；静态源文件、配置也拒绝符号链接 | E-05 文件/目录链接、E-06 源文件链接 |
| E-A03 无效写入 | Ajv 校验 MCP 参数；逐项检查内容及重复路径；预先暂存，失败时恢复已写文件；并发修改不被回滚覆盖，保留恢复材料并返回位置 | E-05 非布尔参数、截空反例、字节级回滚、并发恢复 |
| E-A04 配置外泄 | profile 只接受现有枚举；动态表达式、动态计算键标记未解析；配置 schema 不携带默认值 | E-06 假密钥、计算键、C-6 默认值反例 |
| E-A05 生成代码 | 查询使用已有 `@Get()`，Controller 直接返回数据；DTO 从正确包导入现有约束并用既有 `@IsDefined()` 暴露转换字段；修复严格编译、声明依赖和真实模型 spy；Create/Update/Query DTO 拆为同名文件 | E-07 真实编译、生成测试、OpenAPI 文档及 HTTP POST/PUT |
| E-A06 CLI 版本 | 项目模板依赖 `koatty_cli:^5.0.0`，模块文档工具同样声明 CLI 依赖 | E-07 生成 package.json；发布文件列表检查 |
| E-A07 清单事实 | 识别 src/config、实际请求参数装饰器、组件别名、属性注入、切面使用、协议和 JSONC/extends；未知配置/路径/类型等进入 unresolved | E-01、E-06 |
| E-A08 Schema | 清单 v1 结构使用 Ajv；DTO 增加 draft-07 schema，覆盖基础/联合/数组/嵌套及常用约束；配置标明声明或推断来源；API 文档复用同一 schema | E-06 正反例、E-07 文档生成 |
| E-A09 测试生命周期 | start 等待真正监听回调/错误；stop 的环境恢复放在 finally 且只恢复一次；示例避免导入自动启动入口 | testing E.lifecycle、E-07 实际框架监听 |
| E-A10 执行标注 | test 的 readOnlyHint/idempotentHint 均为 false，迁移文档明确测试及 Jest 配置可产生副作用 | E-05、E-08 工具枚举 |

同时补齐独立 Controller/Service 命令的测试骨架，保留已存在测试；更新 AGENTS、Cursor 规则、冒烟示例及框架文档站 `docs/llms.txt` 源码，没有新增框架装饰器或同义 API。

## 真实联调发现的补充修复

生成后启动首先暴露了多个 DTO 共用文件不符合 Loader 类名/文件名规则，已通过拆文件解决。后续 HTTP 请求又发现路由层两处问题，已一并修复：

1. DTO 校验的普通异常原先返回 500；现在只将明确的 `KoattyValidationError` 转成现有 HTTP 400 Exception，内部故障不伪装成客户端错误。
2. `(id: number, dto: UpdateDto)` 原先错误选中单 DTO 快捷路径，把 number 当成 IoC 类；现在选择混合参数处理器并保持参数顺序。

真实 HTTP 用例验证合法 POST/PUT 返回 200、非法 DTO 返回 400，非法请求不会调用模型写入。模型静态 API 使用 spy/stub，没有连接真实数据库。路由包新增独立回归覆盖异常分类和处理策略。

## 最终验证

环境：当前工作区、Node 22.23.1、现有 pnpm 安装。没有在线重新解析所有依赖。

| 命令/场景 | 结果 |
|---|---|
| `pnpm --filter koatty_cli build` | 通过 |
| `pnpm --filter koatty_cli exec jest --runInBand` | **40 suites / 202 tests 通过** |
| `pnpm --filter koatty_cli lint` | 0 errors / 42 warnings |
| `pnpm --filter koatty_testing build` | 通过（含类型构建） |
| `pnpm --filter koatty_testing test` | **4 suites / 12 tests 通过**；lint 0 errors / 1 warning |
| `pnpm --filter koatty_router build` | 通过（含类型构建） |
| `pnpm --filter koatty_router exec jest --runInBand --coverage=false` | **39 suites / 419 tests 通过** |
| router lint（test 脚本执行） | 0 errors / 25 warnings |
| 实际 stdio MCP 子进程 | 工具枚举、未签发拒绝、非法 dryRun 拒绝、默认预览及签发计划写入通过 |
| 生成项目编译/Jest/文档/HTTP | 通过；合法请求 200、非法 DTO 400 |
| `npm pack --dry-run --ignore-scripts` | CLI 入口、新 schema/transaction 产物、隐藏 Cursor 规则及模块模板在发布文件列表中 |
| Ajv 依赖与锁文件 | package 范围、importer 版本、已有 lock snapshot 对齐 |

合计 **633 个测试通过**。测试与构建不是 npm 全新安装证明。原审计反例脚本和输出保留为历史证据，它们断言的是旧缺陷，修复后不要将这些脚本退出码作为回归门；使用包内 E-05～E-08 和生命周期/路由新回归。

本轮构建改写的路由 API 文档已恢复到原字节内容，未保留无关生成文档改动。原有 koatty/koatty-loader 未跟踪内容保持不动。

## 边界与手动发布

- 静态清单不执行应用：复杂动态类型、自定义校验器、继承等暂不支持的内容明确标记 unresolved。config.schemaSource 为 inferred 时只有类型推断，不能视为完整运行期约束。
- 多文件 apply 支持可处理 I/O 失败的回滚，不承诺进程被强杀或断电时整体原子提交；残留 `.koatty-apply-*` 包含恢复记录，回滚失败也会明确报告。不得覆盖期间发生的并发修改。
- createTestApp 的 env 选项仍是进程环境设置；不要用于并行测试互相冲突的环境配置。
- **尚未执行**：Cursor 内实际人工确认的端到端任务、全新在线安装、真实数据库验收、文档站部署及 npm 发布。当前真实联调覆盖 HTTP，其余协议通过路由包既有回归，不等于各协议的外部部署验收。
- 已新增待应用 changeset：`.changeset/phase-e-audit-fixes.md`，直接修复包为 **koatty_cli / koatty_testing / koatty_router**。尚未执行 changeset version；依赖联动版本以手动发布前的 Changesets 预览为准。
- 提交时注意多层子模块：CLI、CLI 的 modules/project 模板、koatty-doc 都有独立改动。发布前按 `RELEASE-GUIDE.md` 检查版本与依赖，再由用户手动发布，不要只发布 CLI 而漏掉路由和测试辅助包修复。
