---
name: koatty
description: Build, modify, and diagnose Koatty TypeScript backend applications (HTTP/gRPC/WebSocket/GraphQL services, MCP tools, LLM or checkpointed Agent workflows) using koatty_ai tools and the project's installed Koatty APIs. Use for Koatty application code; do not assume these APIs exist in unrelated Node.js frameworks.
---

# Koatty application engineering

Deliver working application behavior with the project's installed Koatty APIs. Prefer the existing Service, DTO, container, configuration and lifecycle over a parallel implementation. Business requirements, task planning, algorithms and file editing stay with you (the host agent); the koatty_ai tools supply framework knowledge, deterministic generation and framework checks.

## First pass: establish the actual contract

1. Inspect the target project's instructions, `package.json`, lockfile, tsconfig and pending changes before choosing commands. Package names use underscores (`koatty_cli`, `koatty_ai`, `koatty_validation`); CLI executables are `koatty`/`kt` (human scaffolding) and `koatty-ai` (this toolset). Resolve APIs through package exports, never sibling repository paths.
2. Prefer the project-local binaries (`./node_modules/.bin/koatty-ai`, `./node_modules/.bin/koatty`). Start with `--version`/`--help`; run `koatty-ai capabilities` once to learn the installed tool surface and generation support matrix. Feature-detect: a version number alone does not prove an operation exists, and you must never download a different CLI version just to inspect a project.
3. Read the static manifest with `koatty-ai context --root <project>`. Check `unresolved` before relying on it: `collectionMode: static` describes declarations, not live registration, and never proves runtime auth, connectivity or correctness.
4. Output contract: every tool operation (`mcp` uses protocol stdout; help/version are text) prints exactly one JSON envelope (`schemaVersion: 1`, statuses `completed|preview|applied|failed|cancelled`) on stdout; progress goes to stderr. Missing or unsupported arguments fail immediately — there is no interactive prompt.

## Choose the relevant guide

| Your task | Read | Preferred capability |
|---|---|---|
| Create a new project or app skeleton | [project.md](references/project.md) | koatty_cli project generator (`koatty new`) |
| Add an HTTP action (DTO + controller + service) | [http-dto.md](references/http-dto.md) | `koatty-ai plan --recipe http-action` |
| Add a full CRUD module (needs a database) | [persistence.md](references/persistence.md) | `koatty-ai plan --recipe crud` (inspect its schema first) |
| Reuse or modify an existing service/component | [service-di.md](references/service-di.md) | Host editor + `koatty-ai check` |
| Wire middleware / plugin / aspect / config | [extensions.md](references/extensions.md) | Component generators + manual config |
| gRPC / WebSocket / GraphQL / SSE endpoints | [protocols.md](references/protocols.md) | Protocol templates + config patch |
| Business MCP or LLM/Agent features | [mcp-agent.md](references/mcp-agent.md) | `koatty new --template mcp|agent`, koatty_mcp/llm |
| Make a failing build/test pass | [troubleshooting.md](references/troubleshooting.md) | `koatty-ai check`, `doctor`, `verify` |
| Write or fix tests | [testing.md](references/testing.md) | `koatty-ai verify --checks test` |

Read only the guides needed for the request. For version-sensitive APIs beyond these guides, query `koatty-ai docs --api <Name>` first, then inspect installed declarations. Do not guess decorators or lifecycles by analogy with other frameworks.

## Preserve these framework invariants

- Controller and MCP adapters parse/authorize input and call Services. Keep business logic and transactions in Services; do not auto-expose every service method as a tool.
- Use `app.container` and `app.paths.*`. Do not use the global `IOC` instance or write `process.env` to route framework state. Never put credential values in manifests, reports or logs.
- Keep DTO class names and filenames aligned with the Loader (`src/dto/CreateXDto.ts` → `class CreateXDto`). Use existing `@Validated({ types: [...] })` and class-validator property rules; do not invent `@Agent`, `@McpController` or `@BodyDto`.
- Keep the project's decorator mode. Current DTO integrations use legacy decorators with emitted metadata; do not migrate them to TC39 syntax.
- Development MCP (`koatty-ai mcp`; legacy `koatty mcp`) can change project files or run tests. Business MCP (`createMcpHost`) exposes application capabilities. Keep their authority and transport configuration separate.
- CLI plans are read-only previews unless `--savePlan` explicitly saves metadata; MCP plans stay in the connection; they expire, are conflict-checked and single-use. When user code conflicts, report instead of overwriting.

## Minimal tool path

Do not run every tool mechanically. A pure Service-method edit needs at most: the relevant API lookup (`koatty-ai docs`), the host editor, and `koatty-ai check` + `koatty-ai verify --checks types,test` on the affected area. Only a new project needs the full project-generation flow; only a new route needs the http-action recipe. When no recipe fits, use a verified example and the host editor — never bend business requirements into CRUD just to call a tool.

After generation, distinguish generated wiring from pending business work: recipe results carry `notes` listing what is deliberately not implemented. Report what changed, which checks actually ran, and any remaining external acceptance.

Use `koatty-ai skill --root <project>` to preview installing this Skill and `--yes` to install. Local modifications are preserved. Read a guide through `docs --guide <id>` when the host cannot directly access bundled files.
