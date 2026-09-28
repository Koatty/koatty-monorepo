# AGENTS.md — Koatty Monorepo 协作指南

面向 AI 编码助手与人类贡献者的仓库约定。**所有命令均在仓库根目录执行**（除标注 `cd` 的除外）。

---

## 1. 仓库结构

- `packages/*` — 所有框架包（pnpm workspace，见 `pnpm-workspace.yaml`：`packages/*`、`apps/*`、`tools/*`、`examples/*`）。
- `docs/` — 方案、审计报告与**迁移指南**（`docs/includes/koatty-hardening-and-ai-evolution-plan.md` 为总体路线图；`docs/migration/*.md` 为逐版本行为变更说明）。
- `scripts/` — 构建/发布/校验脚本（`build-base-packages.js`、`commit-submodule-changes.js`、`create-and-version.js`、`doctor.js`、`security-baseline.ts`）。
- `RELEASE-GUIDE.md` — 发布流程权威文档，发布前必须先读。

### 主仓库目录 vs 子模块

`packages/*` 中相当一部分是 **git submodule**（见 `.gitmodules`）。判断方法：

```bash
git status --short   # 子模块显示为 " m <path>"；主仓库文件显示为 " M <path>"
```

- **主仓库目录**（直接在本仓库提交）：`koatty-core`、`koatty-router`、`koatty-serve`、`koatty-exception`、`koatty-trace`、`koatty-config`、`koatty-testing`。
- **子模块**（需 `git -C packages/<name> ...` 单独提交）：`koatty`、`koatty-ai`、`koatty-lib`、`koatty-logger`、`koatty-container`、`koatty-loader`、`koatty-proto`、`koatty-validation`、`koatty-cacheable`、`koatty-store`、`koatty-schedule`、`koatty-graphql`、`koatty-doc`、`koatty-awesome`、`koatty-typeorm`、`koatty-serverless`、`koatty-swagger`。

> 以 `.gitmodules` 为准，不要凭记忆判断。

---

## 2. 构建顺序

根命令：

```bash
pnpm build          # = node scripts/build-base-packages.js && turbo run build
pnpm build:base     # 只构建基础包（依赖顺序固定）
pnpm clean          # turbo run clean && rimraf node_modules .turbo
```

`scripts/build-base-packages.js` 中的**基础包顺序**（改依赖关系时同步更新该数组）：

```
koatty_lib → koatty_logger → koatty_container → koatty_loader → koatty_config
→ koatty_proto → koatty_validation → koatty_graphql → koatty_exception → koatty_core
```

之后 `turbo run build` 按 `turbo.json` 的依赖图并行构建其余包。
单包构建：`pnpm --filter koatty_core build`。

---

## 3. 测试

```bash
pnpm test                                   # turbo run test（全仓库）
cd packages/koatty-router && npx jest --coverage=false        # 单包
npx jest test/regression/ARCH-06 --coverage=false             # 单个回归用例组
npx tsc -p tsconfig.json --noEmit                             # 单包类型检查
```

约定：

- 回归测试放在各包 `test/regression/`，文件名形如 `<需求编号>.<主题>.test.ts`（如 `ARCH-06.sse.test.ts`、`PERF-01.handler-hotpath.test.ts`）。
- **任何行为变更都必须补一个回归测试**，并在对应包 `CHANGELOG.md` + `docs/migration/*.md` 记录。

其它质量门：

```bash
pnpm lint                 # turbo run lint（eslint，要求 0 error）
pnpm security:baseline    # 安全基线校验
pnpm doctor               # 环境/依赖自检
```

---

## 4. 子模块工作流

1. 在子模块内修改并提交：

   ```bash
   git -C packages/koatty-container add -A
   git -C packages/koatty-container commit -m "feat(container): ..."
   ```

2. 回到主仓库，提交新的子模块 SHA：

   ```bash
   git add packages/koatty-container
   git commit -m "chore(submodule): bump koatty_container"
   ```

3. 批量提交所有子模块改动：`pnpm commit:submodules`（`--no-push` 仅提交不推送，`pnpm release:dry-run` 可预演）。

> 主仓库只记录子模块指针；**忘记提交子模块 SHA 会导致 CI 拿到旧代码**。

---

## 5. 发布流程

权威文档：`RELEASE-GUIDE.md`。核心步骤（Changesets）：

```bash
pnpm changeset                              # 1. 写 changeset（描述变更 + 版本级别）
pnpm changeset:version:minor                # 2. 应用版本号并自动提交（major/minor/patch/pre 同理）
pnpm release                                # 3. 构建 + 修正 workspace 版本 + changeset publish + 提交子模块
pnpm release:dry-run                        # 预演子模块提交（不推送）
pnpm release:submodule                      # 只发布 koatty 主包（cd packages/koatty && pnpm release）
```

发布前检查清单：

- [ ] `pnpm build` 通过（`build:base` 顺序未破坏）
- [ ] `pnpm test` / 受影响包 `npx jest` 全绿、`npx tsc --noEmit` 干净
- [ ] `pnpm lint` 0 error
- [ ] 每个行为变更已在包 `CHANGELOG.md` 记录，并在 `docs/migration/*.md` 写清迁移方式
- [ ] 子模块改动已提交且主仓库已 bump 指针
- [ ] 路线图文档中对应阶段的进度/发布状态已更新

---

## 6. 禁止事项（AI guardrails）

- **不要直接改全局 `IOC`** 或往 `process.env` 写路径/配置变量；路径用 `app.paths.*`，容器用 `app.container`。
- **不要在 Controller 里写业务逻辑**（Controller 只做参数解析与结果返回，业务放在 Service）。
- **不要在文档、日志、清单里输出配置值或密钥**（只输出键名/schema）。
- **不要提交构建产物**（`dist/`、`tsbuildinfo`、`.turbo/`）或调试残留（临时 HTML、脚本）。
- **不要绕过回归测试**：行为变更必须配 `test/regression/` 用例；删除代码前先有行为测试。
- **不要跳过 `docs/migration/`**：任何破坏性或易误用的行为变更都必须写迁移指南。
- **不要用 shell 做代码搜索**（用编辑器/Grep），也不要在未验证的情况下声称"测试通过"。
