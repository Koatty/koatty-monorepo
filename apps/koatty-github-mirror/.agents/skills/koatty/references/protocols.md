# gRPC / WebSocket / GraphQL / SSE

## Protocol controllers

- Single-file protocol controllers: `koatty controller <name> -t grpc|websocket|graphql` generates the controller, and for gRPC also the proto file (`src/resource/proto/<name>.proto`). Re-running the grpc command re-applies controller changes; the proto already exists.
- The module CRUD generator supports `api.type: grpc|graphql` with matching templates; it refuses `websocket` (use the single-file command). Custom endpoints are not supported in either path.
- Protocol decorators and parameter handling differ per protocol — read the generated skeleton and the project's existing protocol controllers before adding actions. `koatty-ai docs --api <Decorator>` confirms the import source.

## Protocol configuration

- `src/config/server.ts` holds `protocol` and transport options; the generators patch it for grpc/graphql/websocket controllers and report it in their notes. Verify the static keys against the installed framework version — the check tools only validate statically decidable config keys and never guess runtime values.
- gRPC requires a real client for meaningful verification; proto changes need regeneration/restart. GraphQL needs its schema served by the configured protocol. WebSocket needs Origin/auth controls exactly like HTTP.

## SSE

Use `streamSSE` from koatty_router on the existing HTTP app (no second server). Forward its abort signal into downstream work, honor backpressure, stop provider work on disconnect, and emit safe terminal errors. Verify readable events, termination, disconnect cancellation and provider cleanup with scripted providers (report them as mocks).

## Boundaries

- Static manifest routes describe declarations; live registration and transport behavior need real startup verification (see [testing.md](testing.md)).
- Do not claim protocol acceptance from typechecks alone: exercise a representative request per protocol with real clients or the framework's test helpers.
