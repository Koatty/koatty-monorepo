# AGENTS.md — koatty-github-mirror

面向 AI 编码助手的项目约定（由 `koatty new` 生成，roadmap Phase E / E-3）。
本文件只描述约定，不包含任何配置值或密钥。

## 1. 目录结构

- `src/App.ts` — 应用入口（`@Bootstrap()`）。
- `src/controller/` — Controller：只做参数解析与结果返回。
- `src/service/` — Service：业务逻辑、事务、外部依赖调用。
- `src/model/` — 数据模型 / TypeORM 实体。
- `src/dto/` — 入参 DTO（`@Validated` 调用 DTO 校验；属性约束从 `class-validator` 导入）。
- `src/middleware/`、`src/plugin/`、`src/aspect/` — 中间件、插件、切面。
- `src/config/` — 配置文件（按需增删，`config.ts` 决定加载顺序）。
- `test/` — 测试（`*.test.ts`），由 `jest.config.js` 收集。

## 2. 常用命令

```bash
npm run dev            # 编译后启动（修改源码需重新执行）
npm test               # jest + ts-jest（test/ 目录）
npm run lint           # eslint，只检查
npm run build          # 编译 dist/ 并生成带 SHA-256 文件指纹的生产清单
npx koatty manifest    # 导出应用清单（组件/路由/DTO/配置键名，不含配置值）
npx koatty mcp         # 以 MCP stdio 方式接入 Cursor / Claude Code
npx koatty capabilities --json # 发现实际安装版本的能力
npx koatty doctor --json       # 检查项目配置和依赖
npx koatty verify --checks types,test --json # 编译检查和行为测试
```

## 3. 如何新增路由 / 服务

1. 读取 `.agents/skills/koatty/references/http-dto.md`，优先使用 `koatty-ai plan --recipe http-action --savePlan` 预览并取得计划 ID，再用 `koatty-ai apply --planId <id> --yes` 应用；
2. 在 `src/service/<Module>Service.ts` 写业务逻辑；
3. Controller 只负责调用 Service 并 `return data`；
4. 在 `test/<module>.test.ts` 补行为测试，`npm test` 必须通过。

## 4. 禁止事项（AI guardrails）

- 不要直接在 Controller 里写业务逻辑或数据库访问；
- 不要直接修改或重新赋值全局 `IOC` 容器对象，使用 `app.container` / `@Autowired()`；
- 不要把路径或配置写进 `process.env`，使用 `app.paths.*` 与 `src/config/*`；
- 不要在日志、文档、提交信息里输出配置值或密钥；
- 不要提交 `dist/`、`*.tsbuildinfo`、`node_modules/` 等构建产物；
- 修改行为必须同时修改/新增 `test/` 下的测试，不得删除测试来“通过”构建。
