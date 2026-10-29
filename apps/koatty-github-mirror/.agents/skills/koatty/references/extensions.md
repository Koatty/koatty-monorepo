# Extensions: middleware, plugins, aspects, configuration

## Middleware and plugins

- Generate skeletons with `koatty middleware <name>` / `koatty plugin <name>`; the command prints the required `src/config/middleware.ts` / `src/config/plugin.ts` registration (`list` + `config` entries). A generated component that is not registered is inert — wire it and say so.
- Component libraries use `koatty new <name> --template middleware|plugin`.

## Aspects

- Aspects live in `src/aspect/**` and are applied by name (e.g. `@BeforeEach("AuthAspect")`). The CRUD generator emits `AuthAspect` when auth is enabled — the aspect contains a token-verification placeholder you must implement against the project's real identity provider; generated auth is a skeleton, never a working auth system.
- Prefer referencing the application's existing authentication service over creating a parallel one. Container/AOP failures must fail closed.

## Configuration

- Configuration lives in `src/config/**` and is loaded by koatty_config (typed `Config`, `LoadConfigs`, `validateConfig`). Declare a schema; required keys must exist — missing keys read as `null`, not undefined.
- Read configuration through `app.paths.*` / injected config access; do not write `process.env` to route framework state.
- Manifests and tool outputs expose configuration key names and schemas only. Never paste credential values into reports, prompts or commits.
- `koatty-ai context --sections config` lists the static keys the project declares; unresolved/dynamic keys are reported as such.

## Optional extensions

Choose extensions by requirement and confirm the installed version with `koatty-ai docs` before importing: observability (`koatty_trace` `createGenAiRecorder`), serverless composition (`koatty_serverless` `createHandler` with an undecorated app class), tracing/audit (`koatty_guard` services). Each optional package carries its own lifecycle and initialization requirements — prefer installed source/declarations over old README snippets.
