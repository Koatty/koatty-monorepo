# HTTP actions, DTOs and validation

## Add one HTTP action with the recipe

Prefer the deterministic recipe over hand-writing the wiring:

```sh
./node_modules/.bin/koatty-ai plan --savePlan --recipe http-action \
  --params '{"controller":{"name":"OrderController","basePath":"/orders"},"action":{"name":"create","method":"POST","path":"/"},"dto":{"name":"CreateOrderDto","fields":{"sku":{"type":"string","required":true,"length":64},"count":{"type":"number","required":true}}},"service":{"name":"OrderService","mode":"reference","method":"create"}}'
# review data.changeset, then
./node_modules/.bin/koatty-ai apply --planId <returned-id> --yes
```

- `service.mode: reference` verifies a unique exported service, its resolved import path and a compatible public instance method under `src/service` (`SERVICE_NOT_FOUND` / `SERVICE_METHOD_MISSING` / `SERVICE_SIGNATURE_MISMATCH` otherwise); it never imports by name alone. Reuse an existing service before creating a second one.
- `service.mode: create` refuses existing files and generates an explicit not-implemented placeholder — the generated service throws until you implement the business rules. Never fake success data.
- The generated controller carries a single mapped action, `@Autowired` injection, and `@Validated({ types: [Dto] })` on POST/PUT/PATCH. A request DTO with GET/DELETE is rejected (`UNSUPPORTED_COMBINATION`); for GET query objects follow the project's `@Get()` pattern manually.
- The result `notes` list what is deliberately pending (business rules, behavior tests, auth wiring). Implement the pending business rules and validate the generated wiring with real requests.

## DTO rules

- One DTO class per file under `src/dto`; the file name must equal the first exported class name (`CreateOrderDto.ts` → `class CreateOrderDto`). `koatty-ai check` flags violations (rule `KOATTY_DTO_LOADER_NAME`).
- DTO fields are field-driven: each field gets class-validator decorators generated from `{type, required, length, values, format}`. Use `@IsOptional()` for optional validation, not TypeScript `?` alone.
- `@Validated` is the runtime validation boundary; the static manifest schema is a projection. Test actual invalid input and confirm the Service/repository write was not reached. Production security profiles centralize validation policy; do not disable strict validation to pass a test.

Example DTO (`src/dto/CreateArticleDto.ts`):

```ts
import { IsString, Length } from 'class-validator';
export class CreateArticleDto {
  @IsString()
  @Length(1, 120)
  title!: string;
}
```

## Routes and parameters

- Route decorators: `@Controller('/base')`, `@GetMapping/@PostMapping/@PutMapping/@DeleteMapping/@PatchMapping`; parameter decorators `@RequestBody()`, `@Get()`, `@PathVariable()`. All are importable from `koatty` (re-exported from koatty_router/koatty_core); `Validated` comes from `koatty_validation`.
- Parameter ordering must match `@Validated({types: [...]})`; do not assume the first argument is the DTO when route parameters and DTOs are mixed.
- `koatty-ai check` rule `KOATTY_DUP_ROUTE` reports static method+path collisions after combining the Controller prefix and action path; dynamic routes are not judged.

The action DTO maps `json` to a JSON object (`Record<string, unknown>`), `datetime` to an ISO8601 string, and `text` to a string. Numeric min/max include zero. Unsupported field options are rejected. CLI previews without --savePlan do not issue a reusable plan ID.
