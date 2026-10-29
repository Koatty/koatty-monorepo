# Testing: framework bootstrap, cleanup and protocol verification

## What proves behavior

Use a test that fails when the requested behavior is absent. A module export or `expect(true)` does not prove route/service behavior. For a route change: a valid request succeeds, an invalid DTO is rejected before reaching the Service, and business writes are asserted (repository spies establish service/validation behavior; add real database acceptance when database behavior is part of the task).

## HTTP / framework bootstrap

- Compile before tests that load `dist`.
- Use an undecorated Koatty subclass with `createTestApp`, then `createHttpTest(wrapper.app)` (koatty_testing). Never import an auto-starting `@Bootstrap()` entry in such a test.
- Always stop the wrapper, including on failure paths. Set test-specific configuration through supported app/config seams.
- Run targeted tests with `koatty-ai verify --checks test --file test/<file>.test.ts` (single file) or `--checks types,test` for the affected area. verify executes installed project tools only; it never installs dependencies.

## Generated code

Generated controllers/services ship a constructible-component test skeleton — extend it: assert the service method is called with valid input and NOT called when DTO validation rejects. Recipe results carry pending-items notes; keep them as your TODO list, not as completed work.

## MCP and Agent

A minimal business MCP regression checks listTools, a valid call, invalid input, missing scope, rejected/missing approval and unchanged business state on denial; validate the declared output shape too. Exercise HTTP or stdio separately from an in-memory transport — they have distinct lifetime/auth/cancellation paths. Scripted providers make deterministic regression tests; report them as mocks.

For checkpointed runs verify worker recreation, concurrent lease acquisition, stale definition, cancellation, unknown-tool outcome, revision-bound reconciliation and no duplicate business operation, including a process-level interruption test and the actual deployment store when claiming durable recovery.

## Scope and honesty

`koatty-ai verify` reports which checks ran and their result; a passing verify is not business acceptance. Framework behavior tests pass ≠ business correctness. Keep fresh-install, real provider, shared-store, external-client and deployment evidence separate — never turn a local green test count into a release claim.
