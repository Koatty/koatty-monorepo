# Project identification, layout and creation

## Identify the project first

- Read `package.json`: dependency `koatty` is the framework; underscore packages (`koatty_validation`, `koatty_typeorm`, …) are optional components. `koatty-ai doctor` reports missing static prerequisites without starting anything.
- Determine the framework major from the installed package (`koatty-ai docs` or node_modules), not from README snippets. The docs index reports its snapshot version and the installed version; same-major is not proof of API availability. Check declarations and run verification when versions differ.
- Typical layout: `src/App.ts`, `src/config`, `src/controller`, `src/service`, `src/dto`, `src/model` (entities), `src/aspect`, `src/plugin`, `src/middleware`, `test`. Read the existing layout before inventing a new one; exported class names must match source filenames for Loader discovery.

## Create a new project

Use the human CLI's project generator (it owns write protection, template digests and receipts):

```sh
./node_modules/.bin/koatty new <name> --template project --offline --json   # standard HTTP scaffold
./node_modules/.bin/koatty new <name> --template mcp --offline --json      # business MCP app
```

Never fetch or download remote templates merely to inspect a project.

- `project` uses `@Bootstrap()` in `src/App.ts`; `mcp`/`agent` use an explicit composition factory in `src/application.ts`.
- Generation never installs dependencies or starts services. The bundled template is the default source; `.koatty/template-lock.json` records CLI version, template digest, recipe and output digest; `--template-digest <sha256>` rejects a different snapshot.
- MCP/agent examples ship in-memory state, not a production repository. The agent recipe requires explicit provider configuration and exposes only its read tool by default.
- Choose the minimal dependency set for the actual requirement; do not force optional packages into a simple application.

## Compose, don't duplicate

Generated skeletons are starting points, not templates to copy-paste around. For new framework structure prefer the supported recipes (http-action, CRUD); for existing components prefer reuse — creating a second same-named Service or auth aspect is always wrong. See [http-dto.md](http-dto.md) and [service-di.md](service-di.md).
