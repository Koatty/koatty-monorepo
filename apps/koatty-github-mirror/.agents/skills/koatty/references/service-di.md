# Services, DI, scopes and lifecycle

## Reuse before generate

Before adding behavior, read the existing implementation: `koatty-ai context` lists components with their DI dependencies (`dependsOn`); `koatty-ai docs --api <Name>` resolves the current API surface. Modify existing services with the host editor while preserving their conventions — do not delete or regenerate files just to make a generator run, and never create a second same-named service.

## Component basics

- `@Service()` registers a class with the container (`@Component()` for generic components). Both are importable from `koatty`. Files live in `src/service/**` (Loader convention: exported class name = file name).
- Inject with `@Autowired()` property injection or constructor parameters. Resolve dependencies through the application-scoped container: `this.app.container` / the `app` your component receives. Do not use the global `IOC` instance from `koatty_container` in application code — `koatty-ai check` flags it (`KOATTY_GLOBAL_IOC`) because it bypasses app isolation.
- Capture identity from the authenticated request context. Never keep the current caller in a singleton field or substitute a process-wide variable. Container/AOP exceptions must fail closed: the protected operation must not run.

## Lifecycle

- Application startup: `@Bootstrap()` starts the app on import (entry files). `createApplication(AppClass)` initializes without listening — appropriate for tests and serverless composition; use an undecorated subclass there.
- `@Before` / `@Around` aspects wrap execution; aspects live in `src/aspect/**` and are referenced by name (e.g. `@BeforeEach("AuthAspect")`). Wire them through project configuration rather than reimplementing guards inline.
- Close servers/transports and call application stop during teardown; do not leave listeners in tests.

## Scopes

Default components are singletons per application. Request-scoped facilities exist on the request context; when a service needs per-request state, accept it as a parameter from the controller/context instead of caching it in the service.
