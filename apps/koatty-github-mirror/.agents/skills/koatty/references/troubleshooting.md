# Troubleshooting: error → cause, rule, example

Map every failure to a concrete diagnosis before editing. Do not guess decorators, do not disable validation to make an error disappear, and do not close verification to make a report green.

## Envelope diagnostics (`koatty-ai` / `koatty` tools)

| Code / result | Meaning | Next action |
|---|---|---|
| `DEPENDENCY_MISSING` | A project-declared tool is not installed | Install with the project's lockfile/package manager; never let tools install dependencies. Verify again. |
| `CONFIG_MISSING` | tsconfig/config file missing | Locate or create the intended config; do not typecheck a different directory. |
| `INVALID_ARGUMENT` / `INVALID_RECIPE_INPUT` | Bad tool input | Read `diagnostics[0].next`; validate against the recipe inputSchema (`koatty-ai recipes --id <id>`). |
| `NOT_KOATTY_PROJECT` | Root is not a Koatty project | Point `--root` at the project root (package.json declaring koatty). |
| `RECIPE_NOT_FOUND` | Capability not in this install | Do not bend the task into an available recipe; use verified examples + host editor. |
| `UNSUPPORTED_COMBINATION` / `UNSUPPORTED_SPEC` | Support-matrix rejection (e.g. GET+DTO, custom endpoints, non-id primary key) | Adjust the request to supported combinations or implement with the host editor; the refusal happened before any write. |
| `SERVICE_NOT_FOUND` / `SERVICE_METHOD_MISSING` | http-action reference validation failed | Fix the service/method name, create the method first, or use `service.mode: create`. |
| `FILE_EXISTS` | Target file exists; create refused | Reuse the existing component or make an explicit modification; never delete user code to make generation succeed. |
| `PLAN_CONFLICT` / `PLAN_EXPIRED` / `PLAN_NOT_ISSUED` / `PLAN_TAMPERED` | Plan protection | Inspect concurrent edits and re-plan; check whether prior writes already happened before retrying; never recalculate signatures. |
| `CHECK_FAILED` / `CHECK_TIMEOUT` / `CHECK_TIMEOUT` | verify check failed or timed out | Read per-check stdout/stderr in the envelope; writes may already be present — repair forward, don't re-apply consumed plans. |
| `STATIC_UNRESOLVED` | Manifest couldn't resolve a declaration | Inspect the identified source and validate runtime behavior; do not treat it as a resolved contract. |

## Static check rules (`koatty-ai check`)

| Rule | Typical fix |
|---|---|
| `KOATTY_DTO_LOADER_NAME` | Rename the DTO class or file so they match (`src/dto/X.ts` → `class X`). |
| `KOATTY_GLOBAL_IOC` | Replace global `IOC` usage with the application-scoped container (`this.app.container`); state intentional bootstrap usage in review. |
| `KOATTY_DUP_ROUTE` | Keep one controller per static route; dynamic routes are not judged. |

## Common build/runtime failures

- **Unknown decorator / wrong import**: check `koatty-ai docs --api <Name>` for the real import source (`Validated` lives in `koatty_validation`, not `koatty`); inspect installed declarations for anything the index doesn't resolve.
- **Validation "leaks" into business logic**: `@Validated({types:[...]})` order must match method parameters; test with an actually-invalid payload and assert the Service was not reached.
- **Component not registered**: middleware/plugin entries need `src/config/middleware.ts`/`plugin.ts` registration; aspects are referenced by name; DTO/Service files must export a class matching the file name.
- **Tests pass locally, fail fresh**: run `koatty-ai verify` (types + test) after `npm run build`; tests that load `dist` need compilation first. Workspace symlinks and old dist can mask packaging problems — isolated-install acceptance is separate.
- **Port/protocol mismatch at startup**: `src/config/server.ts` protocol must match the controllers; generators patch it and note the change.
